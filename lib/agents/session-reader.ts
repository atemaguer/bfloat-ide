/**
 * Session Reader Service
 *
 * Reads and parses session files from Claude and Codex CLI tools.
 * This allows loading conversation history directly from the AI agent's storage
 * rather than maintaining a separate database.
 *
 * Claude sessions: ~/.claude/projects/{encoded-path}/{session-id}.jsonl
 * Codex sessions: ~/.codex/sessions/{session-id}.jsonl (if applicable)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'
import type { ContentBlock, ToolAction, ToolActionType } from '@/app/components/chat/types'

// ============================================================================
// Types for parsed session data
// ============================================================================

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
  timestamp: number
}

export interface ParsedSession {
  sessionId: string
  provider: 'claude' | 'codex' | 'bfloat'
  messages: SessionMessage[]
  cwd?: string
  createdAt?: number
  lastModified?: number
}

// ============================================================================
// Claude Session Format Types (JSONL)
// ============================================================================

interface ClaudeTextContent {
  type: 'text'
  text: string
}

interface ClaudeToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface ClaudeToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

type ClaudeContentBlock = ClaudeTextContent | ClaudeToolUseContent | ClaudeToolResultContent

interface ClaudeUserMessage {
  role: 'user'
  content: string | ClaudeContentBlock[]
}

interface ClaudeAssistantMessage {
  role: 'assistant'
  content: ClaudeContentBlock[]
}

interface ClaudeSessionEntry {
  type: 'user' | 'assistant' | 'summary' | 'init' | 'result' | 'queue-operation'
  message?: ClaudeUserMessage | ClaudeAssistantMessage
  sessionId?: string
  cwd?: string
  timestamp?: string
  uuid?: string
  isMeta?: boolean // Marks injected/synthetic user messages (skill context, system reminders, etc.)
}

// ============================================================================
// Session Reader Implementation
// ============================================================================

/**
 * Get the path to Claude's session storage directory
 */
function getClaudeSessionsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

/**
 * Get the path to Codex's session storage directory
 */
function getCodexSessionsDir(): string {
  return path.join(os.homedir(), '.codex', 'sessions')
}

/**
 * Encode a project path the way Claude does for directory names
 * Claude replaces slashes AND dots with dashes
 * e.g., /Users/foo/.bfloat-ide/projects → -Users-foo--bfloat-ide-projects
 */
function encodeProjectPath(projectPath: string): string {
  // Claude encodes the absolute path by replacing both slashes and dots with dashes
  // This means /.bfloat-ide/ becomes --bfloat-ide- (dashes from / and . being replaced)
  const normalized = path.resolve(projectPath)
  return normalized.replace(/[/\\.]/g, '-')
}

/**
 * Find a Claude session file by session ID and project path
 */
async function findClaudeSessionFile(
  sessionId: string,
  projectPath?: string
): Promise<string | null> {
  const sessionsDir = getClaudeSessionsDir()

  console.log('[SessionReader] Looking for session:', {
    sessionId,
    projectPath,
    sessionsDir,
  })

  if (!fs.existsSync(sessionsDir)) {
    console.log('[SessionReader] Claude sessions directory not found:', sessionsDir)
    return null
  }

  // If we have a project path, look in that specific directory
  if (projectPath) {
    const encodedPath = encodeProjectPath(projectPath)
    const projectSessionDir = path.join(sessionsDir, encodedPath)
    const sessionFile = path.join(projectSessionDir, `${sessionId}.jsonl`)

    console.log('[SessionReader] Checking project-specific path:', {
      encodedPath,
      projectSessionDir,
      sessionFile,
      exists: fs.existsSync(sessionFile),
    })

    if (fs.existsSync(sessionFile)) {
      return sessionFile
    }

    // Also check if directory exists and list files
    if (fs.existsSync(projectSessionDir)) {
      const files = fs.readdirSync(projectSessionDir)
      console.log('[SessionReader] Directory exists, files:', files)
    } else {
      console.log('[SessionReader] Project directory does not exist:', projectSessionDir)
    }
  }

  // Otherwise, search all project directories
  const projectDirs = fs.readdirSync(sessionsDir)
  console.log('[SessionReader] Searching all directories, total:', projectDirs.length)

  for (const dir of projectDirs) {
    const sessionFile = path.join(sessionsDir, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(sessionFile)) {
      console.log('[SessionReader] Found session in directory:', dir)
      return sessionFile
    }
  }

  console.log('[SessionReader] Claude session file not found for ID:', sessionId)
  return null
}

/**
 * Find a Codex session file by session ID
 * Codex stores sessions as rollout-{date}-{session-id}.jsonl in year/month/day directories
 * Structure: ~/.codex/sessions/{year}/{month}/{day}/rollout-{timestamp}-{uuid}.jsonl
 */
async function findCodexSessionFile(sessionId: string): Promise<string | null> {
  const sessionsDir = getCodexSessionsDir()

  console.log('[SessionReader] Looking for Codex session:', {
    sessionId,
    sessionsDir,
  })

  if (!fs.existsSync(sessionsDir)) {
    console.log('[SessionReader] Codex sessions directory not found:', sessionsDir)
    return null
  }

  // Recursively search through year/month/day directory structure
  // Structure: sessions/{year}/{month}/{day}/rollout-{timestamp}-{uuid}.jsonl
  try {
    const years = fs.readdirSync(sessionsDir)
    for (const year of years) {
      const yearPath = path.join(sessionsDir, year)
      if (!fs.statSync(yearPath).isDirectory()) continue

      const months = fs.readdirSync(yearPath)
      for (const month of months) {
        const monthPath = path.join(yearPath, month)
        if (!fs.statSync(monthPath).isDirectory()) continue

        const days = fs.readdirSync(monthPath)
        for (const day of days) {
          const dayPath = path.join(monthPath, day)
          if (!fs.statSync(dayPath).isDirectory()) continue

          const files = fs.readdirSync(dayPath)
          for (const file of files) {
            if (file.endsWith('.jsonl') && file.includes(sessionId)) {
              const filePath = path.join(dayPath, file)
              console.log('[SessionReader] Found Codex session file:', filePath)
              return filePath
            }
          }
        }
      }
    }

    // Also check for files directly in sessions dir (older format)
    for (const file of years) {
      const filePath = path.join(sessionsDir, file)
      if (file.endsWith('.jsonl') && file.includes(sessionId) && fs.statSync(filePath).isFile()) {
        console.log('[SessionReader] Found Codex session file (legacy):', filePath)
        return filePath
      }
    }
  } catch (err) {
    console.error('[SessionReader] Error searching Codex sessions:', err)
  }

  console.log('[SessionReader] Codex session file not found for ID:', sessionId)
  return null
}

/**
 * Convert Claude tool content to our ToolAction format
 */
function convertClaudeToolToAction(toolContent: ClaudeToolUseContent): ToolAction {
  const toolName = toolContent.name.toLowerCase()
  const args = toolContent.input || {}

  let actionType: ToolActionType = 'executing_command'
  let label = ''

  switch (toolName) {
    // File operations
    case 'read':
      actionType = 'reading_file'
      label = (args.file_path as string) || ''
      break
    case 'write':
      actionType = 'creating_file'
      label = (args.file_path as string) || ''
      break
    case 'edit':
      actionType = 'editing_file'
      label = (args.file_path as string) || ''
      break

    // Command execution
    case 'bash':
      actionType = 'executing_command'
      label = (args.command as string) || ''
      break

    // Search operations
    case 'glob':
      actionType = 'searching'
      label = (args.pattern as string) || ''
      break
    case 'grep':
      actionType = 'searching'
      label = (args.pattern as string) || ''
      break
    case 'websearch':
      actionType = 'web_searching'
      label = (args.query as string) || ''
      break

    // Reasoning
    case 'task':
      actionType = 'delegating_task'
      label = (args.description as string) || ''
      break
    case 'todowrite':
      actionType = 'planning'
      label = 'Updating tasks'
      break

    default:
      actionType = 'executing_command'
      label = toolName
  }

  return {
    id: toolContent.id,
    type: actionType,
    label,
    status: 'completed', // Tools in history are always completed
    timestamp: Date.now(),
  }
}

/**
 * Parse Claude session entries into our message format
 *
 * Claude's JSONL format has:
 * - type: "user" with message.content containing either:
 *   - Actual user text: [{ type: "text", text: "..." }]
 *   - Tool results: [{ type: "tool_result", tool_use_id: "...", content: "..." }]
 * - type: "assistant" with message.content containing text and tool_use blocks
 *
 * We skip tool_result "user" entries since they're not actual user messages.
 */
function parseClaudeEntry(entry: ClaudeSessionEntry): SessionMessage | null {
  const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()

  if (entry.type === 'user' && entry.message) {
    // Skip injected/synthetic user messages (skill context, system reminders, etc.)
    // Claude Code CLI marks these with isMeta: true in the JSONL
    if (entry.isMeta) {
      return null
    }

    const userMessage = entry.message as ClaudeUserMessage

    // Handle string content directly
    if (typeof userMessage.content === 'string') {
      return {
        id: entry.uuid || `msg-${Date.now()}`,
        role: 'user',
        content: userMessage.content,
        timestamp,
      }
    }

    // For array content, check what type of content we have
    const contentArray = userMessage.content as ClaudeContentBlock[]

    // Check if this is a tool_result entry (not an actual user message)
    const hasToolResult = contentArray.some((c) => c.type === 'tool_result')
    const textBlocks = contentArray.filter((c): c is ClaudeTextContent => c.type === 'text')

    // Skip entries that are only tool results (these aren't actual user messages)
    if (hasToolResult && textBlocks.length === 0) {
      console.log('[SessionReader] Skipping tool_result user entry')
      return null
    }

    // Extract text content
    const content = textBlocks.map((c) => c.text).join('\n')

    // Skip if no meaningful content
    if (!content.trim()) {
      return null
    }

    return {
      id: entry.uuid || `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp,
    }
  }

  if (entry.type === 'assistant' && entry.message) {
    const assistantMessage = entry.message as ClaudeAssistantMessage
    const blocks: ContentBlock[] = []

    for (const content of assistantMessage.content) {
      if (content.type === 'text' && content.text.trim()) {
        blocks.push({
          type: 'text',
          content: content.text,
        })
      } else if (content.type === 'tool_use') {
        blocks.push({
          type: 'tool',
          action: convertClaudeToolToAction(content),
        })
      }
    }

    // Only return if we have content
    if (blocks.length === 0) {
      return null
    }

    return {
      id: entry.uuid || `msg-${Date.now()}`,
      role: 'assistant',
      content: blocks,
      timestamp,
    }
  }

  return null
}

/**
 * Read and parse a Claude session file
 *
 * Claude's session files log each content block as a separate entry, even when they're
 * part of the same assistant turn. We need to merge consecutive assistant entries that
 * follow each other (before a user message or end of conversation).
 */
async function readClaudeSession(sessionFile: string): Promise<ParsedSession | null> {
  console.log('[SessionReader] Reading Claude session:', sessionFile)

  const rawMessages: SessionMessage[] = []
  let sessionId: string | undefined
  let cwd: string | undefined
  let lineCount = 0
  let parsedCount = 0

  try {
    const fileStream = fs.createReadStream(sessionFile)
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.trim()) continue
      lineCount++

      try {
        const entry = JSON.parse(line) as ClaudeSessionEntry

        // Extract session metadata from user/assistant entries
        if (entry.sessionId) {
          sessionId = entry.sessionId
        }
        if (entry.cwd) {
          cwd = entry.cwd
        }

        const message = parseClaudeEntry(entry)
        if (message) {
          parsedCount++
          rawMessages.push(message)
        }
      } catch (parseError) {
        console.warn('[SessionReader] Failed to parse line:', line.substring(0, 100))
      }
    }

    // Merge consecutive assistant messages into single messages
    // This matches how the UI builds messages during streaming
    const messages: SessionMessage[] = []
    let currentAssistantMessage: SessionMessage | null = null

    for (const msg of rawMessages) {
      if (msg.role === 'user') {
        // Flush any pending assistant message
        if (currentAssistantMessage) {
          messages.push(currentAssistantMessage)
          currentAssistantMessage = null
        }
        messages.push(msg)
      } else if (msg.role === 'assistant') {
        if (currentAssistantMessage) {
          // Merge content blocks into current assistant message
          const existingBlocks = currentAssistantMessage.content as ContentBlock[]
          const newBlocks = msg.content as ContentBlock[]
          currentAssistantMessage.content = [...existingBlocks, ...newBlocks]
          // Update timestamp to latest
          currentAssistantMessage.timestamp = msg.timestamp
        } else {
          // Start new assistant message
          currentAssistantMessage = {
            ...msg,
            content: Array.isArray(msg.content) ? [...msg.content] : msg.content,
          }
        }
      }
    }

    // Don't forget the last assistant message
    if (currentAssistantMessage) {
      messages.push(currentAssistantMessage)
    }

    // Debug logging
    const userMsgs = messages.filter(m => m.role === 'user')
    const assistantMsgs = messages.filter(m => m.role === 'assistant')
    const textBlocks = assistantMsgs.reduce((count, m) => {
      if (Array.isArray(m.content)) {
        return count + m.content.filter(c => c.type === 'text').length
      }
      return count
    }, 0)
    const toolBlocks = assistantMsgs.reduce((count, m) => {
      if (Array.isArray(m.content)) {
        return count + m.content.filter(c => c.type === 'tool').length
      }
      return count
    }, 0)

    console.log('[SessionReader] Claude parsing complete:', {
      lineCount,
      rawMessagesCount: rawMessages.length,
      mergedMessageCount: messages.length,
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      textBlocks,
      toolBlocks,
      sessionId,
      cwd,
    })

    const stats = fs.statSync(sessionFile)

    return {
      sessionId: sessionId || path.basename(sessionFile, '.jsonl'),
      provider: 'claude',
      messages,
      cwd,
      createdAt: stats.birthtimeMs,
      lastModified: stats.mtimeMs,
    }
  } catch (error) {
    console.error('[SessionReader] Error reading Claude session:', error)
    return null
  }
}

/**
 * Codex session entry types (actual format from ~/.codex/sessions)
 *
 * Structure:
 * - Session meta: { type: "session_meta", payload: { id: "uuid", cwd: "...", ... } }
 * - User messages: { type: "event_msg", payload: { type: "user_message", message: "...", ... } }
 * - Assistant messages: { type: "response_item", payload: { type: "message", role: "assistant", content: [...] } }
 * - Function calls: { type: "response_item", payload: { type: "function_call", name: "...", arguments: "...", call_id: "..." } }
 */

interface CodexSessionMetaEntry {
  type: 'session_meta'
  timestamp: string
  payload: {
    id: string
    cwd?: string
    timestamp?: string
  }
}

interface CodexEventMsgEntry {
  type: 'event_msg'
  timestamp: string
  payload: {
    type: 'user_message' | 'agent_reasoning' | 'token_count' | string
    message?: string
    text?: string
    images?: unknown[]
  }
}

interface CodexResponseItemMessageEntry {
  type: 'response_item'
  timestamp: string
  payload: {
    type: 'message'
    role: 'user' | 'assistant' | 'system'
    content: Array<{ type: string; text?: string }>
  }
}

interface CodexResponseItemFunctionCallEntry {
  type: 'response_item'
  timestamp: string
  payload: {
    type: 'function_call'
    name: string
    arguments: string
    call_id: string
  }
}

interface CodexResponseItemFunctionOutputEntry {
  type: 'response_item'
  timestamp: string
  payload: {
    type: 'function_call_output'
    call_id: string
    output: string
  }
}

interface CodexResponseItemReasoningEntry {
  type: 'response_item'
  timestamp: string
  payload: {
    type: 'reasoning'
    id?: string
    text: string
  }
}

type CodexSessionEntry =
  | CodexSessionMetaEntry
  | CodexEventMsgEntry
  | CodexResponseItemMessageEntry
  | CodexResponseItemFunctionCallEntry
  | CodexResponseItemFunctionOutputEntry
  | CodexResponseItemReasoningEntry
  | { type: string; timestamp?: string; payload?: unknown }

/**
 * Parse a Codex session entry into our message format
 */
function parseCodexEntry(entry: CodexSessionEntry, entryTimestamp?: string): SessionMessage | null {
  const timestamp = entryTimestamp ? new Date(entryTimestamp).getTime() : Date.now()

  // Handle user messages from event_msg entries
  // Note: We skip 'agent_reasoning' events here because they duplicate 'response_item' with 'reasoning' type
  // The response_item entries are the authoritative saved items
  if (entry.type === 'event_msg') {
    const eventEntry = entry as CodexEventMsgEntry
    if (eventEntry.payload?.type === 'user_message' && eventEntry.payload.message) {
      return {
        id: `codex-user-${timestamp}`,
        role: 'user',
        content: eventEntry.payload.message,
        timestamp,
      }
    }
    return null
  }

  // Handle response_item entries
  if (entry.type === 'response_item' && 'payload' in entry && entry.payload) {
    const payload = entry.payload as {
      type: string
      role?: string
      content?: Array<{ type: string; text?: string }>
      name?: string
      arguments?: string
      call_id?: string
    }

    // Assistant messages
    if (payload.type === 'message' && payload.role === 'assistant') {
      const blocks: ContentBlock[] = []
      for (const content of payload.content || []) {
        // Handle output_text (assistant responses)
        if ((content.type === 'output_text' || content.type === 'text') && content.text) {
          blocks.push({
            type: 'text',
            content: content.text,
          })
        }
      }

      if (blocks.length > 0) {
        return {
          id: `codex-assistant-${timestamp}`,
          role: 'assistant',
          content: blocks,
          timestamp,
        }
      }
    }

    // Skip user messages in response_item - we already handle them via event_msg with 'user_message' type
    // This avoids duplicate user messages in the chat history
    // Note: response_item user messages include system context (AGENTS.md, environment_context) which we don't want anyway

    // Function calls (tool use)
    if (payload.type === 'function_call' && payload.name) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(payload.arguments || '{}')
      } catch {
        // Ignore parse errors
      }

      const toolName = payload.name.toLowerCase()
      let actionType: ToolActionType = 'executing_command'
      let label = ''

      // Map function names to action types
      if (toolName === 'shell_command' || toolName === 'shell') {
        actionType = 'executing_command'
        label = (args.command as string) || ''
      } else if (toolName === 'read_file' || toolName === 'str_replace_editor') {
        actionType = toolName.includes('replace') ? 'editing_file' : 'reading_file'
        label = (args.path as string) || (args.file_path as string) || ''
      } else if (toolName === 'write_file') {
        actionType = 'creating_file'
        label = (args.path as string) || ''
      } else {
        label = `${payload.name}`
      }

      return {
        id: payload.call_id || `codex-tool-${timestamp}`,
        role: 'assistant',
        content: [{
          type: 'tool',
          action: {
            id: payload.call_id || `tool-${timestamp}`,
            type: actionType,
            label,
            status: 'completed',
            timestamp,
          },
        }] as ContentBlock[],
        timestamp,
      }
    }

    // Reasoning items - these contain the agent's thinking/planning text
    // Codex SDK stores reasoning with a 'summary' array containing summary_text objects.
    // The binary sometimes constructs `text` by concatenating summary entries with `+`,
    // producing the literal string "undefined" when a summary entry is missing its text.
    // Prefer the summary array (raw data) over text (potentially buggy concatenation).
    if (payload.type === 'reasoning') {
      const reasoningPayload = payload as {
        type: 'reasoning'
        id?: string
        text?: string // Direct text (may contain "undefined" artifact)
        summary?: Array<{ type: string; text?: string }> // Summary array format (raw data)
      }

      // Prefer summary array (raw data) over text (potentially buggy concatenation)
      let reasoningText: string | undefined
      if (reasoningPayload.summary && reasoningPayload.summary.length > 0) {
        reasoningText = reasoningPayload.summary
          .filter(s => s.type === 'summary_text' && s.text)
          .map(s => s.text)
          .join('\n')
      }

      // Fall back to text field, stripping any trailing "undefined" artifact
      if (!reasoningText && reasoningPayload.text) {
        reasoningText = reasoningPayload.text.replace(/undefined$/g, '').trimEnd()
      }

      if (reasoningText) {
        return {
          id: reasoningPayload.id || `codex-reasoning-${timestamp}`,
          role: 'assistant',
          content: [{
            type: 'text',
            content: reasoningText,
          }] as ContentBlock[],
          timestamp,
        }
      }
    }
  }

  return null
}

/**
 * Read and parse a Codex session file
 */
async function readCodexSession(sessionFile: string): Promise<ParsedSession | null> {
  console.log('[SessionReader] Reading Codex session:', sessionFile)

  const messages: SessionMessage[] = []
  let sessionId: string | undefined
  let cwd: string | undefined

  try {
    const fileStream = fs.createReadStream(sessionFile)
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    })

    let lineCount = 0
    let parsedCount = 0

    for await (const line of rl) {
      if (!line.trim()) continue
      lineCount++

      try {
        const entry = JSON.parse(line) as CodexSessionEntry

        // Extract session metadata from session_meta entry
        if (entry.type === 'session_meta') {
          const metaEntry = entry as CodexSessionMetaEntry
          sessionId = metaEntry.payload?.id
          cwd = metaEntry.payload?.cwd
          console.log('[SessionReader] Codex session meta:', { sessionId, cwd })
          continue
        }

        const message = parseCodexEntry(entry, entry.timestamp)
        if (message) {
          parsedCount++
          messages.push(message)
        }
      } catch (parseError) {
        console.warn('[SessionReader] Failed to parse Codex line:', line.substring(0, 100))
      }
    }

    // Debug: Log detailed message breakdown
    const userMsgs = messages.filter(m => m.role === 'user')
    const assistantMsgs = messages.filter(m => m.role === 'assistant')
    const textMsgs = assistantMsgs.filter(m => Array.isArray(m.content) && m.content.some(c => c.type === 'text'))
    const toolMsgs = assistantMsgs.filter(m => Array.isArray(m.content) && m.content.some(c => c.type === 'tool'))
    const reasoningMsgs = messages.filter(m => m.id.includes('reasoning'))

    console.log('[SessionReader] Codex parsing complete:', {
      lineCount,
      parsedCount,
      messageCount: messages.length,
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      textMessages: textMsgs.length,
      toolMessages: toolMsgs.length,
      reasoningMessages: reasoningMsgs.length,
      sessionId,
      cwd,
    })

    // Debug: Log text message content if found
    if (textMsgs.length > 0) {
      const firstTextMsg = textMsgs[0]
      const textContent = Array.isArray(firstTextMsg.content)
        ? firstTextMsg.content.filter(c => c.type === 'text').map(c => (c as { content: string }).content).join('')
        : ''
      console.log('[SessionReader] Text message found:', {
        id: firstTextMsg.id,
        contentBlocks: Array.isArray(firstTextMsg.content) ? firstTextMsg.content.length : 0,
        textPreview: textContent.substring(0, 100) + '...',
      })
    } else {
      console.warn('[SessionReader] WARNING: No text messages found in Codex session!')
    }

    const stats = fs.statSync(sessionFile)

    return {
      sessionId: sessionId || path.basename(sessionFile, '.jsonl'),
      provider: 'codex',
      messages,
      cwd,
      createdAt: stats.birthtimeMs,
      lastModified: stats.mtimeMs,
    }
  } catch (error) {
    console.error('[SessionReader] Error reading Codex session:', error)
    return null
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Read a session by ID and provider
 */
export async function readSession(
  sessionId: string,
  provider: 'claude' | 'codex' | 'bfloat',
  projectPath?: string
): Promise<ParsedSession | null> {
  console.log('[SessionReader] Reading session:', { sessionId, provider, projectPath })

  // Bfloat uses Claude SDK, so sessions are stored in the same format
  if (provider === 'claude' || provider === 'bfloat') {
    const sessionFile = await findClaudeSessionFile(sessionId, projectPath)
    if (!sessionFile) return null
    const session = await readClaudeSession(sessionFile)
    // Preserve the original provider in the parsed session
    if (session) {
      session.provider = provider
    }
    return session
  }

  if (provider === 'codex') {
    const sessionFile = await findCodexSessionFile(sessionId)
    if (!sessionFile) return null
    return readCodexSession(sessionFile)
  }

  return null
}

/**
 * List available sessions for a project
 */
export async function listSessions(
  provider: 'claude' | 'codex' | 'bfloat',
  projectPath?: string
): Promise<Array<{ sessionId: string; lastModified: number }>> {
  const sessions: Array<{ sessionId: string; lastModified: number }> = []

  // Bfloat uses Claude SDK, so sessions are stored in the same location
  if ((provider === 'claude' || provider === 'bfloat') && projectPath) {
    const sessionsDir = getClaudeSessionsDir()
    const encodedPath = encodeProjectPath(projectPath)
    const projectSessionDir = path.join(sessionsDir, encodedPath)

    if (fs.existsSync(projectSessionDir)) {
      const files = fs.readdirSync(projectSessionDir)
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const sessionFile = path.join(projectSessionDir, file)
          const stats = fs.statSync(sessionFile)
          sessions.push({
            sessionId: path.basename(file, '.jsonl'),
            lastModified: stats.mtimeMs,
          })
        }
      }
    }
  }

  // Sort by last modified, newest first
  sessions.sort((a, b) => b.lastModified - a.lastModified)

  return sessions
}

/**
 * Convert parsed session to Chat-compatible message format
 */
export function sessionToMessages(
  session: ParsedSession
): Array<{
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks?: ContentBlock[]
  timestamp: number
}> {
  const result = session.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'user') {
        return {
          id: m.id,
          role: 'user' as const,
          content: typeof m.content === 'string' ? m.content : '',
          timestamp: m.timestamp,
        }
      }

      // For assistant messages, extract text and preserve blocks
      const blocks = Array.isArray(m.content) ? m.content : []
      const textContent = blocks
        .filter((b): b is { type: 'text'; content: string } => b.type === 'text')
        .map((b) => b.content)
        .join('\n')

      return {
        id: m.id,
        role: 'assistant' as const,
        content: textContent,
        blocks,
        timestamp: m.timestamp,
      }
    })

  // Debug: Log the conversion results
  const textMsgs = result.filter(m => m.role === 'assistant' && m.blocks?.some(b => b.type === 'text'))
  console.log('[sessionToMessages] Converted messages:', {
    total: result.length,
    userMessages: result.filter(m => m.role === 'user').length,
    assistantMessages: result.filter(m => m.role === 'assistant').length,
    messagesWithTextBlocks: textMsgs.length,
  })

  if (textMsgs.length > 0) {
    const firstText = textMsgs[0]
    console.log('[sessionToMessages] First text message:', {
      id: firstText.id,
      contentLength: firstText.content.length,
      blocksCount: firstText.blocks?.length || 0,
      firstBlockType: firstText.blocks?.[0]?.type,
      firstBlockHasContent: !!(firstText.blocks?.[0] as { content?: string })?.content,
    })
  }

  return result
}
