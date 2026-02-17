/**
 * Background Deployment Runner
 *
 * Runs iOS deployment commands in a hidden terminal and reports progress
 * through callbacks. This allows for a clean progress UI without showing
 * the raw terminal output to users.
 */

import { createProgressTracker, type ProgressUpdate, type DeployStep } from './eas-output-parser'

/**
 * Extract ASC App ID from build logs and save to eas.json
 * This enables non-interactive auto-submit for future deployments
 */
async function extractAndSaveAscAppId(projectPath: string, logs: string): Promise<void> {
  // Match "ASC App ID: 1234567890" from EAS build output
  const ascAppIdMatch = logs.match(/ASC App ID:\s*(\d+)/)
  if (!ascAppIdMatch) return

  const ascAppId = ascAppIdMatch[1]

  try {
    const fs = await import('fs')
    const path = await import('path')
    const easJsonPath = path.join(projectPath, 'eas.json')

    // Read current eas.json
    const easJsonContent = fs.readFileSync(easJsonPath, 'utf-8')
    const easConfig = JSON.parse(easJsonContent)

    // Check if ascAppId is already set
    if (easConfig.submit?.production?.ios?.ascAppId === ascAppId) {
      return // Already configured
    }

    // Add ascAppId to submit profile
    if (!easConfig.submit) easConfig.submit = {}
    if (!easConfig.submit.production) easConfig.submit.production = {}
    if (!easConfig.submit.production.ios) easConfig.submit.production.ios = {}
    easConfig.submit.production.ios.ascAppId = ascAppId

    // Write updated eas.json
    fs.writeFileSync(easJsonPath, JSON.stringify(easConfig, null, 2))
    console.log(`[BackgroundDeploy] Saved ASC App ID to eas.json: ${ascAppId}`)
  } catch (error) {
    console.error('[BackgroundDeploy] Failed to save ASC App ID:', error)
  }
}

export interface DeploymentResult {
  success: boolean
  buildUrl?: string
  error?: string
  logs: string
}

export interface DeploymentCallbacks {
  onProgress: (update: ProgressUpdate) => void
  onLog?: (data: string) => void
  onComplete: (result: DeploymentResult) => void
}

/**
 * Run iOS deployment in a hidden terminal
 * Returns a cleanup function to cancel the deployment
 */
export async function runBackgroundDeployment(
  projectPath: string,
  callbacks: DeploymentCallbacks,
  options: {
    isFirstBuild?: boolean
  } = {}
): Promise<{ cancel: () => void }> {
  const { onProgress, onLog, onComplete } = callbacks
  const { isFirstBuild = false } = options

  const terminalId = `deploy-ios-bg-${Date.now()}`
  let logs = ''
  let buildUrl: string | undefined
  let hasError = false
  let isCancelled = false

  // Create progress tracker
  const trackProgress = createProgressTracker((update) => {
    if (isCancelled) return

    if (update.buildUrl) {
      buildUrl = update.buildUrl
    }

    if (update.step === 'error') {
      hasError = true
    }

    onProgress(update)
  })

  // Set up output listener FIRST (before creating terminal to avoid race condition)
  const handleData = (id: string, data: string) => {
    if (id !== terminalId || isCancelled) return

    logs += data
    onLog?.(data)
    trackProgress(data)
  }

  window.conveyor.terminal.onData(terminalId, handleData)

  try {
    // Create hidden terminal
    const createResult = await window.conveyor.terminal.create(terminalId, projectPath)

    if (!createResult.success) {
      throw new Error(createResult.error || 'Failed to create terminal')
    }

    // Build the deployment command
    const command = buildDeployCommand(projectPath, isFirstBuild)

    // Start the deployment
    onProgress({
      step: 'prepare',
      percent: 0,
      message: 'Starting deployment...',
    })

    // Run the command
    await window.conveyor.terminal.runCommand(terminalId, command)

    // Wait for completion with pattern detection
    const result = await waitForCompletion(logs, () => logs, buildUrl)

    // Extract and save ASC App ID from build logs for future non-interactive deployments
    if (result.success && !hasError) {
      await extractAndSaveAscAppId(projectPath, logs)
    }

    if (!isCancelled) {
      onComplete({
        success: result.success && !hasError,
        buildUrl: result.buildUrl || buildUrl,
        error: hasError ? result.error : undefined,
        logs,
      })
    }
  } catch (error) {
    if (!isCancelled) {
      onComplete({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        logs,
      })
    }
  } finally {
    // Cleanup
    try {
      window.conveyor.terminal.removeListeners(terminalId)
      window.conveyor.terminal.kill(terminalId)
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    cancel: () => {
      isCancelled = true
      try {
        window.conveyor.terminal.kill(terminalId)
      } catch {
        // Ignore
      }
    },
  }
}

/**
 * Build the deployment command based on project state
 */
function buildDeployCommand(projectPath: string, isFirstBuild: boolean): string {
  // Temporarily hide app.config.js so EAS can write to app.json
  // Keep it hidden until after build completes
  let command =
    `cd "${projectPath}" && ` +
    `mv app.config.js app.config.js.bak 2>/dev/null || true && ` +
    `([ -d .git ] || git init) && ` +
    `git add -A && ` +
    `git commit -m "Configure for deployment" --allow-empty || true`

  // Use eas build directly with --non-interactive flag
  command += ` && npx -y eas-cli build --platform ios --profile production --non-interactive --auto-submit`

  // Restore app.config.js after all EAS commands complete
  command += ` && mv app.config.js.bak app.config.js 2>/dev/null || true`

  return command
}

/**
 * Wait for the deployment to complete by monitoring output patterns
 */
async function waitForCompletion(
  initialLogs: string,
  getLogs: () => string,
  initialBuildUrl?: string
): Promise<{ success: boolean; buildUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    const successPatterns = [
      /available on TestFlight/i,
      /Successfully submitted/i,
      /submission.*successful/i,
      /Build finished/i,
    ]

    const errorPatterns = [
      /Build failed/i,
      /Submission failed/i,
      /Error:/i,
      /FAILURE/i,
    ]

    // Patterns that indicate we're in a queue/waiting state
    const queuePatterns = [
      /Waiting in Free tier queue/i,
      /Build queued/i,
      /Waiting for build to complete/i,
      /priority queue/i,
    ]

    const buildUrlPattern = /https:\/\/expo\.dev\/accounts\/[^\s]+\/builds\/[a-f0-9-]+/i

    let buildUrl = initialBuildUrl
    let checkCount = 0
    let lastLogLength = initialLogs.length
    let staleCount = 0

    // Timeouts: longer for queued state, shorter for stale state
    const MAX_CHECKS_QUEUED = 3600 // 60 minutes for queue wait
    const MAX_CHECKS_ACTIVE = 600 // 10 minutes for active build
    const MAX_STALE_CHECKS = 300 // 5 minutes without any output change

    const checkInterval = setInterval(() => {
      const currentLogs = getLogs()
      checkCount++

      // Track if logs are changing (progress being made)
      if (currentLogs.length === lastLogLength) {
        staleCount++
      } else {
        staleCount = 0 // Reset stale counter on any output change
        lastLogLength = currentLogs.length
      }

      // Detect if we're in queue state
      let isQueued = false
      for (const pattern of queuePatterns) {
        if (pattern.test(currentLogs)) {
          isQueued = true
          break
        }
      }

      // Use appropriate timeout based on state
      const maxChecks = isQueued ? MAX_CHECKS_QUEUED : MAX_CHECKS_ACTIVE

      // Extract build URL
      const urlMatch = currentLogs.match(buildUrlPattern)
      if (urlMatch) {
        buildUrl = urlMatch[0]
      }

      // Check for success
      for (const pattern of successPatterns) {
        if (pattern.test(currentLogs)) {
          clearInterval(checkInterval)
          resolve({ success: true, buildUrl })
          return
        }
      }

      // Check for error
      for (const pattern of errorPatterns) {
        if (pattern.test(currentLogs)) {
          clearInterval(checkInterval)
          const errorMatch = currentLogs.match(/(?:Error:|error:)\s*(.+)/i)
          resolve({
            success: false,
            buildUrl,
            error: errorMatch?.[1]?.trim() || 'Deployment failed',
          })
          return
        }
      }

      // Stale timeout - no output for too long (but not during queue wait)
      if (!isQueued && staleCount >= MAX_STALE_CHECKS) {
        clearInterval(checkInterval)
        if (buildUrl) {
          // We have a build URL, user can check status on Expo dashboard
          resolve({
            success: true,
            buildUrl,
          })
        } else {
          resolve({
            success: false,
            error: 'Deployment appears stuck - no output for 5 minutes',
          })
        }
        return
      }

      // Overall timeout
      if (checkCount >= maxChecks) {
        clearInterval(checkInterval)
        // If we have a build URL, consider it a partial success
        if (buildUrl) {
          resolve({
            success: true,
            buildUrl,
          })
        } else {
          resolve({
            success: false,
            error: isQueued
              ? 'Queue wait exceeded 60 minutes - check Expo dashboard for status'
              : 'Deployment timed out',
          })
        }
      }
    }, 1000)
  })
}

/**
 * Run a quick credential check command
 * Returns true if credentials are already set up on EAS
 */
export async function checkCredentialsExist(projectPath: string): Promise<boolean> {
  const terminalId = `check-creds-${Date.now()}`
  let output = ''

  // Set up output listener FIRST (before creating terminal to avoid race condition)
  window.conveyor.terminal.onData(terminalId, (id, data) => {
    if (id === terminalId) {
      output += data
    }
  })

  try {
    const result = await window.conveyor.terminal.create(terminalId, projectPath)

    if (!result.success) {
      return false
    }

    // Run credentials check command
    await window.conveyor.terminal.runCommand(
      terminalId,
      'npx -y eas-cli credentials --platform ios --json 2>/dev/null || echo "NO_CREDENTIALS"'
    )

    // Wait a moment for output
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check if credentials exist
    return !output.includes('NO_CREDENTIALS') && !output.includes('No credentials')
  } catch {
    return false
  } finally {
    try {
      window.conveyor.terminal.removeListeners(terminalId)
      window.conveyor.terminal.kill(terminalId)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get the step label for display
 */
export function getStepLabel(step: DeployStep): string {
  const labels: Record<DeployStep, string> = {
    prepare: 'Preparing project',
    upload: 'Uploading to EAS',
    queued: 'Waiting in queue',
    build: 'Building iOS app',
    submit: 'Submitting to TestFlight',
    processing: 'App Store processing',
    complete: 'Complete',
    error: 'Error',
  }
  return labels[step] || step
}
