import type { ChatMessage } from '@/app/types/project'
import type { SuggestedFollowup } from './types'

let nextId = 0
function makeSuggestion(text: string, prompt?: string): SuggestedFollowup {
  return { id: `suggestion-${nextId++}`, text, prompt: prompt ?? text }
}

/**
 * Try to extract suggestions from <suggestions>["..."]</suggestions> tags
 * in the last assistant message's text parts.
 */
function parseSuggestionsFromTags(messages: ChatMessage[]): SuggestedFollowup[] | null {
  if (messages.length === 0) return null

  const lastMsg = messages[messages.length - 1]
  if (lastMsg.role !== 'assistant') return null

  const parts = lastMsg.parts ?? []

  // Scan text parts for <suggestions> tags
  for (const part of parts) {
    if (part.type !== 'text' || !('text' in part) || !part.text) continue

    const match = part.text.match(/<suggestions>\s*(\[[\s\S]*?\])\s*<\/suggestions>/)
    if (!match) continue

    try {
      const parsed = JSON.parse(match[1])
      if (!Array.isArray(parsed) || parsed.length === 0) continue

      return parsed
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .slice(0, 3)
        .map((s) => makeSuggestion(s))
    } catch {
      // JSON parse failed — fall through to heuristic
    }
  }

  return null
}

/**
 * Generates next-step suggestion chips based on the last assistant message.
 *
 * First attempts to parse LLM-provided <suggestions> tags.
 * Falls back to heuristic analysis of tool calls, file paths, and bash commands.
 *
 * Tool names come in two flavors:
 *  - Live streaming: PascalCase from Claude Code ("Write", "Edit", "Bash")
 *  - Session-loaded: snake_case display types ("creating_file", "executing_command")
 */
export function generateSuggestions(messages: ChatMessage[]): SuggestedFollowup[] {
  // Reset ID counter each call for deterministic output
  nextId = 0

  // Try LLM-provided suggestions first
  const fromTags = parseSuggestionsFromTags(messages)
  if (fromTags && fromTags.length > 0) return fromTags

  // --- Heuristic fallback ---
  if (messages.length === 0) return []

  const lastMsg = messages[messages.length - 1]
  if (lastMsg.role !== 'assistant') return []

  const parts = lastMsg.parts ?? []

  // --- Collect signals from tool calls ---
  let wroteFiles = false
  let wroteTests = false
  let hasErrors = false
  let installedDeps = false
  let ranTests = false

  for (const part of parts) {
    const raw = part as Record<string, unknown>
    const toolName = ((raw.toolName as string) ?? part.type?.replace('tool-', '') ?? '').toLowerCase()
    const args = (raw.args ?? {}) as Record<string, unknown>

    // File path from live args, or label from session-loaded messages
    const filePath = ((args.file_path ?? args.path ?? args.filePath ?? args.label ?? '') as string).toLowerCase()
    // Command text
    const cmd = ((args.command ?? args.cmd ?? args.label ?? '') as string).toLowerCase()

    // Detect file writes
    if (['write', 'createfile', 'edit', 'updatefile', 'creating_file', 'editing_file'].includes(toolName)) {
      wroteFiles = true
      if (/\.(test|spec)\.(ts|tsx|js|jsx)/.test(filePath) || filePath.includes('__tests__')) {
        wroteTests = true
      }
    }

    // Detect commands
    if (['bash', 'shell', 'commandexecution', 'executing_command'].includes(toolName)) {
      if (/npm install|yarn add|pnpm add|bun add|npx expo install/.test(cmd)) installedDeps = true
      if (/npm test|yarn test|jest|vitest|pytest/.test(cmd)) ranTests = true
    }

    // Detect errors
    if (raw.state === 'error' || raw.isError) hasErrors = true
  }

  const suggestions: SuggestedFollowup[] = []

  // === Errors → fix first ===
  if (hasErrors) {
    suggestions.push(makeSuggestion('Fix the error', 'Please fix the error above'))
  }

  // === Tests written → run them ===
  if (wroteTests && suggestions.length < 3) {
    suggestions.push(makeSuggestion('Run tests', 'Run the tests to verify they pass'))
  }

  // === Files written → run app + add tests ===
  if (wroteFiles && !hasErrors) {
    if (suggestions.length < 3) {
      suggestions.push(makeSuggestion('Run the app', 'Run the app and verify the changes work'))
    }
    if (!wroteTests && suggestions.length < 3) {
      suggestions.push(makeSuggestion('Add tests', 'Add tests for the changes you just made'))
    }
  }

  // === Deps installed (without file writes) → run app ===
  if (installedDeps && !wroteFiles && suggestions.length < 3) {
    suggestions.push(makeSuggestion('Run the app', 'Run the app and check if everything works'))
  }

  // === Ran tests (without file writes) → verify ===
  if (ranTests && !wroteFiles && !hasErrors && suggestions.length < 3) {
    suggestions.push(makeSuggestion('Run the app', 'Run the app and verify everything works'))
  }

  // === Fallback ===
  if (suggestions.length === 0) {
    suggestions.push(makeSuggestion("What's next?", 'What should we work on next? Analyze the current state of the project and suggest 2-3 concrete next steps.'))
  }

  return suggestions.slice(0, 3)
}
