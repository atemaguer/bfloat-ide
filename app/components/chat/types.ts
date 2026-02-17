/**
 * Chat Message Types - Manus-inspired design
 *
 * Defines the structure for messages in the chat panel,
 * following Vercel AI SDK UIMessage format with extensions.
 */

// Tool action types supported by Claude and Codex
// These are display-friendly labels for the various tool operations
export type ToolActionType =
  // File operations
  | 'creating_file'
  | 'editing_file'
  | 'reading_file'
  | 'deleting_file'
  // Command execution
  | 'executing_command'
  | 'viewing_terminal'
  | 'terminating_process'
  // Project operations
  | 'check_status'
  | 'generating_image'
  | 'save_checkpoint'
  // Search operations
  | 'searching'
  | 'web_searching'
  // Reasoning operations
  | 'thinking'
  | 'reasoning'
  | 'planning'
  // Agent/subagent operations
  | 'delegating_task'
  // MCP operations
  | 'mcp_resource'
  // User interaction
  | 'asking_user'
  // Notebook operations
  | 'editing_notebook'

// Tool action for display
export interface ToolAction {
  id: string
  type: ToolActionType
  label: string // filename, command, etc.
  status: 'running' | 'completed' | 'error'
  output?: string
  exitCode?: number
  timestamp: number
}

// Text content block
export interface TextBlock {
  type: 'text'
  content: string
}

// Tool action block
export interface ToolBlock {
  type: 'tool'
  action: ToolAction
}

// Task section with collapsible content
export interface TaskBlock {
  type: 'task'
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  children: ContentBlock[]
}

// Project card
export interface ProjectBlock {
  type: 'project'
  name: string
  status: string
  icon?: string
  previewUrl?: string
}

// Markdown list
export interface ListBlock {
  type: 'list'
  items: Array<{
    label?: string
    text: string
  }>
  ordered?: boolean
}

// Heading
export interface HeadingBlock {
  type: 'heading'
  level: 1 | 2 | 3
  text: string
}

// All content block types
export type ContentBlock =
  | TextBlock
  | ToolBlock
  | TaskBlock
  | ProjectBlock
  | ListBlock
  | HeadingBlock

// User message
export interface UserChatMessage {
  id: string
  role: 'user'
  content: string
  timestamp: number
  attachments?: Array<{
    type: 'image' | 'file'
    url: string
    name: string
  }>
}

// Assistant message
export interface AssistantChatMessage {
  id: string
  role: 'assistant'
  blocks: ContentBlock[]
  timestamp: number
  isComplete?: boolean
}

// System message
export interface SystemChatMessage {
  id: string
  role: 'system'
  content: string
  timestamp: number
}

// Union type for all messages
export type ChatMessageType = UserChatMessage | AssistantChatMessage | SystemChatMessage

// Suggested follow-up action
export interface SuggestedFollowup {
  id: string
  text: string
  prompt: string
}

// Task progress for floating indicator
export interface TaskProgress {
  title: string
  current: number
  total: number
  isComplete: boolean
}

// ============================================================================
// Message Section Types - For parsing MessagePart[] into displayable sections
// ============================================================================

// Task status for collapsible sections
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

// A task section groups consecutive tool calls with optional text
export interface TaskSection {
  id: string
  title: string // Generated from tools: "Creating 3 files", "Running npm install"
  status: TaskStatus
  parts: ToolAction[] // Tools in this task
  textBefore?: string // Text that introduced this task
  summary?: string // "3 files, 1 command" for collapsed view
}

// Message section - either standalone text or a task group
export interface MessageSection {
  type: 'text' | 'task'
  content?: string // For text sections
  task?: TaskSection // For task sections
}

// Helper to generate task summary from tool actions
export function generateTaskSummary(actions: ToolAction[]): string {
  const counts: Record<string, number> = {}

  for (const action of actions) {
    switch (action.type) {
      case 'creating_file':
      case 'editing_file':
      case 'reading_file':
      case 'deleting_file':
        counts['files'] = (counts['files'] || 0) + 1
        break
      case 'executing_command':
        counts['commands'] = (counts['commands'] || 0) + 1
        break
      case 'searching':
        counts['searches'] = (counts['searches'] || 0) + 1
        break
      default:
        counts['actions'] = (counts['actions'] || 0) + 1
    }
  }

  const parts: string[] = []
  if (counts['files']) parts.push(`${counts['files']} file${counts['files'] > 1 ? 's' : ''}`)
  if (counts['commands']) parts.push(`${counts['commands']} command${counts['commands'] > 1 ? 's' : ''}`)
  if (counts['searches']) parts.push(`${counts['searches']} search${counts['searches'] > 1 ? 'es' : ''}`)
  if (counts['actions']) parts.push(`${counts['actions']} action${counts['actions'] > 1 ? 's' : ''}`)

  return parts.join(', ')
}

// Helper to generate task title from tool actions
export function generateTaskTitle(actions: ToolAction[]): string {
  if (actions.length === 0) return 'Working...'

  const firstAction = actions[0]

  // If single action, use specific title
  if (actions.length === 1) {
    switch (firstAction.type) {
      case 'creating_file':
        return `Creating ${getFileName(firstAction.label)}`
      case 'editing_file':
        return `Editing ${getFileName(firstAction.label)}`
      case 'reading_file':
        return `Reading ${getFileName(firstAction.label)}`
      case 'deleting_file':
        return `Deleting ${getFileName(firstAction.label)}`
      case 'executing_command':
        return `Running command`
      case 'searching':
        return `Searching codebase`
      default:
        return 'Working...'
    }
  }

  // Multiple actions - summarize by type
  const types = new Set(actions.map(a => a.type))

  if (types.size === 1) {
    // All same type
    switch (firstAction.type) {
      case 'creating_file':
        return `Creating ${actions.length} files`
      case 'editing_file':
        return `Editing ${actions.length} files`
      case 'reading_file':
        return `Reading ${actions.length} files`
      case 'executing_command':
        return `Running ${actions.length} commands`
      case 'searching':
        return `Performing ${actions.length} searches`
      default:
        return `Performing ${actions.length} actions`
    }
  }

  // Mixed types - generic title
  return `Implementing changes`
}

// Helper to extract filename from path
function getFileName(path: string): string {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// Determine task status from tool actions
export function getTaskStatus(actions: ToolAction[]): TaskStatus {
  if (actions.length === 0) return 'pending'

  const hasRunning = actions.some(a => a.status === 'running')
  const allComplete = actions.every(a => a.status === 'completed' || a.status === 'error')

  if (hasRunning) return 'in_progress'
  if (allComplete) return 'completed'
  return 'pending'
}

// Map tool types to display info
export const TOOL_ACTION_INFO: Record<ToolActionType, { label: string; icon: string }> = {
  // File operations
  creating_file: { label: 'Creating file', icon: 'file-plus' },
  editing_file: { label: 'Editing file', icon: 'file-edit' },
  reading_file: { label: 'Reading file', icon: 'file-code' },
  deleting_file: { label: 'Deleting file', icon: 'file-x' },
  // Command execution
  executing_command: { label: 'Executing command', icon: 'terminal' },
  viewing_terminal: { label: 'Viewing terminal', icon: 'terminal' },
  terminating_process: { label: 'Terminating process', icon: 'square' },
  // Project operations
  check_status: { label: 'Check project status', icon: 'check-circle' },
  generating_image: { label: 'Generating image', icon: 'image' },
  save_checkpoint: { label: 'Save checkpoint', icon: 'save' },
  // Search operations
  searching: { label: 'Searching', icon: 'search' },
  web_searching: { label: 'Searching web', icon: 'globe' },
  // Reasoning operations
  thinking: { label: 'Thinking', icon: 'brain' },
  reasoning: { label: 'Reasoning', icon: 'brain' },
  planning: { label: 'Planning', icon: 'list-todo' },
  // Agent operations
  delegating_task: { label: 'Delegating task', icon: 'users' },
  // MCP operations
  mcp_resource: { label: 'Reading resource', icon: 'database' },
  // User interaction
  asking_user: { label: 'Asking user', icon: 'message-circle' },
  // Notebook operations
  editing_notebook: { label: 'Editing notebook', icon: 'book-open' },
}

// Helper to convert AI SDK tool parts to our format
// Supports both Claude Agent SDK and Codex SDK tool formats
export function convertToolPartToAction(part: {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  args?: Record<string, unknown>
  result?: unknown
}): ToolAction | null {
  const toolName = part.type.replace('tool-', '')

  let actionType: ToolActionType = 'executing_command'
  let label = ''

  const args = part.args || {}

  // Check for pre-existing label from session-loaded data
  // When loading from session files, the label is already extracted and passed in args
  const preExistingLabel = (args.label as string) || ''

  switch (toolName.toLowerCase()) {
    // === Command Execution ===
    case 'bash':
    case 'shell':
    case 'commandexecution': // Codex
    case 'executing_command': // Action type (from session data)
      actionType = 'executing_command'
      label = (args.command as string) || preExistingLabel
      break
    case 'bashoutput':
    case 'viewing_terminal': // Action type
      actionType = 'viewing_terminal'
      label = (args.bash_id as string) || preExistingLabel
      break
    case 'killbash':
    case 'killshell':
    case 'terminating_process': // Action type
      actionType = 'terminating_process'
      label = (args.shell_id as string) || preExistingLabel
      break

    // === File Operations ===
    case 'read':
    case 'readfile':
    case 'reading_file': // Action type (from session data)
      actionType = 'reading_file'
      label = (args.file_path as string) || (args.filePath as string) || preExistingLabel
      break
    case 'write':
    case 'createfile':
    case 'creating_file': // Action type (from session data)
      actionType = 'creating_file'
      label = (args.file_path as string) || (args.filePath as string) || preExistingLabel
      break
    case 'edit':
    case 'updatefile':
    case 'editing_file': // Action type (from session data)
      actionType = 'editing_file'
      label = (args.file_path as string) || (args.filePath as string) || preExistingLabel
      break
    case 'deletefile':
    case 'deleting_file': // Action type (from session data)
      actionType = 'deleting_file'
      label = (args.file_path as string) || (args.filePath as string) || preExistingLabel
      break

    // === Search Operations ===
    case 'glob':
    case 'grep':
    case 'searching': // Action type (from session data)
      actionType = 'searching'
      label = (args.pattern as string) || preExistingLabel
      break
    case 'websearch':
    case 'web_searching': // Action type (from session data)
      actionType = 'web_searching'
      label = (args.query as string) || preExistingLabel
      break
    case 'webfetch':
      actionType = 'web_searching'
      label = (args.url as string) || preExistingLabel
      break

    // === Reasoning Operations ===
    case 'task':
    case 'delegating_task': // Action type (from session data)
      actionType = 'delegating_task'
      label = (args.description as string) || preExistingLabel
      break
    case 'think':
    case 'thinking':
      actionType = 'thinking'
      label = preExistingLabel
      break
    case 'reasoning': // Codex reasoning
      actionType = 'reasoning'
      label = preExistingLabel
      break

    // === User Interaction ===
    case 'askuserquestion':
    case 'asking_user': // Action type (from session data)
      actionType = 'asking_user'
      label = preExistingLabel
      break

    // === Notebook Operations ===
    case 'notebookedit':
    case 'editing_notebook': // Action type (from session data)
      actionType = 'editing_notebook'
      label = (args.notebook_path as string) || preExistingLabel
      break

    // === MCP Operations ===
    case 'listmcpresources':
    case 'readmcpresource':
    case 'mcp_resource': // Action type (from session data)
      actionType = 'mcp_resource'
      label = (args.uri as string) || (args.server as string) || preExistingLabel
      break

    // === Plan Mode ===
    case 'exitplanmode':
    case 'planning': // Action type (from session data)
      actionType = 'planning'
      label = preExistingLabel || 'Updating tasks'
      break

    // === Todo Management ===
    case 'todowrite':
      actionType = 'planning'
      label = preExistingLabel || 'Updating tasks'
      break

    // === Default ===
    default:
      // Use pre-existing label if available, otherwise use tool name
      actionType = 'executing_command'
      label = preExistingLabel || toolName
  }

  return {
    id: part.toolCallId || `tool-${Date.now()}`,
    type: actionType,
    label,
    status: part.state === 'result' ? 'completed' : part.state === 'error' ? 'error' : 'running',
    output: typeof part.result === 'string' ? part.result : undefined,
    timestamp: Date.now(),
  }
}
