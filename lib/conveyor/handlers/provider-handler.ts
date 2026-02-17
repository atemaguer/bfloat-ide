import { handle } from '@/lib/main/shared'
import os from 'os'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import http from 'http'
import * as pty from 'node-pty'
import { spawn, type ChildProcess } from 'child_process'
import { app, dialog, BrowserWindow } from 'electron'
import { getShellPaths, isBundledShellAvailable } from '@/lib/platform/shell'
import { parseClaudeSetupOutput } from './claude-auth-agent'

/**
 * Provider Handler
 *
 * Manages authentication for AI providers by reading from their CLI config files:
 * - Claude: Reads from ~/.claude.json, uses bundled Claude Code CLI (fallbacks to npx)
 * - Codex/OpenAI: Reads from ~/.codex/auth.json, uses SDK's bundled codex binary for login
 * - Expo: Uses direct API calls (same as expo-cli internally)
 *
 * Integration state (enabled/disabled) is stored in ~/.bfloat-ide/config/settings.json
 */

// ============================================================================
// Configuration Paths
// ============================================================================

const CLAUDE_CONFIG_PATH = path.join(os.homedir(), '.claude.json')
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const CLAUDE_CREDENTIALS_PATH = path.join(CLAUDE_CONFIG_DIR, '.credentials.json')
const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex')
const CODEX_AUTH_PATH = path.join(DEFAULT_CODEX_HOME, 'auth.json')
const EXPO_STATE_PATH = path.join(os.homedir(), '.expo', 'state.json')
const BFLOAT_CONFIG_DIR = path.join(os.homedir(), '.bfloat-ide', 'config')
const SETTINGS_PATH = path.join(BFLOAT_CONFIG_DIR, 'settings.json')

const DEFAULT_CLAUDE_SCOPES = ['org:create_api_key', 'user:profile', 'user:inference']

// OpenAI OAuth constants (same as codex CLI / opencode)
const OPENAI_ISSUER = 'https://auth.openai.com'
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_OAUTH_PORT = 1455

// ============================================================================
// CLI Resolution Helpers
// ============================================================================

interface ResolvedCli {
  command: string
  argsPrefix: string[]
  env?: NodeJS.ProcessEnv
}

function resolvePackageDir(packageName: string): string | null {
  const parts = packageName.startsWith('@') ? packageName.split('/').slice(0, 2) : [packageName]
  const packagePath = path.join(...parts)
  const resourcesPath = process.resourcesPath || ''

  const roots = [
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules'),
    path.join(resourcesPath, 'app.asar', 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
  ]

  for (const root of roots) {
    const candidate = path.join(root, packagePath)
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
  }

  return null
}

function resolvePackageBin(packageName: string): string | null {
  const packageDir = resolvePackageDir(packageName)
  if (!packageDir) return null

  const pkgPath = path.join(packageDir, 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      bin?: string | Record<string, string>
    }
    const bin = pkg.bin
    let relBin: string | undefined

    if (typeof bin === 'string') {
      relBin = bin
    } else if (bin && typeof bin === 'object') {
      relBin = bin.claude || bin['claude-code'] || Object.values(bin)[0]
    }

    if (!relBin) return null
    const binPath = path.isAbsolute(relBin) ? relBin : path.join(packageDir, relBin)
    return fs.existsSync(binPath) ? binPath : null
  } catch {
    return null
  }
}

/**
 * Create (or refresh) a tiny Node.js preload script that patches
 * `process.stdin` to look like a TTY.  Ink (the React-based terminal UI
 * framework used by Claude Code) calls `process.stdin.setRawMode(true)` during
 * initialisation.  When stdin is a pipe (non-TTY) — which is always the case
 * when spawned via `child_process.spawn` — Ink throws:
 *
 *   "Raw mode is not supported on the current process.stdin"
 *
 * By preloading this script with Node's `-r` flag the patch runs *before* Ink
 * initialises, so the raw-mode check passes harmlessly.
 */
function ensureStdinTtyPatch(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const patchDir = path.join(os.homedir(), '.bfloat-ide')
    if (!fs.existsSync(patchDir)) fs.mkdirSync(patchDir, { recursive: true })
    const patchPath = path.join(patchDir, 'stdin-tty-patch.js')
    const patchCode = [
      '// Bfloat IDE – fake TTY on stdin so Ink does not crash in piped mode',
      "Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });",
      'process.stdin.setRawMode = function () { return process.stdin; };',
      '',
    ].join('\n')
    fs.writeFileSync(patchPath, patchCode, 'utf-8')
    return patchPath
  } catch {
    return null
  }
}

function findClaudeCli(): ResolvedCli | null {
  const binPath = resolvePackageBin('@anthropic-ai/claude-code')
  if (!binPath) return null

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }

  if (process.platform === 'win32') {
    const stdinPatch = ensureStdinTtyPatch()
    if (stdinPatch) {
      // Use -r to preload the stdin patch before the CLI script loads.
      // This keeps process.argv intact: argv[1] = binPath, argv[2+] = CLI args.
      return {
        command: process.execPath,
        argsPrefix: ['-r', stdinPatch, binPath],
        env,
      }
    }
  }

  return {
    command: process.execPath,
    argsPrefix: [binPath],
    env,
  }
}

function ensureUnpackedPath(filePath: string): string {
  if (!filePath.includes('app.asar')) return filePath
  return filePath.replace('app.asar', 'app.asar.unpacked')
}

function ensureExecutable(filePath: string): void {
  if (process.platform === 'win32') return
  try {
    const stats = fs.statSync(filePath)
    const nextMode = stats.mode | 0o111
    if (nextMode !== stats.mode) {
      fs.chmodSync(filePath, nextMode)
    }
  } catch {
    // Best effort only; if chmod fails we'll let the spawn attempt surface the error.
  }
}

/**
 * Resolve a user-selected bash path, handling git-bash.exe selection
 */
function resolveGitBashPath(candidate: string): string | null {
  if (!candidate) return null
  const cleaned = candidate.trim().replace(/^"+|"+$/g, '')
  if (!cleaned) return null

  const normalized = path.normalize(cleaned)
  const baseName = path.basename(normalized).toLowerCase()
  const exists = (value: string) => {
    try {
      return fs.existsSync(value)
    } catch {
      return false
    }
  }

  if (baseName === 'bash.exe' || baseName === 'sh.exe') {
    return exists(normalized) ? normalized : null
  }

  if (baseName === 'git-bash.exe' && exists(normalized)) {
    const root = path.dirname(normalized)
    const candidates = [path.join(root, 'usr', 'bin', 'bash.exe'), path.join(root, 'bin', 'bash.exe')]
    for (const candidatePath of candidates) {
      if (exists(candidatePath)) {
        return candidatePath
      }
    }
  }

  return null
}

/**
 * Find bash path for Windows - uses bundled MinGit or user-configured path
 */
function findGitBashPath(): string | null {
  if (process.platform !== 'win32') return null

  // First check for user-stored or environment-configured path
  const storedPath = getStoredGitBashPath()
  if (storedPath && fs.existsSync(storedPath)) {
    return storedPath
  }

  const envPath = process.env.CLAUDE_CODE_GIT_BASH_PATH || process.env.GIT_BASH_PATH
  if (envPath) {
    const resolved = resolveGitBashPath(envPath)
    if (resolved) return resolved
  }

  // Use bundled or system shell from platform module
  const shellPaths = getShellPaths()
  if (fs.existsSync(shellPaths.bash)) {
    return shellPaths.bash
  }

  return null
}

function ensureClaudeWindowsEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv | undefined {
  if (process.platform !== 'win32') return env

  const bashPath = findGitBashPath()
  if (!bashPath) return env

  return {
    ...(env || {}),
    CLAUDE_CODE_GIT_BASH_PATH: bashPath,
  }
}

function getClaudeWindowsMissingGitBashMessage(): string {
  if (isBundledShellAvailable()) {
    // This shouldn't happen if bundled shell is working correctly
    return 'Bundled bash is configured but not accessible. Please restart the application.'
  }
  return [
    'Bash not found. Install Git for Windows (https://git-scm.com/download/win)',
    'or select your bash.exe in the Connect dialog.',
  ].join(' ')
}

function broadcastProviderAuthOutput(provider: 'anthropic' | 'openai', data: string): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  window.webContents.send('provider:auth-output', { provider, data })
}

function buildCodexEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(process.env as { [key: string]: string }),
  }

  const codexHome = getCodexHomeDir()
  if (codexHome) {
    env.CODEX_HOME = codexHome
    process.env.CODEX_HOME = codexHome
    if (!fs.existsSync(codexHome)) {
      fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 })
    }
  }

  if (!env.HOME) {
    env.HOME = os.homedir()
  }

  if (process.platform === 'win32' && !env.USERPROFILE) {
    env.USERPROFILE = os.homedir()
  }

  if (env.CODEX_API_KEY) delete env.CODEX_API_KEY
  if (env.OPENAI_API_KEY) delete env.OPENAI_API_KEY

  return env
}

function formatCliOutput(output?: string | null, lineCount = 6): string | undefined {
  if (!output) return undefined
  const trimmed = output.trim()
  if (!trimmed) return undefined
  const lines = trimmed.split(/\r?\n/)
  const lastLines = lines.slice(-lineCount).join('\n')
  return lastLines.trim() || undefined
}

/**
 * Find the Codex binary from the SDK's vendor directory.
 *
 * On ARM64 Windows, the native aarch64 binary often fails with
 * STATUS_DLL_NOT_FOUND (0xC0000135) because the ARM64 Visual C++
 * Redistributable is not installed.  We search for both the native
 * arch binary and the x64 binary as a fallback — x64 runs seamlessly
 * via Windows' built-in x64 emulation and x64 VC++ runtimes are
 * almost always present.
 */
function findCodexBinary(): string {
  const platform = process.platform
  const arch = process.arch

  // Map Node.js arch/platform to Codex SDK's vendor paths
  const platformMap: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  }

  const key = `${platform}-${arch}`
  const vendorPath = platformMap[key]

  if (!vendorPath) {
    console.warn(`[Provider Handler] Unsupported platform: ${key}`)
    return 'codex' // Fallback to PATH
  }

  // On ARM64 Windows, prefer the x64 binary.  The native ARM64 binary
  // often crashes with STATUS_DLL_NOT_FOUND (0xC0000135) because the
  // ARM64 Visual C++ Redistributable is rarely pre-installed.  The x64
  // binary runs seamlessly via Windows' x64 emulation layer and the x64
  // VC++ runtime is virtually always present.
  const vendorPaths: string[] = []
  if (platform === 'win32' && arch === 'arm64') {
    vendorPaths.push(platformMap['win32-x64'])
  }
  vendorPaths.push(vendorPath)

  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex'

  const sdkDir = resolvePackageDir('@openai/codex-sdk')

  for (const vp of vendorPaths) {
    const sdkPaths = [
      // Resolved package dir (handles app.asar/app.asar.unpacked)
      sdkDir
        ? ensureUnpackedPath(path.join(sdkDir, 'vendor', vp, 'codex', binaryName))
        : null,
      // Packaged: app.asar.unpacked
      path.join(
        process.resourcesPath || '',
        'app.asar.unpacked',
        'node_modules',
        '@openai',
        'codex-sdk',
        'vendor',
        vp,
        'codex',
        binaryName
      ),
      // Production: __dirname is out/main, go up 2 levels
      ensureUnpackedPath(
        path.join(__dirname, '..', '..', 'node_modules', '@openai', 'codex-sdk', 'vendor', vp, 'codex', binaryName)
      ),
      // Development: from cwd
      path.join(process.cwd(), 'node_modules', '@openai', 'codex-sdk', 'vendor', vp, 'codex', binaryName),
    ].filter((candidate): candidate is string => Boolean(candidate))

    for (const p of sdkPaths) {
      if (fs.existsSync(p)) {
        ensureExecutable(p)
        console.log(`[Provider Handler] Found Codex binary at: ${p} (vendor: ${vp})`)
        return p
      }
    }
  }

  console.warn('[Provider Handler] Codex binary not found, falling back to PATH')
  return 'codex'
}

// ============================================================================
// Types
// ============================================================================

interface ClaudeOAuthAccount {
  accountUuid: string
  emailAddress: string
  organizationUuid?: string
}

interface ClaudeConfig {
  oauthAccount?: ClaudeOAuthAccount
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string | null
    expiresAt?: number | null
    scopes?: string[]
    subscriptionType?: string | null
    rateLimitTier?: string | null
  }
  // API keys set via `claude setup-token` command
  apiKey?: string
  anthropicApiKey?: string
  // Long-lived OAuth token from `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN)
  oauthToken?: string
}

interface OAuthTokens {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  scopes?: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
}

interface CodexAuthFile {
  tokens?: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    account_id?: string
  }
  last_refresh?: string
}

interface ExpoStateFile {
  auth?: {
    sessionSecret?: string
    userId?: string
    username?: string
    currentConnection?: string
  }
}

interface BfloatSettings {
  integrations?: {
    anthropic?: {
      enabled: boolean
      connectedAt?: number
      accountId?: string
    }
    openai?: {
      enabled: boolean
      connectedAt?: number
      accountId?: string
    }
    expo?: {
      enabled: boolean
      connectedAt?: number
      userId?: string
      username?: string
    }
  }
  cli?: {
    gitBashPath?: string
  }
}

function getCodexHomeDir(): string {
  const envHome = process.env.CODEX_HOME
  return envHome && envHome.trim() ? envHome : DEFAULT_CODEX_HOME
}

function getCodexAuthPath(): string {
  return path.join(getCodexHomeDir(), 'auth.json')
}

function getCodexAuthPathCandidates(): string[] {
  const candidates = new Set<string>()
  candidates.add(getCodexAuthPath())
  candidates.add(path.join(os.homedir(), '.codex', 'auth.json'))
  if (process.env.APPDATA) {
    candidates.add(path.join(process.env.APPDATA, 'codex', 'auth.json'))
  }
  if (process.env.LOCALAPPDATA) {
    candidates.add(path.join(process.env.LOCALAPPDATA, 'codex', 'auth.json'))
  }
  if (process.env.USERPROFILE) {
    candidates.add(path.join(process.env.USERPROFILE, '.codex', 'auth.json'))
  }
  return Array.from(candidates)
}

// ============================================================================
// Settings Management
// ============================================================================

function ensureConfigDir(): void {
  if (!fs.existsSync(BFLOAT_CONFIG_DIR)) {
    fs.mkdirSync(BFLOAT_CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

function loadSettings(): BfloatSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return {}
    }
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

function saveSettings(settings: BfloatSettings): void {
  ensureConfigDir()
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

function getStoredGitBashPath(): string | null {
  const settings = loadSettings()
  const storedPath = settings.cli?.gitBashPath
  if (!storedPath) return null
  try {
    return fs.existsSync(storedPath) ? storedPath : null
  } catch {
    return null
  }
}

function saveGitBashPath(gitBashPath: string): void {
  const settings = loadSettings()
  settings.cli = {
    ...settings.cli,
    gitBashPath,
  }
  saveSettings(settings)
}

function ensureClaudeConfigDir(): void {
  if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
    fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

function readClaudeCredentials(): ClaudeCredentialsFile | null {
  try {
    if (!fs.existsSync(CLAUDE_CREDENTIALS_PATH)) {
      return null
    }
    const content = fs.readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8')
    return JSON.parse(content) as ClaudeCredentialsFile
  } catch {
    return null
  }
}

function writeClaudeCredentials(credentials: ClaudeCredentialsFile): void {
  ensureClaudeConfigDir()
  fs.writeFileSync(CLAUDE_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

/**
 * Clear all Claude authentication state.
 * This removes:
 * 1. oauthAccount from ~/.claude.json
 * 2. oauthToken from ~/.claude/.credentials.json
 *
 * After calling this, the user will need to go through the full auth flow again.
 */
function clearClaudeAuthState(): void {
  console.log('[Provider Handler] Clearing Claude auth state')

  // Clear oauthAccount from ~/.claude.json
  try {
    if (fs.existsSync(CLAUDE_CONFIG_PATH)) {
      const content = fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf-8')
      const config = JSON.parse(content) as Record<string, unknown>
      if (config.oauthAccount) {
        delete config.oauthAccount
        fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), {
          encoding: 'utf-8',
          mode: 0o600,
        })
        console.log('[Provider Handler] Removed oauthAccount from ~/.claude.json')
      }
    }
  } catch (error) {
    console.error('[Provider Handler] Failed to clear oauthAccount:', error)
  }

  // Clear oauthToken from ~/.claude/.credentials.json
  try {
    if (fs.existsSync(CLAUDE_CREDENTIALS_PATH)) {
      const credentials = readClaudeCredentials()
      if (credentials?.oauthToken) {
        delete credentials.oauthToken
        writeClaudeCredentials(credentials)
        console.log('[Provider Handler] Removed oauthToken from ~/.claude/.credentials.json')
      }
    }
  } catch (error) {
    console.error('[Provider Handler] Failed to clear oauthToken:', error)
  }
}

function ensureCodexDir(): void {
  const codexDir = path.dirname(getCodexAuthPath())
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 })
  }
}

function readCodexAuthFile(): CodexAuthFile | null {
  try {
    for (const candidate of getCodexAuthPathCandidates()) {
      if (!fs.existsSync(candidate)) continue
      const content = fs.readFileSync(candidate, 'utf-8')
      return JSON.parse(content) as CodexAuthFile
    }
    return null
  } catch {
    return null
  }
}

function writeCodexAuthFile(auth: CodexAuthFile): void {
  ensureCodexDir()
  fs.writeFileSync(getCodexAuthPath(), JSON.stringify(auth, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

// ============================================================================
// OpenAI Browser OAuth Flow (PKCE — no native binary needed)
// ============================================================================

/**
 * Parse JWT payload without verifying the signature (we only need claims).
 */
function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    return null
  }
}

/**
 * Extract the ChatGPT account ID from an id_token or access_token.
 */
function extractOpenAIAccountId(tokens: {
  id_token?: string
  access_token?: string
}): string | undefined {
  for (const jwt of [tokens.id_token, tokens.access_token]) {
    if (!jwt) continue
    const claims = parseJwtClaims(jwt)
    if (!claims) continue
    const authClaim = claims['https://api.openai.com/auth'] as
      | Record<string, unknown>
      | undefined
    const accountId =
      (claims['chatgpt_account_id'] as string | undefined) ||
      (authClaim?.['chatgpt_account_id'] as string | undefined) ||
      ((claims['organizations'] as Array<{ id: string }> | undefined)?.[0]?.id)
    if (accountId) return accountId
  }
  return undefined
}

/** PKCE helpers */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = generateRandomString(43)
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function generateState(): string {
  return base64UrlEncode(crypto.randomBytes(32))
}

/**
 * Perform the OpenAI browser-based OAuth flow with PKCE.
 * This avoids spawning the native codex binary which requires the VC++ runtime.
 *
 * Flow:
 * 1. Generate PKCE verifier/challenge + random state
 * 2. Start a local HTTP callback server on port 1455
 * 3. Open auth.openai.com/oauth/authorize in the browser — user just logs in
 * 4. OpenAI redirects to localhost:1455/auth/callback?code=...&state=...
 * 5. Exchange code for tokens, write to ~/.codex/auth.json
 */
async function connectOpenAIBrowserAuth(
  onOutput: (data: string) => void
): Promise<{ success: boolean; exitCode: number; output: string }> {
  writeDiagnosticLog('Starting OpenAI browser OAuth flow (PKCE)')

  const pkce = generatePKCE()
  const state = generateState()
  const redirectUri = `http://localhost:${OPENAI_OAUTH_PORT}/auth/callback`

  // Build the authorization URL
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'bfloat',
  })
  const authUrl = `${OPENAI_ISSUER}/oauth/authorize?${authParams.toString()}`

  return new Promise((resolve) => {
    let resolved = false
    let server: http.Server | null = null

    const finish = (result: { success: boolean; exitCode: number; output: string }) => {
      if (resolved) return
      resolved = true
      if (server) {
        server.close()
        server = null
      }
      if (timeoutTimer) clearTimeout(timeoutTimer)
      resolve(result)
    }

    // 5 minute timeout
    const timeoutTimer = setTimeout(() => {
      const msg = 'Authentication timed out. Please try again.'
      writeDiagnosticLog(msg)
      onOutput(msg + '\n')
      finish({ success: false, exitCode: 1, output: msg })
    }, 5 * 60 * 1000)

    // Start a local HTTP server to receive the OAuth callback
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${OPENAI_OAUTH_PORT}`)

      if (url.pathname !== '/auth/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const msg = errorDescription || error
        writeDiagnosticLog(`OAuth error: ${msg}`)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>Authorization Failed</h2><p>You can close this tab.</p></body></html>')
        onOutput(`Authorization error: ${msg}\n`)
        finish({ success: false, exitCode: 1, output: msg })
        return
      }

      if (!code || returnedState !== state) {
        const msg = !code ? 'Missing authorization code' : 'Invalid state — potential CSRF attack'
        writeDiagnosticLog(`OAuth validation failed: ${msg}`)
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>Authorization Failed</h2><p>You can close this tab.</p></body></html>')
        onOutput(`${msg}\n`)
        finish({ success: false, exitCode: 1, output: msg })
        return
      }

      // Show success page and redirect back to the app via deep link
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        '<html><body style="background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui">' +
          '<div style="text-align:center"><h2 style="color:#4ade80">Authorized!</h2><p>Redirecting back to Bfloat...</p></div>' +
          '<script>window.location.href="bfloat://oauth-success?message=ChatGPT+connected+successfully";setTimeout(()=>window.close(),3000)</script></body></html>'
      )

      // Exchange the authorization code for tokens
      writeDiagnosticLog('OAuth callback received, exchanging code for tokens')
      onOutput('Authorization received, exchanging tokens...\n')

      try {
        const tokenRes = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: OPENAI_CLIENT_ID,
            code_verifier: pkce.verifier,
          }).toString(),
        })

        if (!tokenRes.ok) {
          const body = await tokenRes.text().catch(() => '')
          const msg = `Token exchange failed (HTTP ${tokenRes.status}): ${body}`
          writeDiagnosticLog(msg)
          onOutput(msg + '\n')
          finish({ success: false, exitCode: 1, output: msg })
          return
        }

        const tokens = (await tokenRes.json()) as {
          id_token?: string
          access_token: string
          refresh_token: string
          expires_in?: number
        }

        writeDiagnosticLog('Token exchange successful')
        onOutput('Authentication successful!\n')

        // Write tokens to ~/.codex/auth.json (same format as codex CLI)
        const accountId = extractOpenAIAccountId(tokens)
        const authFile: CodexAuthFile = {
          tokens: {
            id_token: tokens.id_token,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            account_id: accountId,
          },
          last_refresh: new Date().toISOString(),
        }
        writeCodexAuthFile(authFile)
        writeDiagnosticLog(`Tokens saved to ${getCodexAuthPath()}`)

        finish({ success: true, exitCode: 0, output: 'Authentication successful!' })
      } catch (err) {
        const msg = `Token exchange error: ${err instanceof Error ? err.message : err}`
        writeDiagnosticLog(msg)
        onOutput(msg + '\n')
        finish({ success: false, exitCode: 1, output: msg })
      }
    })

    server.on('error', (err) => {
      const msg = `Failed to start OAuth callback server: ${err.message}`
      writeDiagnosticLog(msg)
      onOutput(msg + '\n')
      finish({ success: false, exitCode: 1, output: msg })
    })

    server.listen(OPENAI_OAUTH_PORT, '127.0.0.1', () => {
      writeDiagnosticLog(`OAuth callback server listening on port ${OPENAI_OAUTH_PORT}`)
      onOutput('Opening browser for authentication...\n')
      // Broadcast the auth URL so ProviderAuthModal auto-opens the browser
      onOutput(`${authUrl}\n`)
    })
  })
}

function saveClaudeTokens(tokens: OAuthTokens): void {
  if (!tokens.accessToken) {
    throw new Error('Missing Claude access token')
  }

  const scopes = tokens.scopes && tokens.scopes.length > 0 ? tokens.scopes : DEFAULT_CLAUDE_SCOPES
  const existing = readClaudeCredentials() || {}
  existing.claudeAiOauth = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt ?? null,
    scopes,
    subscriptionType: tokens.subscriptionType ?? null,
    rateLimitTier: tokens.rateLimitTier ?? null,
  }
  writeClaudeCredentials(existing)
}

function saveCodexTokens(tokens: OAuthTokens): void {
  if (!tokens.refreshToken) {
    throw new Error('Missing Codex refresh token')
  }

  const existing = readCodexAuthFile() || {}
  const existingTokens = existing.tokens || {}

  const nextAuth: CodexAuthFile = {
    ...existing,
    tokens: {
      ...existingTokens,
      access_token: tokens.accessToken ?? existingTokens.access_token,
      refresh_token: tokens.refreshToken,
      account_id: tokens.accountId ?? existingTokens.account_id,
    },
    last_refresh: new Date().toISOString(),
  }

  writeCodexAuthFile(nextAuth)
}

// ============================================================================
// Auth Checking Functions
// ============================================================================

/**
 * Check if Claude Code is authenticated by reading ~/.claude.json
 */
function checkClaudeAuth(): {
  authenticated: boolean
  providers: string[]
  account?: ClaudeOAuthAccount
} {
  try {
    let config: ClaudeConfig | null = null
    if (fs.existsSync(CLAUDE_CONFIG_PATH)) {
      try {
        const configContent = fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf-8')
        config = JSON.parse(configContent) as ClaudeConfig
      } catch {
        config = null
      }
    }

    const credentials = readClaudeCredentials()
    const hasOauthToken = Boolean(credentials?.claudeAiOauth?.accessToken)
    const hasAccount = Boolean(config?.oauthAccount?.accountUuid)
    // Also check for API keys set via `claude setup-token` command
    const hasApiKey = Boolean(credentials?.apiKey || credentials?.anthropicApiKey)
    // Check for long-lived OAuth token from `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN)
    const hasSetupToken = Boolean(credentials?.oauthToken)
    // Check for ANTHROPIC_API_KEY environment variable
    const hasEnvApiKey = Boolean(process.env.ANTHROPIC_API_KEY)

    if (hasOauthToken || hasAccount || hasApiKey || hasSetupToken || hasEnvApiKey) {
      return {
        authenticated: true,
        providers: ['anthropic'],
        account: config?.oauthAccount,
      }
    }

    return { authenticated: false, providers: [] }
  } catch {
    return { authenticated: false, providers: [] }
  }
}

/**
 * Check if Codex is authenticated by reading ~/.codex/auth.json
 */
function checkCodexAuth(): {
  authenticated: boolean
  accessToken?: string
  refreshToken?: string
  accountId?: string
} {
  try {
    const auth = readCodexAuthFile()
    if (!auth) {
      return { authenticated: false }
    }

    if (auth.tokens?.refresh_token) {
      return {
        authenticated: true,
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        accountId: auth.tokens.account_id,
      }
    }

    return { authenticated: false }
  } catch {
    return { authenticated: false }
  }
}

/**
 * Check if Expo/EAS CLI is authenticated by reading ~/.expo/state.json
 */
function checkExpoAuth(): {
  authenticated: boolean
  userId?: string
  username?: string
} {
  try {
    if (!fs.existsSync(EXPO_STATE_PATH)) {
      return { authenticated: false }
    }

    const content = fs.readFileSync(EXPO_STATE_PATH, 'utf-8')
    const state: ExpoStateFile = JSON.parse(content)

    if (state.auth?.userId && state.auth?.username) {
      return {
        authenticated: true,
        userId: state.auth.userId,
        username: state.auth.username,
      }
    }

    return { authenticated: false }
  } catch {
    return { authenticated: false }
  }
}

// ============================================================================
// CLI Command Spawning
// ============================================================================

// Track active setup processes
type ManagedProcess = pty.IPty | ChildProcess

const activeProcesses: Map<string, ManagedProcess> = new Map()

/**
 * Resolve CLI command name for the current platform.
 */
function resolveCliCommand(command: string): string {
  if (process.platform !== 'win32') return command
  if (command.toLowerCase() === 'npx') {
    // In packaged Electron apps the system PATH may be truncated / missing
    // Node.js directories.  Try to find npx.cmd at common install locations.
    const searchDirs: string[] = []
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
    const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    const appData = process.env.APPDATA || ''
    const localAppData = process.env.LOCALAPPDATA || ''

    searchDirs.push(path.join(pf, 'nodejs'))
    searchDirs.push(path.join(pfx86, 'nodejs'))
    if (localAppData) searchDirs.push(path.join(localAppData, 'Programs', 'nodejs'))
    if (appData) searchDirs.push(path.join(appData, 'npm'))
    // nvm-windows stores versions under NVM_SYMLINK or NVM_HOME
    if (process.env.NVM_SYMLINK) searchDirs.push(process.env.NVM_SYMLINK)

    for (const dir of searchDirs) {
      const candidate = path.join(dir, 'npx.cmd')
      if (fs.existsSync(candidate)) {
        writeDiagnosticLog(`Resolved npx.cmd at: ${candidate}`)
        return candidate
      }
    }

    writeDiagnosticLog(`Could not find npx.cmd in common locations: ${searchDirs.join(', ')}`)
    return 'npx.cmd'
  }
  return command
}

/**
 * Augment the PATH with common Node.js directories so child commands
 * spawned by npx (e.g. expo) can also be found.
 */
function getWindowsNodePaths(): string[] {
  const dirs: string[] = []
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
  const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
  const appData = process.env.APPDATA || ''
  const localAppData = process.env.LOCALAPPDATA || ''

  const candidates = [
    path.join(pf, 'nodejs'),
    path.join(pfx86, 'nodejs'),
    localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
    appData ? path.join(appData, 'npm') : '',
    process.env.NVM_SYMLINK || '',
  ]

  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) dirs.push(dir)
  }
  return dirs
}

function quoteForCmd(arg: string): string {
  // cmd.exe special characters that need quoting: & | < > ^ " space
  // Wrapping in double quotes prevents & | < > from being interpreted.
  // Embedded " are escaped as "".
  if (!/[\s"&^|<>]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}

/**
 * Write diagnostic log to a file in the user's home directory.
 * Appends to ~/.bfloat-ide/provider-auth.log so we can see what's happening
 * with CLI processes on Windows.
 */
function writeDiagnosticLog(message: string): void {
  try {
    const logDir = path.join(os.homedir(), '.bfloat-ide')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    const logPath = path.join(logDir, 'provider-auth.log')
    const timestamp = new Date().toISOString()
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`)
  } catch {
    // Best effort logging
  }
}

/**
 * Spawn a CLI command via child_process and return a promise that resolves when
 * complete.  Used on Windows where node-pty native addon cannot load from
 * cross-compiled packaged builds, and as a general fallback.
 *
 * On Windows:
 * - .exe binaries are spawned directly (no shell wrapper)
 * - .cmd/.bat scripts use shell:true (cmd.exe) so they can be found in PATH
 * - Git Bash is NOT used as a wrapper — it cannot execute Windows-native
 *   binaries (exit code 127) or .cmd scripts ("command not found").
 * - The Claude CLI stdin issue is solved separately via a -r preload script
 *   (see ensureStdinTtyPatch / findClaudeCli).
 */
function spawnCliCommandWithChildProcess(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; processKey?: string; onOutput?: (data: string) => void; timeoutMs?: number }
): Promise<{ success: boolean; exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const resolvedCommand = resolveCliCommand(command)
    const processKey = options?.processKey || resolvedCommand
    const isWindows = process.platform === 'win32'
    const onOutput = options?.onOutput
    let output = ''
    const startTime = Date.now()

    let spawnCommand: string
    let spawnArgs: string[]
    let useShell: boolean | string = false

    if (isWindows) {
      // .cmd/.bat scripts need shell:true (cmd.exe) to execute.
      // .exe binaries are spawned directly — no shell wrapper needed.
      useShell = /\.(cmd|bat)$/i.test(resolvedCommand)
      // When using cmd.exe (shell:true), the command and args are joined into
      // a single string.  Paths with spaces (e.g. "C:\Program Files\nodejs\npx.cmd")
      // and special characters in args (& | < > ^ in passwords) MUST be quoted.
      spawnCommand = useShell ? quoteForCmd(resolvedCommand) : resolvedCommand
      spawnArgs = useShell ? args.map((a) => quoteForCmd(a)) : args
      writeDiagnosticLog(`Windows spawn: shell=${useShell}, command=${resolvedCommand}`)
    } else {
      spawnCommand = resolvedCommand
      spawnArgs = args
    }

    // On Windows, augment PATH with common Node.js install directories.
    // Packaged Electron apps often have a truncated PATH that excludes
    // Node.js, so npx.cmd / npm.cmd may not be found.
    let extraPath = ''
    if (isWindows) {
      const nodePaths = getWindowsNodePaths()
      if (nodePaths.length > 0) {
        extraPath = nodePaths.join(';')
        writeDiagnosticLog(`Adding Node.js paths to PATH: ${extraPath}`)
      }
    }

    // Log environment details for debugging
    const envInfo = {
      PATH_entries: (process.env.PATH || '').split(isWindows ? ';' : ':').length,
      extra_node_paths: extraPath || '(none)',
      CODEX_HOME: process.env.CODEX_HOME || '(not set)',
      HOME: process.env.HOME || '(not set)',
      USERPROFILE: process.env.USERPROFILE || '(not set)',
      ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || '(not set)',
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath || '(not set)',
    }
    writeDiagnosticLog(`Environment: ${JSON.stringify(envInfo)}`)

    const logMsg = `Spawning: command=${spawnCommand}, args=${JSON.stringify(spawnArgs)}, shell=${useShell}, platform=${process.platform}, arch=${process.arch}`
    console.log(`[Provider Handler] ${logMsg}`)
    writeDiagnosticLog(logMsg)

    const spawnPath = extraPath
      ? `${extraPath};${process.env.PATH || ''}`
      : process.env.PATH || ''

    try {
      const child = spawn(spawnCommand, spawnArgs, {
        cwd: os.homedir(),
        env: {
          ...(process.env as { [key: string]: string }),
          ...(isWindows
            ? {
                // CI=true tells Ink (React terminal UI) to use a static
                // renderer that does not require raw mode on stdin.  Without
                // this, Ink crashes with "Raw mode is not supported on the
                // current process.stdin" when stdin is a pipe (non-TTY).
                CI: 'true',
                // Augmented PATH so npx/node/npm are found
                PATH: spawnPath,
              }
            : { TERM: 'xterm-256color' }),
          ...(options?.env || {}),
        },
        shell: useShell,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const pidMsg = `Process started: pid=${child.pid}, command=${spawnCommand}`
      console.log(`[Provider Handler] ${pidMsg}`)
      writeDiagnosticLog(pidMsg)

      // Close stdin immediately — none of our CLI commands read from stdin
      // (credentials are passed via args).  Leaving stdin open causes some
      // tools (e.g. npx prompts) to hang waiting for input.
      child.stdin?.end()

      activeProcesses.set(processKey, child)

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        onOutput?.(text)
        writeDiagnosticLog(`[stdout @${Date.now() - startTime}ms] ${text.substring(0, 200)}`)
      })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        onOutput?.(text)
        writeDiagnosticLog(`[stderr @${Date.now() - startTime}ms] ${text.substring(0, 200)}`)
      })

      child.on('error', (error) => {
        const errMsg = `Process error: pid=${child.pid}, error=${error}`
        console.log(`[Provider Handler] ${errMsg}`)
        writeDiagnosticLog(errMsg)
        activeProcesses.delete(processKey)
        resolve({
          success: false,
          exitCode: -1,
          output: error instanceof Error ? error.message : 'Failed to spawn process',
        })
      })

      // Optional timeout — kills the process if it runs too long
      let timedOut = false
      let killTimer: ReturnType<typeof setTimeout> | null = null
      if (options?.timeoutMs && options.timeoutMs > 0) {
        killTimer = setTimeout(() => {
          timedOut = true
          const timeoutMsg = `Process timed out after ${options.timeoutMs}ms, killing pid=${child.pid}`
          writeDiagnosticLog(timeoutMsg)
          child.kill()
        }, options.timeoutMs)
      }

      child.on('close', (code, signal) => {
        if (killTimer) clearTimeout(killTimer)
        const elapsed = Date.now() - startTime
        const exitMsg = `Process exited: pid=${child.pid}, code=${code}, signal=${signal}, elapsed=${elapsed}ms, output_len=${output.length}${timedOut ? ' (TIMED OUT)' : ''}`
        console.log(`[Provider Handler] ${exitMsg}`)
        writeDiagnosticLog(exitMsg)
        writeDiagnosticLog(`Full output:\n${output}`)
        activeProcesses.delete(processKey)
        resolve({
          success: !timedOut && code === 0,
          exitCode: code ?? -1,
          output: timedOut ? `Command timed out after ${Math.round((options?.timeoutMs || 0) / 1000)}s. ${output}`.trim() : output,
        })
      })
    } catch (error) {
      const catchMsg = `Spawn threw: ${error}`
      writeDiagnosticLog(catchMsg)
      resolve({
        success: false,
        exitCode: -1,
        output: error instanceof Error ? error.message : 'Failed to spawn process',
      })
    }
  })
}

function escapeForPowerShell(arg: string): string {
  // Wrap every argument in single quotes; escape embedded single quotes by doubling them
  return `'${arg.replace(/'/g, "''")}'`
}

function spawnCliCommandWithPty(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; processKey?: string; onOutput?: (data: string) => void }
): Promise<{ success: boolean; exitCode: number; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    const processKey = options?.processKey || command
    const onOutput = options?.onOutput
    const isWindows = process.platform === 'win32'

    try {
      // On Windows, run through PowerShell to provide a proper interactive shell
      // environment. CLI tools (claude setup-token, codex login) start local HTTP
      // callback servers that stay alive only in interactive terminal sessions.
      let spawnCmd: string
      let spawnArgs: string[]

      if (isWindows) {
        const resolvedCommand = resolveCliCommand(command)
        const fullCommand = [resolvedCommand, ...args].map(escapeForPowerShell).join(' ')
        spawnCmd = 'powershell.exe'
        spawnArgs = ['-NoProfile', '-Command', `& ${fullCommand}`]
      } else {
        spawnCmd = resolveCliCommand(command)
        spawnArgs = args
      }

      console.log(`[Provider Handler] PTY spawn: cmd=${spawnCmd}, args=${JSON.stringify(spawnArgs)}`)

      const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: os.homedir(),
        env: {
          ...(process.env as { [key: string]: string }),
          ...(isWindows ? {} : { TERM: 'xterm-256color' }),
          ...(options?.env || {}),
        },
        useConpty: isWindows,
      })

      activeProcesses.set(processKey, ptyProcess)

      ptyProcess.onData((data) => {
        output += data
        onOutput?.(data)
      })

      ptyProcess.onExit(({ exitCode }) => {
        activeProcesses.delete(processKey)
        resolve({
          success: exitCode === 0,
          exitCode,
          output,
        })
      })
    } catch (error) {
      resolve({
        success: false,
        exitCode: -1,
        output: error instanceof Error ? error.message : 'Failed to spawn process',
      })
    }
  })
}

async function spawnCliCommand(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; processKey?: string; onOutput?: (data: string) => void; timeoutMs?: number }
): Promise<{ success: boolean; exitCode: number; output: string }> {
  if (process.platform === 'win32') {
    // On Windows in packaged Electron builds, node-pty's native addon cannot
    // load because electron-builder cross-compiles it for the build host
    // (macOS), not the Windows target.  Go straight to child_process — the
    // CLI binaries (codex.exe, Electron-as-Node for Claude) are spawned
    // directly without a PowerShell wrapper.
    return spawnCliCommandWithChildProcess(command, args, options)
  }

  return spawnCliCommandWithPty(command, args, options)
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Check if Claude Code CLI is installed system-wide.
 * On Windows, users need to install Claude Code CLI separately to use it as an AI provider.
 * The bundled CLI is only used for authentication, not for running agents.
 */
function findSystemClaudeCli(): { installed: boolean; path?: string } {
  const possiblePaths: string[] = []

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

    possiblePaths.push(
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(localAppData, 'Programs', 'claude-code', 'claude.exe'),
      path.join(localAppData, 'claude-code', 'claude.exe'),
      path.join(appData, 'npm', 'claude.cmd'),
      path.join(appData, 'npm', 'claude'),
      path.join(os.homedir(), 'scoop', 'shims', 'claude.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Claude Code', 'claude.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Claude Code', 'claude.exe'),
    )
  } else {
    // On macOS/Linux, Claude Code is typically installed via npm or Homebrew
    possiblePaths.push(
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    )
  }

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`[Provider Handler] Found system Claude CLI at: ${p}`)
        return { installed: true, path: p }
      }
    } catch {
      // Ignore errors checking paths
    }
  }

  console.log(`[Provider Handler] System Claude CLI not found. Checked: ${possiblePaths.join(', ')}`)
  return { installed: false }
}

export const registerProviderHandlers = (): void => {
  // Check if Claude Code CLI is installed system-wide
  handle('provider:check-claude-cli-installed', () => {
    return findSystemClaudeCli()
  })

  handle('provider:select-git-bash', async () => {
    if (process.platform !== 'win32') {
      return {
        success: false,
        error: 'Git Bash selection is only required on Windows.',
      }
    }

    try {
      const existingPath = getStoredGitBashPath()
      const result = await dialog.showOpenDialog({
        title: 'Select Git Bash (bash.exe)',
        buttonLabel: 'Select',
        properties: ['openFile'],
        defaultPath: existingPath ? path.dirname(existingPath) : undefined,
        filters: [{ name: 'Bash', extensions: ['exe'] }],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No file selected.' }
      }

      const selectedPath = result.filePaths[0]
      const resolvedPath = resolveGitBashPath(selectedPath)

      if (!resolvedPath) {
        return {
          success: false,
          error: 'Please select the Git Bash bash.exe file.',
        }
      }

      saveGitBashPath(resolvedPath)
      process.env.CLAUDE_CODE_GIT_BASH_PATH = resolvedPath

      return { success: true, path: resolvedPath }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to select Git Bash.',
      }
    }
  })

  /**
   * Connect to Anthropic using hybrid approach:
   * 1. Run `claude setup-token` CLI directly (handles browser OAuth flow)
   * 2. Capture all terminal output
   * 3. Feed output to Claude Agent SDK to parse the token (via Bfloat proxy)
   * 4. Agent saves the token using custom MCP tool
   *
   * This combines:
   * - CLI's ability to handle interactive OAuth browser flow
   * - Agent's robustness in parsing messy terminal output (ANSI codes, etc.)
   * - No API keys on client (proxy injects them server-side)
   */
  handle('provider:connect-anthropic', async () => {
    console.log('[Provider Handler] Starting hybrid Anthropic connection')

    // Kill any existing process
    const existing = activeProcesses.get('claude')
    if (existing) {
      existing.kill()
      activeProcesses.delete('claude')
    }

    writeDiagnosticLog('='.repeat(60))
    writeDiagnosticLog('CONNECT ANTHROPIC (hybrid: CLI + Agent parsing)')
    writeDiagnosticLog('='.repeat(60))

    const claudeCli = findClaudeCli()
    console.log(`[Provider Handler] Claude CLI: ${claudeCli ? `command=${claudeCli.command}, argsPrefix=${claudeCli.argsPrefix.join(' ')}` : 'null'}, platform: ${process.platform}`)
    writeDiagnosticLog(`Claude CLI: ${claudeCli ? `command=${claudeCli.command}, argsPrefix=${JSON.stringify(claudeCli.argsPrefix)}` : 'null'}`)
    const claudeEnv = ensureClaudeWindowsEnv(claudeCli?.env)

    // Windows-specific checks
    if (process.platform === 'win32' && !findGitBashPath()) {
      return {
        success: false,
        exitCode: -1,
        authenticated: false,
        providers: [],
        output: getClaudeWindowsMissingGitBashMessage(),
      }
    }
    if (!claudeCli && app.isPackaged) {
      return {
        success: false,
        exitCode: -1,
        authenticated: false,
        providers: [],
        output: 'Claude CLI not found in the app bundle.',
      }
    }

    // Capture output for later parsing by the agent
    let capturedOutput = ''
    const onOutput = (data: string) => {
      capturedOutput += data
      broadcastProviderAuthOutput('anthropic', data)
    }

    // Step 1: Run the CLI command (handles browser OAuth flow)
    console.log('[Provider Handler] Step 1: Running claude setup-token CLI')
    const cliResult = claudeCli
      ? await spawnCliCommand(claudeCli.command, [...claudeCli.argsPrefix, 'setup-token'], {
          env: claudeEnv,
          processKey: 'claude',
          onOutput,
        })
      : await spawnCliCommand('npx', ['@anthropic-ai/claude-code', 'setup-token'], {
          env: claudeEnv,
          processKey: 'claude',
          onOutput,
        })

    console.log(`[Provider Handler] CLI result: success=${cliResult.success}, exitCode=${cliResult.exitCode}, output length=${capturedOutput.length}`)

    // If CLI failed, return early
    if (!cliResult.success) {
      return {
        success: false,
        exitCode: cliResult.exitCode,
        authenticated: false,
        providers: [],
        output: formatCliOutput(cliResult.output),
      }
    }

    // Step 2: Feed captured output to the parser for token extraction
    broadcastProviderAuthOutput('anthropic', 'Extracting credentials...\n')

    let agentResult: { success: boolean; message: string; tokenSaved: boolean }
    try {
      agentResult = await parseClaudeSetupOutput(capturedOutput, (data) => {
        broadcastProviderAuthOutput('anthropic', data)
      })

      // Check final auth status
      const authStatus = checkClaudeAuth()

      if (authStatus.authenticated) {
        const settings = loadSettings()
        settings.integrations = settings.integrations || {}
        settings.integrations.anthropic = {
          enabled: true,
          connectedAt: Date.now(),
          accountId: authStatus.account?.accountUuid,
        }
        saveSettings(settings)
      }

      // Only report authenticated=true if we actually saved a NEW token
      // This prevents the UI from detecting old credentials as success
      const isNewlyAuthenticated = agentResult.tokenSaved && authStatus.authenticated

      return {
        success: isNewlyAuthenticated,
        exitCode: isNewlyAuthenticated ? 0 : 1,
        authenticated: isNewlyAuthenticated,
        providers: isNewlyAuthenticated ? authStatus.providers : [],
        output: agentResult.message,
        tokenSaved: agentResult.tokenSaved,
      }
    } catch (error) {
      console.error('[Provider Handler] Parsing failed:', error)
      // Don't fall back to old auth state - if parsing failed, the flow failed
      return {
        success: false,
        exitCode: 1,
        authenticated: false,
        providers: [],
        output: error instanceof Error ? error.message : 'Token parsing failed',
        tokenSaved: false,
      }
    }
  })

  // Connect to OpenAI/Codex using `codex login`
  handle('provider:connect-openai', async () => {
    // First check if already authenticated via Codex CLI
    const existingAuth = checkCodexAuth()
    if (existingAuth.authenticated) {
      const settings = loadSettings()
      settings.integrations = settings.integrations || {}
      settings.integrations.openai = {
        enabled: true,
        connectedAt: Date.now(),
        accountId: existingAuth.accountId,
      }
      saveSettings(settings)

      return {
        success: true,
        exitCode: 0,
        authenticated: true,
        providers: ['openai'],
      }
    }

    // Kill any existing process
    const existing = activeProcesses.get('codex')
    if (existing) {
      existing.kill()
      activeProcesses.delete('codex')
    }

    writeDiagnosticLog('='.repeat(60))
    writeDiagnosticLog('CONNECT OPENAI (codex login)')
    writeDiagnosticLog('='.repeat(60))

    let result: { success: boolean; exitCode: number; output: string }

    if (process.platform === 'win32') {
      // On Windows, use the browser-based PKCE OAuth flow to avoid
      // native binary issues (STATUS_DLL_NOT_FOUND with codex.exe).
      buildCodexEnv() // ensure CODEX_HOME / ~/.codex directory exists
      result = await connectOpenAIBrowserAuth((data) => broadcastProviderAuthOutput('openai', data))
    } else {
      // On macOS/Linux, spawn the codex binary normally
      const codexBinary = findCodexBinary()
      console.log(`[Provider Handler] Codex binary: ${codexBinary}, isPackaged: ${app.isPackaged}, platform: ${process.platform}, arch: ${process.arch}`)
      writeDiagnosticLog(`Codex binary: ${codexBinary}, isPackaged: ${app.isPackaged}`)
      if (app.isPackaged && codexBinary === 'codex') {
        return {
          success: false,
          exitCode: -1,
          authenticated: false,
          providers: [],
          output: 'Codex CLI not found in the app bundle.',
        }
      }
      const codexEnv = buildCodexEnv()
      console.log(`[Provider Handler] Spawning codex with args: login`)
      result = await spawnCliCommand(codexBinary, ['login'], {
        processKey: 'codex',
        env: codexEnv,
        onOutput: (data) => broadcastProviderAuthOutput('openai', data),
      })
      console.log(`[Provider Handler] Codex result: success=${result.success}, exitCode=${result.exitCode}, output=${result.output?.substring(0, 200)}`)
    }

    const authStatus = checkCodexAuth()
    console.log(`[Provider Handler] Codex auth check: authenticated=${authStatus.authenticated}`)

    if (authStatus.authenticated) {
      const settings = loadSettings()
      settings.integrations = settings.integrations || {}
      settings.integrations.openai = {
        enabled: true,
        connectedAt: Date.now(),
        accountId: authStatus.accountId,
      }
      saveSettings(settings)
    }

    return {
      success: result.success && authStatus.authenticated,
      exitCode: result.exitCode,
      authenticated: authStatus.authenticated,
      providers: authStatus.authenticated ? ['openai'] : [],
      output: formatCliOutput(result.output),
    }
  })

  // Connect to Expo using CLI via npx (auto-installs if needed)
  handle(
    'provider:connect-expo',
    async (credentials: { username: string; password: string; otp?: string }) => {
      // First check if already authenticated
      const existingAuth = checkExpoAuth()
      if (existingAuth.authenticated) {
        const settings = loadSettings()
        settings.integrations = settings.integrations || {}
        settings.integrations.expo = {
          enabled: true,
          connectedAt: Date.now(),
          userId: existingAuth.userId,
          username: existingAuth.username,
        }
        saveSettings(settings)

        return {
          success: true,
          exitCode: 0,
          authenticated: true,
          username: existingAuth.username,
        }
      }

      // Kill any existing process
      const existing = activeProcesses.get('expo')
      if (existing) {
        existing.kill()
        activeProcesses.delete('expo')
      }

      // Build CLI arguments
      // --yes: auto-confirm npx package installation (avoids hanging on prompt)
      const args = [
        '--yes',
        'expo',
        'login',
        '-u',
        credentials.username,
        '-p',
        credentials.password,
      ]

      // Add OTP if provided
      if (credentials.otp) {
        args.push('--otp', credentials.otp)
      }

      writeDiagnosticLog(`Expo login: username=${credentials.username}, hasOtp=${!!credentials.otp}`)

      // Use npx to auto-install and run the CLI.
      // 90s timeout: npx may need to download expo on first run, but login
      // itself should be fast.  Without a timeout the UI hangs indefinitely.
      const result = await spawnCliCommand('npx', args, {
        processKey: 'expo',
        timeoutMs: 90_000,
      })
      writeDiagnosticLog(`Expo login result: success=${result.success}, exitCode=${result.exitCode}, output=${result.output.substring(0, 500)}`)
      const authStatus = checkExpoAuth()

      if (authStatus.authenticated) {
        const settings = loadSettings()
        settings.integrations = settings.integrations || {}
        settings.integrations.expo = {
          enabled: true,
          connectedAt: Date.now(),
          userId: authStatus.userId,
          username: authStatus.username,
        }
        saveSettings(settings)
      }

      // Extract error message from output if login failed
      let error: string | undefined
      if (!authStatus.authenticated) {
        if (result.output.includes('Invalid username') || result.output.includes('Invalid credentials')) {
          error = 'Invalid username or password'
        } else if (result.output.includes('OTP') || result.output.includes('2FA')) {
          error = '2FA code required'
        } else {
          // Include raw CLI output so the user (and us) can diagnose what went wrong
          const rawOutput = result.output?.trim()
          error = rawOutput
            ? `Login failed (exit ${result.exitCode}): ${rawOutput.substring(0, 300)}`
            : 'Login failed. Please check your credentials.'
        }
      }

      return {
        success: result.success && authStatus.authenticated,
        exitCode: result.exitCode,
        authenticated: authStatus.authenticated,
        username: authStatus.username,
        error,
        output: formatCliOutput(result.output),
      }
    }
  )

  // Check auth status (used by UI)
  handle('provider:check-auth', () => {
    return checkClaudeAuth()
  })

  // Check Expo auth status
  handle('provider:check-expo-auth', () => {
    return checkExpoAuth()
  })

  // Disconnect provider (marks as disabled, doesn't log out of CLI)
  handle('provider:disconnect', (provider: 'anthropic' | 'openai' | 'expo') => {
    const settings = loadSettings()
    settings.integrations = settings.integrations || {}

    if (provider === 'anthropic') {
      // Clear all Claude auth state so reconnect requires full auth flow
      clearClaudeAuthState()
      settings.integrations.anthropic = {
        enabled: false,
        connectedAt: undefined,
        accountId: undefined,
      }
    } else if (provider === 'openai') {
      settings.integrations.openai = {
        ...settings.integrations.openai,
        enabled: false,
      }
    } else if (provider === 'expo') {
      settings.integrations.expo = {
        ...settings.integrations.expo,
        enabled: false,
      }
    }

    saveSettings(settings)

    return {
      success: true,
      exitCode: 0,
    }
  })

  // Load auth state from CLI config files
  handle('provider:load-tokens', () => {
    const claudeAuth = checkClaudeAuth()
    const claudeCredentials = readClaudeCredentials()
    const codexAuth = checkCodexAuth()
    const expoAuth = checkExpoAuth()
    const settings = loadSettings()
    const integrations = settings.integrations || {}

    console.log('[provider:load-tokens] claudeAuth:', JSON.stringify(claudeAuth))
    console.log('[provider:load-tokens] claudeCredentials exists:', claudeCredentials !== null)
    console.log('[provider:load-tokens] integrations.anthropic:', integrations.anthropic)

    // Auto-enable if authenticated (unless explicitly disabled)
    const anthropicEnabled =
      claudeAuth.authenticated && integrations.anthropic?.enabled !== false

    console.log('[provider:load-tokens] anthropicEnabled:', anthropicEnabled)

    const openaiEnabled =
      codexAuth.authenticated && integrations.openai?.enabled !== false

    const expoEnabled =
      expoAuth.authenticated && integrations.expo?.enabled !== false

    return {
      anthropic: anthropicEnabled
        ? {
            type: 'oauth' as const,
            accountId: claudeAuth.account?.accountUuid,
            accessToken: claudeCredentials?.claudeAiOauth?.accessToken,
            refreshToken: claudeCredentials?.claudeAiOauth?.refreshToken ?? undefined,
            expiresAt:
              claudeCredentials?.claudeAiOauth?.expiresAt ?? Date.now() + 365 * 24 * 60 * 60 * 1000,
            scopes: claudeCredentials?.claudeAiOauth?.scopes,
            subscriptionType: claudeCredentials?.claudeAiOauth?.subscriptionType,
            rateLimitTier: claudeCredentials?.claudeAiOauth?.rateLimitTier,
          }
        : null,
      openai: openaiEnabled
        ? {
            type: 'oauth' as const,
            accountId: codexAuth.accountId,
            accessToken: codexAuth.accessToken,
            refreshToken: codexAuth.refreshToken,
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          }
        : null,
      expo: expoEnabled
        ? {
            type: 'oauth' as const,
            userId: expoAuth.userId,
            username: expoAuth.username,
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          }
        : null,
    }
  })

  // Persist OAuth tokens for CLI usage
  handle('provider:save-tokens', async (provider: 'anthropic' | 'openai' | 'expo', tokens: OAuthTokens) => {
    const settings = loadSettings()
    settings.integrations = settings.integrations || {}

    if (provider === 'anthropic') {
      saveClaudeTokens(tokens)
      settings.integrations.anthropic = {
        enabled: true,
        connectedAt: Date.now(),
        accountId: tokens.accountId,
      }
      saveSettings(settings)
      return
    }

    if (provider === 'openai') {
      saveCodexTokens(tokens)
      settings.integrations.openai = {
        enabled: true,
        connectedAt: Date.now(),
        accountId: tokens.accountId,
      }
      saveSettings(settings)
      return
    }
  })

  handle('provider:clear-tokens', async () => {
    // No-op: Use provider:disconnect instead
  })

  handle('provider:refresh-tokens', async () => {
    // No-op: CLI tools handle token refresh
    return null
  })

}
