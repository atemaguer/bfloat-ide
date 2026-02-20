/**
 * Codex Agent Provider
 *
 * Implementation of the AgentProvider interface using the official OpenAI Codex SDK.
 * Uses the SDK's Thread API for session management and streaming.
 */

import {
  Codex,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type AgentMessageItem,
  type ReasoningItem,
  type CommandExecutionItem,
  type FileChangeItem,
  type McpToolCallItem,
  type TodoListItem,
  type ErrorItem,
  type Usage,
} from '@openai/codex-sdk'

import type {
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
  AgentMessage,
  AgentModel,
  AgentSessionState,
  McpServerConfig,
  McpHttpServerConfig,
  ToolCallContent,
  ErrorContent,
  InitContent,
  DoneContent,
} from '../types'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Logging prefix for easy identification
const LOG_PREFIX = '[Codex Provider]'

// Codex auth file path for checking authentication
const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex')
const CODEX_AUTH_PATH = path.join(DEFAULT_CODEX_HOME, 'auth.json')

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

/**
 * Find the Codex binary path.
 *
 * The SDK ships the binary in platform-specific packages (e.g.
 * `@openai/codex-darwin-arm64`) rather than in `@openai/codex-sdk` itself.
 * The SDK's own resolution uses `createRequire(import.meta.url)` which
 * doesn't work in Electron's bundled context, so we resolve manually.
 */
function findCodexBinaryPath(): string | undefined {
  const { platform, arch } = process

  // Map platform/arch to SDK's target triple and platform package name
  const platformMap: Record<string, { triple: string; pkg: string }> = {
    'darwin-arm64': { triple: 'aarch64-apple-darwin', pkg: '@openai/codex-darwin-arm64' },
    'darwin-x64': { triple: 'x86_64-apple-darwin', pkg: '@openai/codex-darwin-x64' },
    'linux-arm64': { triple: 'aarch64-unknown-linux-musl', pkg: '@openai/codex-linux-arm64' },
    'linux-x64': { triple: 'x86_64-unknown-linux-musl', pkg: '@openai/codex-linux-x64' },
    'win32-arm64': { triple: 'aarch64-pc-windows-msvc', pkg: '@openai/codex-win32-arm64' },
    'win32-x64': { triple: 'x86_64-pc-windows-msvc', pkg: '@openai/codex-win32-x64' },
  }

  const key = `${platform}-${arch}`
  const entry = platformMap[key]

  if (!entry) {
    console.warn(`${LOG_PREFIX} Unsupported platform: ${key}`)
    return undefined
  }

  const { triple, pkg } = entry
  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex'
  const pkgDir = pkg.replace('@openai/', '')

  // Search in the platform-specific package (where the binary actually lives)
  const searchPaths = [
    // Development: from cwd
    path.join(process.cwd(), 'node_modules', '@openai', pkgDir, 'vendor', triple, 'codex', binaryName),
    // Production: from __dirname (main process), go up to find node_modules
    path.join(__dirname, '..', '..', 'node_modules', '@openai', pkgDir, 'vendor', triple, 'codex', binaryName),
    path.join(__dirname, '..', '..', '..', 'node_modules', '@openai', pkgDir, 'vendor', triple, 'codex', binaryName),
    // Electron app.asar.unpacked
    path.join(__dirname, '..', '..', 'app.asar.unpacked', 'node_modules', '@openai', pkgDir, 'vendor', triple, 'codex', binaryName),
  ]

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      console.log(`${LOG_PREFIX} Found Codex binary at: ${p}`)
      return p
    }
  }

  console.warn(`${LOG_PREFIX} Codex binary not found in any search path`)
  return undefined
}

// Available Codex models
const CODEX_MODELS: AgentModel[] = [
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'codex',
    description: 'Latest agentic coding model — 25% faster, strongest reasoning',
    contextWindow: 192000,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2 Codex',
    provider: 'codex',
    description: 'Advanced coding model for real-world engineering',
    contextWindow: 192000,
  },
  {
    id: 'o4-mini',
    name: 'O4 Mini',
    provider: 'codex',
    description: 'Fast and efficient model',
    contextWindow: 128000,
  },
]

/**
 * Convert Codex SDK ThreadEvent to AgentMessage
 */
function convertThreadEvent(event: ThreadEvent, sessionId: string): AgentMessage | null {
  console.log(`${LOG_PREFIX} Converting event type: ${event.type}`)
  console.log(`${LOG_PREFIX} Full event:`, JSON.stringify(event, null, 2).substring(0, 500))

  switch (event.type) {
    case 'thread.started':
      console.log(`${LOG_PREFIX} thread.started event:`, {
        thread_id: event.thread_id,
        fallbackSessionId: sessionId,
        usingThreadId: !!event.thread_id,
      })
      return {
        type: 'init',
        content: {
          sessionId: event.thread_id || sessionId,
          availableTools: [],
          model: 'codex',
        } satisfies InitContent,
        metadata: {
          timestamp: Date.now(),
        },
      }

    case 'item.completed': {
      const item = event.item
      return convertThreadItem(item)
    }

    case 'item.started':
    case 'item.updated':
      // Skip started/updated events to avoid duplicate UI items
      // The UI would need to update items by ID to handle these properly
      // For now, we only emit on item.completed
      return null

    case 'turn.completed':
      return {
        type: 'done',
        content: {
          sessionId,
          result: undefined,
          interrupted: false,
        } satisfies DoneContent,
        metadata: {
          timestamp: Date.now(),
          tokens: event.usage?.input_tokens + event.usage?.output_tokens,
        },
      }

    case 'turn.failed':
      return {
        type: 'error',
        content: {
          code: 'turn_failed',
          message: event.error.message,
          recoverable: false,
        } satisfies ErrorContent,
        metadata: {
          timestamp: Date.now(),
        },
      }

    case 'error':
      return {
        type: 'error',
        content: {
          code: 'stream_error',
          message: event.message,
          recoverable: false,
        } satisfies ErrorContent,
        metadata: {
          timestamp: Date.now(),
        },
      }

    default:
      return null
  }
}

/**
 * Convert a ThreadItem to AgentMessage
 */
function convertThreadItem(item: ThreadItem): AgentMessage | null {
  console.log(`${LOG_PREFIX} Converting item type: ${item.type}`)
  console.log(`${LOG_PREFIX} Full item:`, JSON.stringify(item, null, 2))

  switch (item.type) {
    case 'agent_message': {
      const msgItem = item as AgentMessageItem
      return {
        type: 'text',
        content: msgItem.text,
        metadata: {
          timestamp: Date.now(),
        },
      }
    }

    case 'reasoning': {
      // The SDK types say ReasoningItem has `text: string`, but at runtime
      // the Codex binary may emit reasoning items with only a `summary` array
      // (matching the OpenAI Responses API format). Additionally, the binary
      // sometimes constructs `text` by concatenating summary entries with `+`,
      // which produces the literal string "undefined" when a summary entry
      // is missing its `text` field.
      const reasoningItem = item as ReasoningItem & {
        summary?: Array<{ type: string; text?: string }>
      }

      // Prefer summary array (raw data) over text (potentially buggy concatenation)
      let reasoningText: string | undefined
      if (reasoningItem.summary && reasoningItem.summary.length > 0) {
        reasoningText = reasoningItem.summary
          .filter((s) => s.type === 'summary_text' && s.text)
          .map((s) => s.text)
          .join('\n')
      }

      // Fall back to text field, stripping any trailing "undefined" artifact
      if (!reasoningText && reasoningItem.text) {
        reasoningText = reasoningItem.text.replace(/undefined$/g, '').trimEnd()
      }

      if (!reasoningText) return null

      return {
        type: 'reasoning',
        content: reasoningText,
        metadata: {
          timestamp: Date.now(),
        },
      }
    }

    case 'command_execution': {
      const cmdItem = item as CommandExecutionItem
      return {
        type: 'tool_call',
        content: {
          id: cmdItem.id,
          name: 'shell',
          input: { command: cmdItem.command },
          status: cmdItem.status === 'completed' ? 'completed' : cmdItem.status === 'failed' ? 'error' : 'running',
        } satisfies ToolCallContent,
        metadata: {
          timestamp: Date.now(),
          output: cmdItem.aggregated_output,
          exitCode: cmdItem.exit_code,
        },
      }
    }

    case 'file_change': {
      const fileItem = item as FileChangeItem
      const changes = fileItem.changes.map((c) => `${c.kind}: ${c.path}`).join('\n')
      return {
        type: 'tool_call',
        content: {
          id: fileItem.id,
          name: 'file_change',
          input: { changes: fileItem.changes },
          status: fileItem.status === 'completed' ? 'completed' : 'error',
        } satisfies ToolCallContent,
        metadata: {
          timestamp: Date.now(),
          output: changes,
        },
      }
    }

    case 'mcp_tool_call': {
      const mcpItem = item as McpToolCallItem
      return {
        type: 'tool_call',
        content: {
          id: mcpItem.id,
          name: `${mcpItem.server}:${mcpItem.tool}`,
          input: mcpItem.arguments as Record<string, unknown>,
          status: mcpItem.status === 'completed' ? 'completed' : mcpItem.status === 'failed' ? 'error' : 'running',
        } satisfies ToolCallContent,
        metadata: {
          timestamp: Date.now(),
          output: mcpItem.result ? JSON.stringify(mcpItem.result) : mcpItem.error?.message,
        },
      }
    }

    case 'todo_list': {
      const todoItem = item as TodoListItem
      const todoText = todoItem.items
        .map((t) => `${t.completed ? '✓' : '○'} ${t.text}`)
        .join('\n')
      return {
        type: 'text',
        content: `**Todo List:**\n${todoText}`,
        metadata: {
          timestamp: Date.now(),
          isTodoList: true,
        },
      }
    }

    case 'error': {
      const errorItem = item as ErrorItem
      return {
        type: 'error',
        content: {
          code: 'item_error',
          message: errorItem.message,
          recoverable: true,
        } satisfies ErrorContent,
        metadata: {
          timestamp: Date.now(),
        },
      }
    }

    default:
      return null
  }
}

/**
 * Convert our McpServerConfig entries to Codex CLI config format.
 * The registry already filters out SDK servers for Codex, so we only need
 * to reshape HTTP/SSE configs into the Codex TOML format.
 */
function buildMcpConfigOverrides(
  mcpServers?: Record<string, McpServerConfig>
): Record<string, Record<string, unknown>> | undefined {
  if (!mcpServers) return undefined

  const mcp_servers: Record<string, Record<string, unknown>> = {}

  for (const [name, config] of Object.entries(mcpServers)) {
    const cfg = config as McpHttpServerConfig
    if (cfg.type !== 'http' && cfg.type !== 'sse') continue
    if (!cfg.url) continue

    const entry: Record<string, unknown> = { url: cfg.url }
    if (cfg.headers && Object.keys(cfg.headers).length > 0) {
      entry.http_headers = cfg.headers
    }
    mcp_servers[name] = entry
  }

  return Object.keys(mcp_servers).length > 0 ? mcp_servers : undefined
}

/**
 * Map our permission mode to Codex SDK options
 */
function mapPermissionMode(mode?: string): { approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted'; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' } {
  switch (mode) {
    case 'bypassPermissions':
      return {
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
      }
    case 'acceptEdits':
      return {
        approvalPolicy: 'never',
        sandboxMode: 'workspace-write',
      }
    case 'plan':
      return {
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only',
      }
    default:
      return {
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
      }
  }
}

/**
 * Codex Agent Session Implementation using SDK
 */
class CodexAgentSession implements AgentSession {
  readonly id: string
  readonly provider: 'codex' = 'codex'

  private state: AgentSessionState
  private thread: Thread | null = null
  private threadId: string | null = null
  private abortController: AbortController | null = null

  constructor(
    sessionId: string,
    private codex: Codex,
    private options: AgentSessionOptions,
    resumeThreadId?: string
  ) {
    this.id = sessionId
    this.threadId = resumeThreadId || null
    this.state = {
      id: sessionId,
      status: 'idle',
      messageCount: 0,
      totalTokens: 0,
      totalCost: 0, // Codex is included in ChatGPT subscription
      startTime: Date.now(),
    }
    console.log(`${LOG_PREFIX} Session created:`, {
      sessionId,
      cwd: options.cwd,
      model: options.model,
      permissionMode: options.permissionMode,
      resumeThreadId: resumeThreadId || 'none',
    })
  }

  async *prompt(message: string): AsyncIterable<AgentMessage> {
    console.log(`${LOG_PREFIX} ========================================`)
    console.log(`${LOG_PREFIX} STARTING CODEX AGENT SESSION (SDK)`)
    console.log(`${LOG_PREFIX} Session ID: ${this.id}`)
    console.log(`${LOG_PREFIX} Model: ${this.options.model || 'default'}`)
    console.log(`${LOG_PREFIX} CWD: ${this.options.cwd}`)
    console.log(`${LOG_PREFIX} Prompt: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`)
    console.log(`${LOG_PREFIX} ========================================`)

    this.state.status = 'running'
    this.abortController = new AbortController()

    try {
      // Build thread options
      const permissionOptions = mapPermissionMode(this.options.permissionMode)
      const threadOptions: ThreadOptions = {
        workingDirectory: this.options.cwd,
        skipGitRepoCheck: true, // IDE handles git separately
        ...permissionOptions,
      }

      // Only pass the model if it's a valid Codex model — ignore Claude model IDs
      // that may leak through from provider switching in the UI
      if (this.options.model && !this.options.model.startsWith('claude-')) {
        threadOptions.model = this.options.model
      }

      // Start new thread or resume existing one
      if (!this.thread) {
        if (this.threadId) {
          // Resume existing thread
          console.log(`${LOG_PREFIX} Resuming thread ${this.threadId} with options:`, threadOptions)
          this.thread = this.codex.resumeThread(this.threadId, threadOptions)
        } else {
          // Start new thread
          console.log(`${LOG_PREFIX} Starting new thread with options:`, threadOptions)
          this.thread = this.codex.startThread(threadOptions)
        }
      }

      // Run with streaming
      const { events } = await this.thread.runStreamed(message, {
        signal: this.abortController.signal,
      })

      // Process events
      for await (const event of events) {
        console.log(`${LOG_PREFIX} Received event:`, event.type)

        // Capture thread ID from thread.started event
        if (event.type === 'thread.started' && event.thread_id) {
          this.threadId = event.thread_id
          console.log(`${LOG_PREFIX} Thread ID captured: ${this.threadId}`)
        }

        const agentMessage = convertThreadEvent(event, this.id)

        if (agentMessage) {
          this.state.messageCount++

          // Update token count from turn.completed
          if (event.type === 'turn.completed') {
            const usage = (event as { usage: Usage }).usage
            this.state.totalTokens += usage.input_tokens + usage.output_tokens
          }

          // Update status based on message type
          if (agentMessage.type === 'done') {
            this.state.status = 'completed'
            this.state.endTime = Date.now()
            console.log(`${LOG_PREFIX} ========================================`)
            console.log(`${LOG_PREFIX} CODEX SESSION COMPLETED`)
            console.log(`${LOG_PREFIX} Thread ID: ${this.thread.id}`)
            console.log(`${LOG_PREFIX} Total messages: ${this.state.messageCount}`)
            console.log(`${LOG_PREFIX} Total tokens: ${this.state.totalTokens}`)
            console.log(`${LOG_PREFIX} Duration: ${(this.state.endTime - this.state.startTime) / 1000}s`)
            console.log(`${LOG_PREFIX} ========================================`)
          } else if (agentMessage.type === 'error') {
            this.state.status = 'error'
            this.state.endTime = Date.now()
            console.error(`${LOG_PREFIX} Session error:`, agentMessage.content)
          }

          yield agentMessage
        }
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Execution error:`, error)
      this.state.status = 'error'
      this.state.endTime = Date.now()

      // Check if it was an abort
      if (error instanceof Error && error.name === 'AbortError') {
        this.state.status = 'interrupted'
        yield {
          type: 'done',
          content: {
            sessionId: this.id,
            result: undefined,
            interrupted: true,
          } satisfies DoneContent,
          metadata: {
            timestamp: Date.now(),
          },
        }
        return
      }

      yield {
        type: 'error',
        content: {
          code: 'execution_error',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        } satisfies ErrorContent,
        metadata: {
          timestamp: Date.now(),
        },
      }
    }
  }

  async interrupt(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort()
      this.state.status = 'interrupted'
      this.state.endTime = Date.now()
      console.log(`${LOG_PREFIX} Session interrupted`)
    }
  }

  getState(): AgentSessionState {
    return { ...this.state }
  }

  /**
   * Get the thread ID for resuming later
   * Updates internal threadId when thread becomes available
   */
  getThreadId(): string | null {
    // Update threadId from thread if available
    if (this.thread?.id && !this.threadId) {
      this.threadId = this.thread.id
    }
    return this.threadId || this.thread?.id || null
  }
}

/**
 * Codex Agent Provider Implementation using SDK
 */
export class CodexAgentProvider implements AgentProvider {
  readonly id: 'codex' = 'codex'
  readonly name = 'Codex'

  private codexBinaryPath: string | undefined

  constructor() {
    // Find the binary path explicitly since SDK's import.meta.url
    // resolution may not work correctly in Electron's bundled context
    this.codexBinaryPath = findCodexBinaryPath()

    if (this.codexBinaryPath) {
      console.log(`${LOG_PREFIX} Initialized with explicit binary path: ${this.codexBinaryPath}`)
    } else {
      console.log(`${LOG_PREFIX} Will use SDK default path resolution`)
    }
  }

  /**
   * Create a Codex SDK instance, optionally with MCP server config overrides.
   * A new instance is needed per session because the `config` option (which
   * carries MCP server credentials) is set at construction time.
   */
  private createCodexInstance(
    mcpServers?: Record<string, McpServerConfig>,
    systemPrompt?: string
  ): Codex {
    const mcpConfig = buildMcpConfigOverrides(mcpServers)

    const codexOptions: Record<string, unknown> = {}
    if (this.codexBinaryPath) {
      codexOptions.codexPathOverride = this.codexBinaryPath
    }

    const config: Record<string, unknown> = {}
    if (mcpConfig) {
      config.mcp_servers = mcpConfig
      console.log(`${LOG_PREFIX} MCP servers configured for Codex:`, Object.keys(mcpConfig).join(', '))
    }
    if (systemPrompt) {
      config.instructions = systemPrompt
      console.log(`${LOG_PREFIX} Custom instructions set (${systemPrompt.length} chars)`)
    }
    if (Object.keys(config).length > 0) {
      codexOptions.config = config
    }

    return new Codex(codexOptions as ConstructorParameters<typeof Codex>[0])
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      for (const candidate of getCodexAuthPathCandidates()) {
        if (!fs.existsSync(candidate)) continue
        const content = fs.readFileSync(candidate, 'utf-8')
        const auth = JSON.parse(content)
        if (auth?.tokens?.refresh_token) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  async createSession(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `codex-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const codex = this.createCodexInstance(options.mcpServers, options.systemPrompt)
    return new CodexAgentSession(sessionId, codex, options, options.resumeSessionId)
  }

  async getAvailableModels(): Promise<AgentModel[]> {
    return CODEX_MODELS
  }

  async resumeSession(
    sessionId: string,
    options?: Partial<AgentSessionOptions>
  ): Promise<AgentSession> {
    const sessionOptions: AgentSessionOptions = {
      cwd: options?.cwd || process.cwd(),
      ...options,
    }

    const codex = this.createCodexInstance(sessionOptions.mcpServers, sessionOptions.systemPrompt)
    console.log(`${LOG_PREFIX} Resuming session with thread ID: ${sessionId}`)
    return new CodexAgentSession(sessionId, codex, sessionOptions, sessionId)
  }
}
