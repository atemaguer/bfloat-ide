import { handle } from '@/lib/main/shared'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Get an enhanced PATH that includes common Node.js installation directories.
 * Packaged Electron apps on macOS don't inherit the full shell PATH, so we
 * need to explicitly add paths where npm/npx/node are commonly installed.
 */
function getEnhancedPath(): string {
  const currentPath = process.env.PATH || ''

  if (process.platform === 'win32') {
    // On Windows, add common Node.js installation directories
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
    const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    const appData = process.env.APPDATA || ''
    const localAppData = process.env.LOCALAPPDATA || ''

    const windowsPaths = [
      path.join(pf, 'nodejs'),
      path.join(pfx86, 'nodejs'),
      localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
      appData ? path.join(appData, 'npm') : '',
      process.env.NVM_SYMLINK || '',
    ].filter((p) => p && fs.existsSync(p))

    if (windowsPaths.length > 0) {
      return [...windowsPaths, ...currentPath.split(';')].filter(Boolean).join(';')
    }
    return currentPath
  }

  // On macOS/Linux, add common Node.js installation directories
  const additionalPaths = [
    path.join(os.homedir(), '.local', 'bin'),          // User local binaries
    path.join(os.homedir(), '.bun', 'bin'),            // Bun
    path.join(os.homedir(), '.nvm', 'current', 'bin'), // NVM (common symlink)
    path.join(os.homedir(), '.nvm', 'versions', 'node'), // NVM versions dir (we'll find active)
    '/opt/homebrew/bin',                               // Homebrew on Apple Silicon
    '/opt/homebrew/sbin',
    '/usr/local/bin',                                  // Homebrew on Intel / common binaries
    '/usr/local/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/bin',
    '/sbin',
  ]

  // Try to find active NVM node version
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir).filter((v) => v.startsWith('v'))
      if (versions.length > 0) {
        // Sort versions and use the latest
        versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        additionalPaths.unshift(path.join(nvmDir, versions[0], 'bin'))
      }
    } catch {
      // Ignore errors reading NVM directory
    }
  }

  return [...additionalPaths, ...currentPath.split(path.delimiter)].filter(Boolean).join(path.delimiter)
}

/**
 * Get environment variables with enhanced PATH for spawning child processes.
 */
function getEnhancedEnv(extraEnv?: Record<string, string>): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    TERM: 'xterm-256color',
    ...extraEnv,
  }
}
import type {
  SaveASCApiKeyArgs,
  IOSBuildArgs,
  CheckASCApiKeyResult,
  IOSBuildInteractiveArgs,
} from '../schemas/deploy-schema'
import { PtyStateManager, type PtyState, type PromptDetectedEvent } from './pty-state-machine'
import { AppleSessionManager } from './apple-session-manager'
import { humanizePrompt } from './prompt-humanizer'

// Track active PTY processes
const activePtyProcesses = new Map<string, pty.IPty>()

// Track active PTY state managers for interactive builds
let activeInteractivePty: PtyStateManager | null = null

// Apple session manager instance
const appleSessionManager = new AppleSessionManager()

// Helper to send progress events to renderer
function sendProgressEvent(event: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(event, data)
    }
  })
}

// Helper to clean ANSI escape codes and control characters from output
// Converts line-overwrite sequences to newlines for readable logs
function cleanAnsi(text: string): string {
  return text
    // Convert carriage return to newline - \r means "go to start of line and overwrite"
    .replace(/\r/g, '\n')
    // Convert cursor-to-start + clear-line pattern to newline
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[1G\x1b\[0K/g, '\n')
    // Handle case where ESC is missing (sometimes happens in partial logs)
    .replace(/\[1G\[0K/g, '\n')
    // Remove spinner Unicode characters
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⇇⠏⠇⠏⠋★⚙︎✓✗✔✖⚪⚫]+/g, '')
    // Remove ANSI escape sequences (colors, cursor movement, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // Remove OSC sequences (title changes, hyperlinks, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Remove other escape sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[]/g, '')
    // Remove backspace characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x08]/g, '')
    // Replace double-escape sequences with newlines
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\x1b/g, '\n')
    // Clean up multiple consecutive newlines
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Extract ASC App ID from build logs and save to eas.json
 * This enables non-interactive auto-submit for future deployments
 */
async function extractAndSaveAscAppId(
  projectPath: string,
  output: string
): Promise<void> {
  // Match "ASC App ID: 1234567890" from EAS build output
  const ascAppIdMatch = output.match(/ASC App ID:\s*(\d+)/)
  if (!ascAppIdMatch) {
    return
  }

  const ascAppId = ascAppIdMatch[1]

  try {
    const easJsonPath = path.join(projectPath, 'eas.json')
    const easJsonContent = fs.readFileSync(easJsonPath, 'utf-8')
    const easConfig = JSON.parse(easJsonContent)

    // Check if ascAppId is already set
    if (easConfig.submit?.production?.ios?.ascAppId === ascAppId) {
      return
    }

    // Add ascAppId to submit profile
    if (!easConfig.submit) easConfig.submit = {}
    if (!easConfig.submit.production) easConfig.submit.production = {}
    if (!easConfig.submit.production.ios) easConfig.submit.production.ios = {}
    easConfig.submit.production.ios.ascAppId = ascAppId

    // Write updated eas.json
    fs.writeFileSync(easJsonPath, JSON.stringify(easConfig, null, 2))
    console.log(`[DeployHandler] Saved ASC App ID ${ascAppId} to eas.json`)
  } catch (error) {
    console.error('[DeployHandler] Failed to save ASC App ID:', error)
  }
}

// Helper to escape string for bash single quotes
function escapeForBash(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'"
}

// Get the path to the ASC keys directory
function getASCKeysDir(): string {
  return path.join(os.homedir(), '.bfloat-ide', 'keys', 'asc')
}

// Check if ASC API key is configured in eas.json
async function checkASCApiKeyConfig(projectPath: string): Promise<CheckASCApiKeyResult> {
  try {
    const easJsonPath = path.join(projectPath, 'eas.json')
    if (!fs.existsSync(easJsonPath)) {
      return { configured: false }
    }

    const easConfig = JSON.parse(fs.readFileSync(easJsonPath, 'utf-8'))

    // Check submit.production.ios for API key config
    const iosSubmitConfig = easConfig.submit?.production?.ios
    if (iosSubmitConfig?.ascApiKeyPath && iosSubmitConfig?.ascApiKeyId && iosSubmitConfig?.ascApiKeyIssuerId) {
      // Verify the key file exists
      const keyPath = iosSubmitConfig.ascApiKeyPath.replace(/^~/, os.homedir())
      if (fs.existsSync(keyPath)) {
        return {
          configured: true,
          keyId: iosSubmitConfig.ascApiKeyId,
          issuerId: iosSubmitConfig.ascApiKeyIssuerId,
          keyPath: iosSubmitConfig.ascApiKeyPath,
        }
      }
    }

    return { configured: false }
  } catch {
    return { configured: false }
  }
}

// Save ASC API key to ~/.bfloat-ide/keys/asc/ and update eas.json
async function saveASCApiKey(args: SaveASCApiKeyArgs): Promise<{ success: boolean; keyPath?: string; error?: string }> {
  const { projectPath, keyId, issuerId, keyContent } = args

  try {
    // Validate inputs
    if (!keyId || keyId.length < 10) {
      return { success: false, error: 'Invalid Key ID. It should be at least 10 characters.' }
    }

    if (!issuerId || !issuerId.includes('-')) {
      return { success: false, error: 'Invalid Issuer ID. It should be a UUID format.' }
    }

    if (!keyContent) {
      return { success: false, error: 'API key content is required.' }
    }

    // Decode base64 content
    let decodedKey: string
    try {
      decodedKey = Buffer.from(keyContent, 'base64').toString('utf-8')
    } catch {
      return { success: false, error: 'Invalid API key format. Could not decode.' }
    }

    // Validate it looks like a .p8 key
    if (!decodedKey.includes('-----BEGIN PRIVATE KEY-----')) {
      return { success: false, error: 'Invalid .p8 file. Must be a private key in PEM format.' }
    }

    // Create keys directory if it doesn't exist
    const keysDir = getASCKeysDir()
    fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 })

    // Save the key file with proper naming (AuthKey_{KEY_ID}.p8)
    const keyFileName = `AuthKey_${keyId}.p8`
    const keyFilePath = path.join(keysDir, keyFileName)
    fs.writeFileSync(keyFilePath, decodedKey, { mode: 0o600 })

    // Update eas.json with the key configuration
    const easJsonPath = path.join(projectPath, 'eas.json')
    let easConfig: Record<string, unknown> = {}

    if (fs.existsSync(easJsonPath)) {
      try {
        easConfig = JSON.parse(fs.readFileSync(easJsonPath, 'utf-8'))
      } catch {
        // Start fresh if parsing fails
      }
    }

    // Ensure structure exists
    if (!easConfig.submit) easConfig.submit = {}
    const submit = easConfig.submit as Record<string, unknown>
    if (!submit.production) submit.production = {}
    const production = submit.production as Record<string, unknown>
    if (!production.ios) production.ios = {}

    // Set iOS submit config with API key
    const ios = production.ios as Record<string, unknown>
    ios.ascApiKeyPath = `~/.bfloat-ide/keys/asc/${keyFileName}`
    ios.ascApiKeyId = keyId
    ios.ascApiKeyIssuerId = issuerId

    // Write updated config
    fs.writeFileSync(easJsonPath, JSON.stringify(easConfig, null, 2))

    return {
      success: true,
      keyPath: `~/.bfloat-ide/keys/asc/${keyFileName}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save API key',
    }
  }
}

export const registerDeployHandlers = (): void => {
  // Save App Store Connect API Key
  handle('deploy:save-asc-api-key', async (args: SaveASCApiKeyArgs) => {
    return saveASCApiKey(args)
  })

  // Check if App Store Connect API Key is configured
  handle('deploy:check-asc-api-key', async (args: { projectPath: string }) => {
    return checkASCApiKeyConfig(args.projectPath)
  })

  // Set environment variables for PTY session
  // Stores for the upcoming interactive deployment
  handle('deploy:set-pty-env-vars', async (args: { projectPath: string; envVars: Record<string, string> }) => {
    // Store for the PTY to use when spawning
    // The runDeployCommand handler will pick these up via the workbench store
    return { success: true }
  })

  // iOS build handler - runs the full build and submit process
  // Uses --non-interactive when API key is configured
  handle('deploy:ios-build', async (args: IOSBuildArgs) => {
    const { projectPath } = args

    return new Promise((resolve) => {
      let output = ''
      let hasResolved = false
      let buildUrl: string | undefined

      // Kill any existing process
      const existing = activePtyProcesses.get('ios-build')
      if (existing) {
        existing.kill()
        activePtyProcesses.delete('ios-build')
      }

      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash'

      // Check if API key is configured for non-interactive mode
      const apiKeyConfig = checkASCApiKeyConfig(projectPath)

      // Build command sequence
      const buildCommands = [
        `cd ${escapeForBash(projectPath)}`,
        '([ -d .git ] || git init)',
        'git add -A',
        'git commit -m "Configure for deployment" --allow-empty || true',
      ]

      // Use eas-cli directly with --non-interactive when API key is available
      apiKeyConfig.then((config) => {
        if (config.configured) {
          // Non-interactive build + submit with API key
          buildCommands.push('npx -y eas-cli build --platform ios --non-interactive --auto-submit')
        } else {
          // Fall back to testflight which handles interactive prompts
          buildCommands.push('npx -y testflight')
        }

        const command = buildCommands.join(' && ')

        try {
          const ptyProcess = pty.spawn(shell, ['-c', command], {
            name: 'xterm-256color',
            cols: 120,
            rows: 40,
            cwd: projectPath,
            env: getEnhancedEnv({ EAS_NO_VCS: '1' }),
          })

          activePtyProcesses.set('ios-build', ptyProcess)

          const resolveWith = (result: { success: boolean; buildUrl?: string; error?: string }) => {
            if (!hasResolved) {
              hasResolved = true
              ptyProcess.kill()
              activePtyProcesses.delete('ios-build')
              resolve(result)
            }
          }

          // Track build progress
          let currentStep: 'init' | 'credentials' | 'build' | 'submit' | 'complete' | 'error' = 'init'

          ptyProcess.onData((data) => {
            output += data
            const cleanOutput = cleanAnsi(output)
            const cleanData = cleanAnsi(data)

            // Append to logs (send raw data for xterm to render ANSI codes)
            sendProgressEvent('deploy:ios-build-log', { data })

            console.log('[DeployHandler] Build output:', cleanData.substring(0, 150))

            // Extract build URL if present
            const buildUrlMatch = cleanData.match(/https:\/\/expo\.dev\/.*\/builds\/[a-zA-Z0-9-]+/i)
            if (buildUrlMatch) {
              buildUrl = buildUrlMatch[0]
            }

            // Extract and save ASC App ID as soon as it appears in logs
            const ascAppIdMatch = cleanData.match(/ASC App ID:\s*(\d+)/)
            if (ascAppIdMatch && !hasResolved) {
              const ascAppId = ascAppIdMatch[1]
              extractAndSaveAscAppId(projectPath, output).catch((err) => {
                console.error('[DeployHandler] Failed to save ASC App ID:', err)
              })
            }

            // === Detect Progress Stages ===
            // Order matters: more specific patterns must be checked first

            // Complete - submission finished successfully
            if (/Submitted your app to Apple App Store Connect|binary has been successfully uploaded|available on TestFlight|Successfully submitted/i.test(cleanOutput)) {
              if (currentStep !== 'complete') {
                currentStep = 'complete'
                sendProgressEvent('deploy:ios-build-progress', {
                  step: 'complete',
                  message: 'Successfully submitted to TestFlight!',
                  percent: 100,
                  buildUrl,
                })
              }
            }

            // Submitting - active submission to Apple
            if (/Submitting your app to Apple App Store Connect|submission in progress|Submitting\.\.\.$/i.test(cleanData) && currentStep !== 'submit' && currentStep !== 'complete') {
              currentStep = 'submit'
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'submit',
                message: 'Submitting to App Store Connect...',
                percent: 85,
              })
            }

            // Waiting for submission - build finished, waiting for submission to start
            if (/Waiting for submission to complete/i.test(cleanData) && currentStep !== 'submit' && currentStep !== 'complete') {
              currentStep = 'waiting-submit'
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'submit',
                message: 'Waiting for submission to start...',
                percent: 75,
              })
            }

            // Build finished - build complete, preparing submission
            if (/Build finished/i.test(cleanData) && currentStep !== 'waiting-submit' && currentStep !== 'submit' && currentStep !== 'complete') {
              currentStep = 'build-finished'
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'build',
                message: 'Build finished, preparing submission...',
                percent: 65,
              })
            }

            // Build in progress - EAS is building the app
            if (/Build in progress\.\.\./i.test(cleanData) && currentStep !== 'build' && currentStep !== 'build-finished' && currentStep !== 'submit' && currentStep !== 'complete') {
              currentStep = 'build'
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'build',
                message: 'Building on EAS servers...',
                percent: 50,
              })
            }

            // Waiting for build - queued or waiting to start
            if (/Waiting in priority queue|Build queued|Waiting for build to complete/i.test(cleanData) && currentStep !== 'build' && currentStep !== 'complete') {
              if (currentStep !== 'waiting-build') {
                currentStep = 'waiting-build'
                sendProgressEvent('deploy:ios-build-progress', {
                  step: 'build',
                  message: 'Build queued, waiting to start...',
                  percent: 35,
                })
              }
            }

            // Uploading to EAS - uploading project files
            if (/Uploading to EAS/i.test(cleanData) && currentStep !== 'waiting-build' && currentStep !== 'build' && currentStep !== 'complete') {
              if (currentStep !== 'uploading') {
                currentStep = 'uploading'
                sendProgressEvent('deploy:ios-build-progress', {
                  step: 'upload',
                  message: 'Uploading to EAS Build...',
                  percent: 25,
                })
              }
            }

            // Initializing EAS project
            if (/Initializing|eas-cli init|Linking local|Linked to project/i.test(cleanData) && currentStep === 'init') {
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'init',
                message: 'Initializing EAS project...',
                percent: 5,
              })
            }

            // Setting up credentials
            if (/(Setting up|Fetching|Creating|Generating).*credentials|distribution certificate|provisioning profile/i.test(cleanData) && currentStep !== 'credentials' && currentStep !== 'uploading' && currentStep !== 'build' && currentStep !== 'complete') {
              currentStep = 'credentials'
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'credentials',
                message: 'Setting up credentials...',
                percent: 15,
              })
            }

            // Check for errors (but not in URLs or normal log messages)
            if (/command failed|FAILURE|Error:|error:/i.test(cleanData) && !/https?:\/\//.test(cleanData)) {
              const errorMatch = cleanData.match(/(?:Error:|error:)\s*(.+)/i)
              sendProgressEvent('deploy:ios-build-progress', {
                step: 'error',
                message: errorMatch?.[1]?.trim() || 'Build failed',
                percent: 0,
                error: errorMatch?.[1]?.trim() || 'Build failed',
              })
            }
          })

          ptyProcess.onExit(async ({ exitCode }) => {
            console.log(`[DeployHandler] Build PTY exited with code: ${exitCode}`)
            activePtyProcesses.delete('ios-build')

            if (!hasResolved) {
              const cleanOutput = cleanAnsi(output)
              const isSuccess = /available on TestFlight|Successfully submitted/i.test(cleanOutput)

              if (isSuccess || exitCode === 0) {
                // Extract and save ASC App ID from build logs for future deployments
                await extractAndSaveAscAppId(projectPath, output)
                resolveWith({ success: true, buildUrl })
              } else {
                const errorMatch = cleanOutput.match(/(?:Error:|error:)\s*(.+)/i)
                resolveWith({
                  success: false,
                  error: errorMatch?.[1]?.trim() || 'Build process failed',
                })
              }
            }
          })
        } catch (error) {
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start build process',
          })
        }
      })
    })
  })

  // Interactive iOS build with Apple ID credentials
  handle('deploy:ios-build-interactive', async (args: IOSBuildInteractiveArgs) => {
    console.log('[DeployHandler] ===== DEPLOY:IOS-BUILD-INTERACTIVE HANDLER CALLED =====')
    const { projectPath, appleId, password } = args

    return new Promise((resolve) => {
      let hasResolved = false
      let buildUrl: string | undefined
      let output = '' // Track accumulated output for ASC App ID extraction
      const pendingAppleId = appleId
      let pendingPassword = password
      const credentialsWereProvided = !!(appleId && password)

      // Kill any existing interactive process
      if (activeInteractivePty) {
        activeInteractivePty.kill()
        activeInteractivePty = null
      }

      // Create PTY state manager
      const ptyManager = new PtyStateManager({
        promptCheckDelay: 100,
        bufferSize: 2000,
        autoResponseThreshold: 0.8,
      })

      activeInteractivePty = ptyManager

      const resolveWith = (result: { success: boolean; buildUrl?: string; error?: string }) => {
        if (!hasResolved) {
          hasResolved = true
          ptyManager.kill()
          activeInteractivePty = null
          resolve(result)
        }
      }

      // Handle state changes
      ptyManager.on('state-change', (state: PtyState, _previousState: PtyState) => {
        console.log(`[DeployHandler] Interactive PTY state: ${state}`)

        // Map states to progress events
        const progressMap: Record<string, { step: string; message: string; percent: number }> = {
          running: { step: 'build', message: 'Building...', percent: 30 },
          waiting_apple_id: { step: 'credentials', message: 'Authenticating with Apple...', percent: 15 },
          waiting_password: { step: 'credentials', message: 'Authenticating with Apple...', percent: 18 },
          waiting_2fa: { step: 'credentials', message: 'Waiting for 2FA code...', percent: 20 },
          complete: { step: 'complete', message: 'Build complete!', percent: 100 },
          error: { step: 'error', message: 'Build failed', percent: 0 },
        }

        const progress = progressMap[state]
        if (progress) {
          sendProgressEvent('deploy:ios-build-progress', progress)
        }
      })

      // Helper to send terminal fallback event with humanized prompt
      const sendTerminalFallback = (event: PromptDetectedEvent) => {
        const rawContext = event.tail.slice(-500)
        const cleanContext = cleanAnsi(event.tail.slice(-200))
        let humanized = humanizePrompt(rawContext)

        // Ensure we always have a humanized prompt
        if (!humanized) {
          humanized = {
            title: event.type === 'password' ? 'Password Required' : 'Input Required',
            description: event.classification.suggestion || 'Please provide the requested input.',
            options: [
              { label: 'Continue (Enter)', value: '\n', recommended: true },
            ],
            rawPrompt: cleanContext,
          }
        }

        sendProgressEvent('deploy:ios-interactive-auth', {
          type: event.type,
          confidence: event.confidence,
          context: cleanContext,
          suggestion: event.classification.suggestion,
          humanized,
        })
      }

      // Handle prompt detection - auto-respond to routine prompts, only show UI when necessary
      ptyManager.on('prompt-detected', (event) => {
        console.log(`[DeployHandler] Prompt detected: ${event.type} (confidence: ${event.confidence})`)

        const tailText = cleanAnsi(event.tail)

        switch (event.type) {
          case 'apple_id': {
            // Auto-confirm if Apple ID was provided (it's already set in env vars)
            if (pendingAppleId) {
              console.log('[DeployHandler] Auto-confirming Apple ID prompt')
              ptyManager.write('\n') // Press enter to use the env var value
              ptyManager.clearBuffer()
            } else {
              // No Apple ID provided - this shouldn't happen in normal flow
              // Show UI as fallback
              sendTerminalFallback(event)
              ptyManager.clearBuffer()
            }
            break
          }

          case 'password':
            // Auto-inject password if available
            if (pendingPassword) {
              console.log('[DeployHandler] Auto-injecting password')
              ptyManager.write(pendingPassword + '\n')
              ptyManager.clearBuffer()
              pendingPassword = ''
            } else {
              // No password - show prompt (shouldn't happen in normal flow)
              sendTerminalFallback(event)
              ptyManager.clearBuffer()
            }
            break

          case '2fa':
            // 2FA ALWAYS requires user input - show UI
            sendProgressEvent('deploy:ios-interactive-auth', {
              type: '2fa',
              confidence: event.confidence,
              context: cleanAnsi(event.tail.slice(-200)),
              suggestion: 'Enter the 6-digit code from your trusted device',
            })
            ptyManager.clearBuffer()
            break

          case 'yes_no': {
            const isSessionRestoration = /Restoring session|session.*restored/i.test(tailText)

            // Skip session restoration messages (informational only)
            if (isSessionRestoration) {
              console.log('[DeployHandler] Skipping session restoration message')
              break
            }

            // Auto-confirm all yes/no prompts with 'yes' (the recommended action)
            // These are routine EAS prompts like:
            // - "Configure this project?" → yes
            // - "Do you want to log in to Apple?" → yes
            // - "Generate new credentials?" → yes
            // - "Reuse existing certificate?" → yes
            console.log('[DeployHandler] Auto-confirming yes/no prompt')
            ptyManager.write('y\n')
            ptyManager.clearBuffer()
            break
          }

          case 'menu': {
            // Auto-select the first/highlighted option for menu prompts
            // These are routine selections like:
            // - "Select a Provider" → use first (highlighted) option
            // - "Select a team" → use first option
            // - "Apple login menu" → select "Yes, sign in"
            console.log('[DeployHandler] Auto-selecting first menu option')
            ptyManager.write('\n') // Press enter to select highlighted option
            ptyManager.clearBuffer()
            break
          }

          case 'unknown': {
            // For unknown prompts with reasonable confidence, try to auto-continue
            if (event.confidence > 0.5) {
              // Check if it looks like a simple confirmation
              const looksLikeConfirmation = /press enter|continue|proceed|\(Y\/n\)|\[Y\/n\]/i.test(tailText)

              if (looksLikeConfirmation) {
                console.log('[DeployHandler] Auto-continuing unknown prompt (looks like confirmation)')
                ptyManager.write('\n')
                ptyManager.clearBuffer()
              } else {
                // Genuinely unknown - show UI as fallback
                const rawContext = event.tail.slice(-500)
                let humanized = humanizePrompt(rawContext)

                if (!humanized) {
                  humanized = {
                    title: 'Input Required',
                    description: 'The build process needs your input to continue.',
                    options: [
                      { label: 'Continue', value: '\n', recommended: true },
                      { label: 'Yes', value: 'y\n' },
                      { label: 'No', value: 'n\n' },
                    ],
                    rawPrompt: cleanAnsi(event.tail.slice(-200)),
                  }
                }

                sendProgressEvent('deploy:ios-interactive-auth', {
                  type: event.type,
                  confidence: event.confidence,
                  context: cleanAnsi(event.tail.slice(-200)),
                  suggestion: event.classification.suggestion,
                  humanized,
                })
                ptyManager.clearBuffer()
              }
            }
            break
          }
        }
      })

      // Forward log data
      let ascAppIdDetected = false // Track if we've already detected and saved ASC App ID
      ptyManager.on('data', (data) => {
        output += data // Accumulate output for ASC App ID extraction
        sendProgressEvent('deploy:ios-build-log', { data })

        // Check for build URL (can be in current chunk)
        const cleanData = cleanAnsi(data)
        const buildUrlMatch = cleanData.match(/https:\/\/expo\.dev\/.*\/builds\/[a-zA-Z0-9-]+/i)
        if (buildUrlMatch) {
          buildUrl = buildUrlMatch[0]
        }

        // Check for ASC App ID in accumulated output (pattern may span chunks)
        // Clean the output first to remove ANSI escape sequences
        const cleanedOutput = cleanAnsi(output)
        const ascAppIdMatch = cleanedOutput.match(/ASC App ID:\s*(\d+)/)
        if (ascAppIdMatch && !ascAppIdDetected) {
          console.log('[DeployHandler] Found ASC App ID, saving to eas.json')
          extractAndSaveAscAppId(projectPath, cleanedOutput).catch((err) => {
            console.error('[DeployHandler] Failed to save ASC App ID:', err)
          })
          ascAppIdDetected = true // Prevent repeated detection
        }

        // Check for success patterns
        if (/available on TestFlight|Successfully submitted|submission.*successful/i.test(cleanData)) {
          sendProgressEvent('deploy:ios-build-progress', {
            step: 'complete',
            message: 'Successfully submitted to TestFlight!',
            percent: 100,
            buildUrl,
          })
        }
      })

      // Handle exit
      ptyManager.on('exit', async (exitCode) => {
        console.log(`[DeployHandler] Interactive PTY exited with code: ${exitCode}`)
        const isSuccess = ptyManager.getState() === 'complete' || exitCode === 0

        if (isSuccess) {
          // Extract and save ASC App ID from build logs (fallback in case streaming detection missed it)
          await extractAndSaveAscAppId(projectPath, output)
          resolveWith({ success: true, buildUrl })
        } else {
          resolveWith({ success: false, error: 'Build process failed' })
        }
      })

      // Handle errors
      ptyManager.on('error', (error) => {
        console.error('[DeployHandler] Interactive PTY error:', error)
        resolveWith({ success: false, error: error.message })
      })

      // Build command
      const buildCommands = [
        `cd ${escapeForBash(projectPath)}`,
        '([ -d .git ] || git init)',
        'git add -A',
        'git commit -m "Configure for deployment" --allow-empty || true',
        'npx -y eas-cli build --platform ios --auto-submit',
      ]

      // Build environment with enhanced PATH and Apple credentials if provided
      const buildEnv: Record<string, string> = getEnhancedEnv({ EAS_NO_VCS: '1' })

      // Pass Apple credentials via environment variables to avoid interactive prompts
      if (appleId) {
        buildEnv.EXPO_APPLE_ID = appleId
        buildEnv.FASTLANE_USER = appleId
      }
      if (password) {
        buildEnv.EXPO_APPLE_PASSWORD = password
        buildEnv.FASTLANE_PASSWORD = password
      }

      // Start the build
      try {
        ptyManager.spawn('bash', ['-c', buildCommands.join(' && ')], {
          cwd: projectPath,
          env: buildEnv,
        })
      } catch (error) {
        resolveWith({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start build',
        })
      }
    })
  })

  // Submit 2FA code
  handle('deploy:submit-2fa', async (args: { code: string }) => {
    if (activeInteractivePty && activeInteractivePty.isWaiting()) {
      activeInteractivePty.write(args.code + '\n')
      activeInteractivePty.clearBuffer() // Clear buffer to prevent re-detecting the same prompt
      return { success: true }
    }
    return { success: false }
  })

  // Submit terminal input
  handle('deploy:submit-terminal-input', async (args: { input: string }) => {
    if (activeInteractivePty) {
      activeInteractivePty.write(args.input)
      activeInteractivePty.clearBuffer() // Clear buffer to prevent re-detecting the same prompt
      return { success: true }
    }
    return { success: false }
  })

  // Check Apple session status
  handle('deploy:check-apple-session', async (args: { appleId: string }) => {
    const session = appleSessionManager.checkSession(args.appleId)
    return {
      exists: session.exists,
      appleId: session.appleId,
      ageInDays: session.ageInDays,
      isValid: appleSessionManager.isSessionValid(session),
      statusMessage: appleSessionManager.getSessionStatusMessage(args.appleId),
    }
  })

  // Clear Apple session
  handle('deploy:clear-apple-session', async (args: { appleId?: string }) => {
    if (args.appleId) {
      const cleared = appleSessionManager.clearSession(args.appleId) ? 1 : 0
      return { success: cleared > 0, cleared }
    } else {
      const cleared = appleSessionManager.clearAllSessions()
      return { success: true, cleared }
    }
  })

  // List all Apple sessions - useful to check if user has valid credentials before prompting
  handle('deploy:list-apple-sessions', async () => {
    const sessions = appleSessionManager.listSessions()
    return {
      sessions: sessions.map((s) => ({
        exists: s.exists,
        appleId: s.appleId,
        ageInDays: s.ageInDays,
        isValid: appleSessionManager.isSessionValid(s),
        statusMessage: appleSessionManager.getSessionStatusMessage(s.appleId || ''),
      })),
      hasValidSession: sessions.some((s) => appleSessionManager.isSessionValid(s)),
    }
  })

  // Write Apple credentials to a temp file for secure deployment
  // Returns the path to the temp file
  handle('deploy:write-apple-creds-file', async (args: { appleId: string; password: string; projectPath?: string }) => {
    const { appleId, password, projectPath } = args
    const path = await import('path')
    const fs = await import('fs')

    let credsPath: string

    if (projectPath) {
      // Write credentials inside the project directory to avoid Claude permission issues
      // Use .bfloat-ide directory which is already gitignored
      const credsDir = path.join(projectPath, '.bfloat-ide', 'creds')
      fs.mkdirSync(credsDir, { recursive: true, mode: 0o700 })

      // Use a fixed filename that's gitignored
      const filename = 'ios-credentials.sh'
      credsPath = path.join(credsDir, filename)
    } else {
      // Fallback to home directory if no project path provided
      const os = await import('os')
      const credsDir = path.join(os.homedir(), '.bfloat-ide', 'temp', 'creds')
      fs.mkdirSync(credsDir, { recursive: true, mode: 0o700 })

      const filename = `ios-creds-${Date.now()}-${Math.random().toString(36).substring(7)}.sh`
      credsPath = path.join(credsDir, filename)
    }

    // Write credentials as shell export statements
    const content = `# Temporary iOS deployment credentials
# This file will be automatically deleted after deployment
export EXPO_APPLE_ID="${appleId}"
export EXPO_APPLE_PASSWORD="${password}"
export FASTLANE_USER="${appleId}"
export FASTLANE_PASSWORD="${password}"
`

    fs.writeFileSync(credsPath, content, { mode: 0o600 })

    return { success: true, path: credsPath }
  })

  // Delete a credentials file
  handle('deploy:delete-creds-file', async (args: { path: string }) => {
    const { path: credsPath } = args
    const fs = await import('fs')

    try {
      fs.unlinkSync(credsPath)
      return { success: true }
    } catch {
      // File might not exist, that's okay
      return { success: true }
    }
  })

  // Cancel build handler
  handle('deploy:cancel-build', async () => {
    // Kill any active build processes
    const buildProcess = activePtyProcesses.get('ios-build')
    if (buildProcess) {
      buildProcess.kill()
      activePtyProcesses.delete('ios-build')
    }

    // Kill interactive PTY if active
    if (activeInteractivePty) {
      activeInteractivePty.kill()
      activeInteractivePty = null
    }

    return { success: true }
  })
}

// Clean up PTY processes on app quit
export const cleanupDeployProcesses = (): void => {
  activePtyProcesses.forEach((process, id) => {
    try {
      console.log(`[DeployHandler] Cleaning up PTY: ${id}`)
      process.kill()
    } catch {
      // Ignore errors during cleanup
    }
  })
  activePtyProcesses.clear()

  if (activeInteractivePty) {
    try {
      activeInteractivePty.kill()
    } catch {
      // Ignore errors during cleanup
    }
    activeInteractivePty = null
  }
}
