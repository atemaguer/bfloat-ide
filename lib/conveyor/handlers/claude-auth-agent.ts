/**
 * Claude Authentication Token Parser
 *
 * Parses the OAuth token from `claude setup-token` CLI output and saves it.
 * Uses simple regex parsing for reliability.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Claude credentials path
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const CLAUDE_CREDENTIALS_PATH = path.join(CLAUDE_CONFIG_DIR, '.credentials.json')

/**
 * Ensure the Claude config directory exists
 */
function ensureClaudeConfigDir(): void {
  if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
    fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

/**
 * Read existing Claude credentials
 */
function readClaudeCredentials(): Record<string, unknown> {
  try {
    if (!fs.existsSync(CLAUDE_CREDENTIALS_PATH)) {
      return {}
    }
    const content = fs.readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Write Claude credentials
 */
function writeClaudeCredentials(credentials: Record<string, unknown>): void {
  ensureClaudeConfigDir()
  fs.writeFileSync(CLAUDE_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

/**
 * Result of the token parsing
 */
export interface AuthAgentResult {
  success: boolean
  message: string
  tokenSaved: boolean
}

/**
 * Strip ANSI escape codes from terminal output
 */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
    .replace(/\[\d+m/g, '') // Remaining color codes
    .replace(/\r/g, '') // Carriage returns
}

/**
 * Parse the output from `claude setup-token` CLI and extract the OAuth token.
 * Uses simple regex parsing for reliability.
 *
 * @param cliOutput The captured output from running `claude setup-token`
 * @param onOutput Callback for streaming status to the UI
 */
export async function parseClaudeSetupOutput(
  cliOutput: string,
  onOutput?: (data: string) => void
): Promise<AuthAgentResult> {
  // Strip ANSI codes for cleaner matching
  const cleanOutput = stripAnsi(cliOutput)

  // Try multiple patterns to find the OAuth token
  // The token format is: sk-ant-oat01-XXXX (alphanumeric with hyphens)
  // Must stop at whitespace/newline to avoid capturing surrounding text like "Store"
  const patterns = [
    /Your OAuth token[^:]*:\s*(sk-ant-oat[a-zA-Z0-9_-]+?)(?:\s|$)/i,
    /token[^:]*:\s*(sk-ant-oat[a-zA-Z0-9_-]+?)(?:\s|$)/i,
    /(sk-ant-oat01-[a-zA-Z0-9_-]+?)(?:\s|$)/,
    /(sk-ant-oat[a-zA-Z0-9_-]+?)(?:\s|$)/,
  ]

  let token: string | null = null

  for (const pattern of patterns) {
    const match = cleanOutput.match(pattern)
    if (match && match[1]) {
      token = match[1]
      break
    }
  }

  if (!token) {
    return {
      success: false,
      message: 'Could not find OAuth token in CLI output',
      tokenSaved: false,
    }
  }

  // Clean up token: remove known CLI text that may be concatenated without whitespace
  // The CLI outputs "Store this token securely" right after the token
  if (token.endsWith('Store')) {
    token = token.slice(0, -5)
  }

  // Validate token format
  if (!token.startsWith('sk-ant-oat')) {
    return {
      success: false,
      message: 'Invalid token format',
      tokenSaved: false,
    }
  }

  // Save the token
  try {
    const credentials = readClaudeCredentials()
    credentials.oauthToken = token
    writeClaudeCredentials(credentials)

    onOutput?.('Saving credentials...\n')

    return {
      success: true,
      message: 'OAuth token saved successfully',
      tokenSaved: true,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to save token',
      tokenSaved: false,
    }
  }
}
