/**
 * Enhanced log cleaner for deployment logs
 * Converts line-overwriting sequences to newlines and removes escape codes
 */

/**
 * All known spinner Unicode characters used by CLI tools (ora, cli-spinners, etc.)
 */
const SPINNER_CHARS = /[⠋⠙⠹⠸⠼⠴⠦⠧⇇⠏⠇⠏⠋★⚙✓✗✔✖⚪⚫]+/g

/**
 * Common spinner text patterns that repeat during progress.
 * When these patterns repeat consecutively, insert newlines between them.
 * This handles cases where \r is stripped before reaching the cleaner.
 */
const SPINNER_PATTERNS = [
  /Linking local project to EAS project [a-f0-9-]+/g,
  /Linking bundle identifier [\w.]+/g,
  /Syncing capabilities/g,
  /Syncing capabilities identifier/g,
  /Fetching Apple distribution certificates/g,
  /Fetching Apple provisioning profiles/g,
  /Computing project fingerprint/g,
  /Scheduling iOS submission/g,
  /Waiting for build to complete/g,
  /Build in progress\.\.\./g,
  /Linking to App Store Connect [\w.]+/g,
  /Uploading to EAS Build \([^)]+\)/g,
]

const LINE_BREAK_TOKENS = [
  'npm warn Unknown env config',
  'npm warn Unknown user config',
  'Using EAS CLI without version control system is not recommended',
  'Project already linked',
  'Resolved "production" environment for the build.',
  'No environment variables with visibility',
  'Incrementing buildNumber',
  'Incremented buildNumber',
  'Your Expo app does not have a',
  'Using remote iOS credentials',
  'If you provide your Apple account credentials',
  'This is optional, but without Apple account access',
  '? Do you want to log in to your Apple account?',
  'Do you want to log in to your Apple account? … yes',
  '› Session expired',
  '› Team',
  'Logging in...',
  'Logged in, verify your Apple account to continue',
  'Logged in and verified',
  'Two-factor Authentication',
  '? Please enter the 6 digit code',
  '? Select a Provider',
  'Validating code...',
  'Valid code',
  'Linking bundle identifier',
  'Registering bundle identifier',
  'Bundle identifier registered',
  'Syncing capabilities',
  'Synced capabilities:',
  'Fetched Apple distribution certificates',
  'Fetching Apple distribution certificates',
  '? Reuse this distribution certificate?',
  'Creating Apple provisioning profile',
  'Created Apple provisioning profile',
  'Created provisioning profile',
  'Project Credentials Configuration',
  'Uploading to EAS Build',
  'Uploaded to EAS',
  'Computing project fingerprint',
  'Computed project fingerprint',
  'See logs:',
  'Selected build uses',
  'Ensuring your app exists on App Store Connect.',
  'Linking to App Store Connect',
  'Creating App Store Connect app',
  'App name "',
  'Prepared App Store Connect',
  'Creating TestFlight group...',
  'TestFlight group created',
  'Looking up credentials configuration',
  'Fetching App Store Connect API Keys.',
  'Fetched App Store Connect API Keys.',
  '? Reuse this App Store Connect API Key?',
  'Using App Store Connect API Key',
  'App Store Connect API Key assigned',
  'ASC App ID:',
  'Project ID:',
  'Submitted your app to Apple App Store Connect!',
  'Submitting your app to Apple App Store Connect: submission in progress',
  'Your binary has been successfully uploaded to App Store Connect!',
  'Scheduling iOS submission',
  'Scheduled iOS submission',
  'Submission details:',
  'Waiting for build to complete.',
  'Build in progress...',
]

const SUPPRESS_ALWAYS_PATTERNS = [
  /^no matches found$/i,
  /^\[BIDE_DEPLOY_MODE\]/,
]

const COLLAPSE_REPEAT_PATTERNS = [
  /^npm warn Unknown (env|user) config /i,
  /^Using EAS CLI without version control system is not recommended/i,
]

const OTP_PROMPT_PATTERN = /^(\? Please enter the 6 digit code[^:]*:\s*›)\s*\d{0,6}$/i
const REPEAT_SUFFIX_PATTERN = /^(.*)\s+\(x(\d+)\)$/

/**
 * Insert newlines between consecutive repeated spinner text patterns.
 * This handles cases where \r carriage returns were stripped before reaching this function.
 */
function insertNewlinesAtRepeatedPatterns(text: string): string {
  for (const pattern of SPINNER_PATTERNS) {
    text = text.replace(pattern, (match) => '\n' + match)
  }
  return text
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function insertLineBreaksAtKnownTokens(text: string): string {
  let normalized = text
  for (const token of LINE_BREAK_TOKENS) {
    normalized = normalized.replace(new RegExp(escapeRegExp(token), 'g'), `\n${token}`)
  }
  normalized = normalized
    .replace(/(Submitting){2,}/g, '\nSubmitting')
    .replace(/([.?!])([A-Z?])/g, '$1\n$2')
    .replace(/(\))([A-Z?])/g, '$1\n$2')
  return normalized
}

/**
 * Clean terminal output by:
 * 1. Converting line-overwrite sequences (\r, [1G[0K, etc.) to newlines
 * 2. Removing spinner characters and other ANSI codes
 * 3. Inserting newlines at repeated spinner patterns
 * 4. Cleaning up excessive whitespace
 *
 * This makes each spinner frame appear on its own line for readable logs.
 *
 * @param raw - The raw terminal output string
 * @returns Cleaned text suitable for UI display
 */
export function cleanTerminalOutput(raw: string): string {
  if (!raw) return ''

  let cleaned = raw
    // Convert carriage return to newline - \r means "go to start of line and overwrite"
    // By converting to \n, each update that would have overwritten appears on its own line
    .replace(/\r/g, '\n')
    // Convert cursor-to-start + clear-line pattern to newline
    // [1G = cursor to column 1, [0K = clear to end of line
    // This combination means "overwrite this line with new content"
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[1G\x1b\[0K/g, '\n')
    // Handle case where ESC is missing (sometimes happens in partial logs)
    .replace(/\[1G\[0K/g, '\n')
    // Remove standalone [2K (clear line) - doesn't indicate a new frame
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[2K/g, '')
    // Remove [2K without ESC
    .replace(/\[2K/g, '')
    // Remove cursor visibility toggles [?25l (hide) and [?25h (show)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[\?25[hl]/g, '')
    // Remove standalone cursor-to-start [1G (if not followed by [0K)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[1G/g, '')
    // Remove [1G without ESC
    .replace(/\[1G/g, '')
    // Remove spinner characters (Unicode braille patterns used by spinners)
    .replace(SPINNER_CHARS, '')
    // Remove ANSI CSI sequences (colors, cursor movement, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // Remove OSC sequences (window titles, hyperlinks, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Remove other escape sequences (ESC followed by non-[)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[]/g, '')
    // Replace double-escape sequences with newline (sometimes appears in logs)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\x1b/g, '\n')

  // Handle repeated spinner patterns (when \r was stripped before reaching here)
  // This inserts newlines before known spinner text patterns
  cleaned = insertNewlinesAtRepeatedPatterns(cleaned)
  cleaned = insertLineBreaksAtKnownTokens(cleaned)

  return cleaned
    // Clean up excessive consecutive newlines (but keep some structure)
    .replace(/\n{3,}/g, '\n\n')
    // Clean up lines that only contain whitespace
    .replace(/^\s+\n/gm, '\n')
}

/**
 * Append a raw terminal chunk onto an existing log buffer with dedupe.
 * - Preserves chunk boundaries (no trim-based line glueing)
 * - Drops consecutive duplicate lines
 * - Suppresses repeated npm env warning noise after first occurrence
 */
export function appendCleanTerminalChunk(existing: string, rawChunk: string): string {
  const cleaned = cleanTerminalOutput(rawChunk)
  if (!cleaned) return existing

  const incomingLines = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => line.length > 0)

  if (incomingLines.length === 0) return existing

  let next = existing
  const getRepeatParts = (line: string) => {
    const match = line.match(REPEAT_SUFFIX_PATTERN)
    if (!match) return { base: line, count: 1 }
    const count = Number.parseInt(match[2], 10)
    return {
      base: match[1],
      count: Number.isFinite(count) && count > 1 ? count : 1,
    }
  }

  const replaceLastLine = (line: string) => {
    const idx = next.lastIndexOf('\n')
    if (idx === -1) {
      next = line
      return
    }
    next = next.slice(0, idx + 1) + line
  }

  const getLastLine = () => {
    const match = next.match(/([^\n]*)$/)
    return match?.[1] ?? ''
  }

  for (let line of incomingLines) {
    const otpPromptMatch = line.match(OTP_PROMPT_PATTERN)
    if (otpPromptMatch) {
      line = otpPromptMatch[1]
    }

    if (SUPPRESS_ALWAYS_PATTERNS.some((pattern) => pattern.test(line))) {
      continue
    }

    const lastLine = getLastLine()
    const { base: lastBase, count: lastCount } = getRepeatParts(lastLine)
    const shouldCollapseAsRepeat = line === lastBase ||
      (COLLAPSE_REPEAT_PATTERNS.some((pattern) => pattern.test(line)) &&
        COLLAPSE_REPEAT_PATTERNS.some((pattern) => pattern.test(lastBase)))

    if (shouldCollapseAsRepeat) {
      const mergedCount = lastCount + 1
      replaceLastLine(mergedCount > 1 ? `${lastBase} (x${mergedCount})` : lastBase)
      continue
    }

    if (next.length > 0 && !next.endsWith('\n')) {
      next += '\n'
    }
    next += line
  }

  return next
}
