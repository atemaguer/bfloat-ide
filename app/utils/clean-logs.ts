/**
 * Enhanced log cleaner for deployment logs
 * Converts line-overwriting sequences to newlines and removes escape codes
 */

/**
 * All known spinner Unicode characters used by CLI tools (ora, cli-spinners, etc.)
 */
const SPINNER_CHARS = /[⠋⠙⠹⠸⠼⠴⠦⠧⇇⠏⠇⠏⠋★⚙︎✓✗✔✖⚪⚫]+/g

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
    .replace(/\x1b\[1G\x1b\[0K/g, '\n')
    // Handle case where ESC is missing (sometimes happens in partial logs)
    .replace(/\[1G\[0K/g, '\n')
    // Remove standalone [2K (clear line) - doesn't indicate a new frame
    .replace(/\x1b\[2K/g, '')
    // Remove [2K without ESC
    .replace(/\[2K/g, '')
    // Remove cursor visibility toggles [?25l (hide) and [?25h (show)
    .replace(/\x1b\[\?25[hl]/g, '')
    // Remove standalone cursor-to-start [1G (if not followed by [0K)
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

  return cleaned
    // Clean up excessive consecutive newlines (but keep some structure)
    .replace(/\n{3,}/g, '\n\n')
    // Clean up lines that only contain whitespace
    .replace(/^\s+\n/gm, '\n')
    .trim()
}
