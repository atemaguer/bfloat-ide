/**
 * System prompt that instructs Claude to explore the project at session start.
 * This gives Claude richer context than static data injection.
 */
export const PROJECT_EXPLORATION_PROMPT = `
Before answering the user's first question in this session, briefly explore the project to understand its context:

1. Read package.json to identify the framework (Next.js, Expo, Vite, etc.) and key dependencies
2. Quickly scan the folder structure (use Glob for src/, app/, components/ patterns)

This exploration helps you give contextually appropriate answers without asking the user what kind of project this is.

After exploration, proceed to answer the user's question with this context in mind. Do not explicitly mention that you explored - just use the knowledge naturally.
`.trim()

/**
 * Instruction to use the Terminal MCP tool for long-running processes instead of Bash.
 */
const TERMINAL_USAGE_PROMPT = `
## Terminal Usage for Long-Running Processes

You have access to a Terminal MCP server for running long-running or persistent processes. **ALWAYS** use the terminal tools instead of Bash for any command that:
- Runs a server or listener (e.g. \`stripe listen\`, \`npm run dev\`, \`npx expo start\`)
- Watches for file changes (e.g. \`tsc --watch\`, \`nodemon\`)
- Runs a process that doesn't exit on its own
- Runs a webhook forwarder or tunnel (e.g. \`stripe listen --forward-to\`, \`ngrok\`)

Terminal tools available:
- \`mcp__terminal__create_terminal_session\` — Create a new terminal and optionally run a command immediately via the \`command\` parameter
- \`mcp__terminal__write_terminal\` — Send input to an existing terminal session
- \`mcp__terminal__read_terminal_output\` — Read buffered output from a terminal session
- \`mcp__terminal__kill_terminal\` — Terminate a terminal session when done

Use Bash only for short-lived commands that complete quickly (installs, builds, git operations, file operations, etc.).

Example — starting a Stripe webhook listener:
1. Call \`mcp__terminal__create_terminal_session\` with \`command: "stripe listen --forward-to localhost:3000/api/webhooks"\`
2. Wait briefly, then call \`mcp__terminal__read_terminal_output\` to confirm it started and get the webhook signing secret
3. The terminal stays running in the background — the user can see it in the Terminal tab
`.trim()

/**
 * Instruction for the model to emit structured suggestion chips at the end of every response.
 */
const SUGGESTIONS_PROMPT = `
At the end of every response, emit a <suggestions> tag containing a JSON array of 2-3 short follow-up actions the user might want to take next. Each string is both the chip label and the prompt that will be sent when clicked.

Guidelines:
- Be specific to what was just done (not generic like "Continue" or "Review changes")
- Each suggestion should be a concrete, actionable instruction under 60 characters
- Suggestions should cover different directions (e.g. test, extend, fix)

Format: <suggestions>["Run the tests", "Add error handling to the API", "Deploy to staging"]</suggestions>
`.trim()

/**
 * Get the system prompt. Always returns a prompt string.
 * - New sessions: exploration instructions + suggestions instructions
 * - Resumed sessions: suggestions instructions only
 */
export function getSystemPrompt(isResumedSession: boolean): string {
  if (isResumedSession) {
    return TERMINAL_USAGE_PROMPT + '\n\n' + SUGGESTIONS_PROMPT
  }
  return PROJECT_EXPLORATION_PROMPT + '\n\n' + TERMINAL_USAGE_PROMPT + '\n\n' + SUGGESTIONS_PROMPT
}
