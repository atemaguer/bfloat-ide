/**
 * Claude Agent Provider
 *
 * Implementation of the AgentProvider interface using the Claude Agent SDK.
 * This provider uses the @anthropic-ai/claude-agent-sdk to spawn and control
 * Claude Code sessions.
 */

import { query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk'

// Logging prefix for easy identification
const LOG_PREFIX = '[Claude Provider]'
import type {
  AgentProvider,
  AgentProviderId,
  AgentSession,
  AgentSessionOptions,
  AgentMessage,
  AgentMessageType,
  AgentModel,
  AgentSessionState,
  ToolCallContent,
  ToolResultContent,
  ErrorContent,
  InitContent,
  DoneContent,
} from '../types'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { getShellPaths, isBundledShellAvailable } from '@/lib/platform/shell'

// Claude config file paths for checking authentication
const CLAUDE_CONFIG_PATH = path.join(os.homedir(), '.claude.json')
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const CLAUDE_CREDENTIALS_PATH = path.join(CLAUDE_CONFIG_DIR, '.credentials.json')
const WINDOWS_GIT_BASH_PATH_ENV = 'CLAUDE_CODE_GIT_BASH_PATH'

/**
 * Read the stored OAuth token from credentials file.
 * This token is captured from `claude setup-token` output.
 */
function getClaudeOAuthToken(): string | null {
  try {
    if (!fs.existsSync(CLAUDE_CREDENTIALS_PATH)) {
      return null
    }
    const content = fs.readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8')
    const credentials = JSON.parse(content) as { oauthToken?: string }
    return credentials?.oauthToken || null
  } catch {
    return null
  }
}

/**
 * Find the Claude Code CLI binary path.
 * Checks common installation locations for macOS, Linux, and Windows.
 */
export function findClaudeCodeBinaryPath(): string | undefined {
  const possiblePaths: string[] = []

  if (process.platform === 'win32') {
    // Windows installation paths
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

    possiblePaths.push(
      // Native installer location (similar to Unix ~/.local/bin)
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      // Claude Code native Windows installer
      path.join(localAppData, 'Programs', 'claude-code', 'claude.exe'),
      path.join(localAppData, 'claude-code', 'claude.exe'),
      // npm global install
      path.join(appData, 'npm', 'claude.cmd'),
      path.join(appData, 'npm', 'claude'),
      // Scoop install
      path.join(os.homedir(), 'scoop', 'shims', 'claude.exe'),
      // Program Files
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Claude Code', 'claude.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Claude Code', 'claude.exe'),
    )
  } else {
    // macOS and Linux paths
    possiblePaths.push(
      // Native installer location
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      // Homebrew on macOS
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      // Linux
      '/usr/bin/claude',
    )
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`${LOG_PREFIX} Found Claude Code binary at: ${p}`)
      return p
    }
  }

  console.warn(`${LOG_PREFIX} Claude Code binary not found in any standard location. Checked: ${possiblePaths.join(', ')}`)
  return undefined
}

// Available Claude models
const CLAUDE_MODELS: AgentModel[] = [
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'claude',
    description: 'Most capable model for complex tasks',
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'claude',
    description: 'Balanced performance and cost',
    contextWindow: 200000,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude Haiku 3.5',
    provider: 'claude',
    description: 'Fast and efficient for quick tasks',
    contextWindow: 200000,
  },
]

/**
 * Map SDK permission mode to our permission mode
 */
function mapPermissionMode(
  mode: AgentSessionOptions['permissionMode']
): Options['permissionMode'] {
  switch (mode) {
    case 'default':
      return 'default'
    case 'acceptEdits':
      return 'acceptEdits'
    case 'bypassPermissions':
      return 'bypassPermissions'
    case 'plan':
      return 'plan'
    case 'delegate':
      return 'delegate'
    case 'dontAsk':
      return 'dontAsk'
    default:
      return 'default'
  }
}

/**
 * Convert SDK message to our AgentMessage format
 */
function convertSDKMessage(sdkMessage: SDKMessage, sessionId: string): AgentMessage | null {
  switch (sdkMessage.type) {
    case 'system':
      if (sdkMessage.subtype === 'init') {
        // Note: The init message doesn't have session_id in the SDK
        // We'll capture it from the first assistant/result message instead
        console.log(`${LOG_PREFIX} ========================================`)
        console.log(`${LOG_PREFIX} INIT MESSAGE RECEIVED`)
        console.log(`${LOG_PREFIX} Tools count:`, sdkMessage.tools?.length || 0)
        console.log(`${LOG_PREFIX} Model:`, sdkMessage.model)
        console.log(`${LOG_PREFIX} MCP Servers:`, JSON.stringify(sdkMessage.mcp_servers, null, 2))
        // Log detailed MCP server status including errors
        if (sdkMessage.mcp_servers) {
          for (const server of sdkMessage.mcp_servers) {
            console.log(`${LOG_PREFIX} MCP [${server.name}] status: ${server.status}`)
            if ((server as any).error) {
              console.log(`${LOG_PREFIX} MCP [${server.name}] ERROR: ${(server as any).error}`)
            }
            if ((server as any).serverInfo) {
              console.log(`${LOG_PREFIX} MCP [${server.name}] serverInfo:`, JSON.stringify((server as any).serverInfo))
            }
          }
        }
        console.log(`${LOG_PREFIX} All tools:`, sdkMessage.tools?.join(', '))
        console.log(`${LOG_PREFIX} ========================================`)
        return {
          type: 'init',
          content: {
            sessionId: '', // Will be populated from assistant message
            availableTools: sdkMessage.tools || [],
            model: sdkMessage.model || 'unknown',
          } satisfies InitContent,
          metadata: {
            timestamp: Date.now(),
          },
        }
      }
      return null

    case 'assistant':
      // Handle assistant message - extract text and tool calls
      const content = sdkMessage.message.content
      console.log(`${LOG_PREFIX} Assistant message content blocks:`, content.length)
      for (let i = 0; i < content.length; i++) {
        const block = content[i]
        console.log(`${LOG_PREFIX} Block ${i} type:`, block.type, 'text' in block ? `text length: ${(block as any).text?.length}` : '')
      }
      for (const block of content) {
        if ('text' in block && block.text) {
          console.log(`${LOG_PREFIX} Returning text block (first 200 chars):`, block.text.substring(0, 200))
          return {
            type: 'text',
            content: block.text,
            metadata: {
              tokens: sdkMessage.message.usage?.output_tokens,
              timestamp: Date.now(),
            },
          }
        }
        if ('name' in block && block.type === 'tool_use') {
          console.log(`${LOG_PREFIX} Returning tool_use block:`, block.name)
          return {
            type: 'tool_call',
            content: {
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
              status: 'running',
            } satisfies ToolCallContent,
            metadata: {
              timestamp: Date.now(),
            },
          }
        }
      }
      console.log(`${LOG_PREFIX} No text or tool_use blocks found in assistant message`)
      return null

    case 'stream_event':
      // Handle partial/streaming messages
      if (sdkMessage.event.type === 'content_block_delta') {
        const delta = sdkMessage.event.delta
        if ('text' in delta && delta.text) {
          return {
            type: 'text',
            content: delta.text,
            metadata: {
              timestamp: Date.now(),
            },
          }
        }
      }
      return null

    case 'result':
      if (sdkMessage.subtype === 'success') {
        return {
          type: 'done',
          content: {
            sessionId,
            result: sdkMessage.result,
            interrupted: false,
          } satisfies DoneContent,
          metadata: {
            cost: sdkMessage.total_cost_usd,
            tokens:
              (sdkMessage.total_usage?.input_tokens || 0) +
              (sdkMessage.total_usage?.output_tokens || 0),
            timestamp: Date.now(),
          },
        }
      } else {
        return {
          type: 'error',
          content: {
            code: sdkMessage.subtype,
            message: sdkMessage.error || 'Unknown error',
            recoverable: false,
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
 * Session configuration for customizing Claude-based sessions
 */
export interface ClaudeSessionConfig {
  /** Provider ID for this session */
  providerId: AgentProviderId
  /** Custom environment variables to override defaults */
  envOverrides?: Record<string, string | undefined>
  /** Whether to use OAuth token from ~/.claude/.credentials.json */
  useOAuthToken?: boolean
  /** Log prefix for this session */
  logPrefix?: string
}

/**
 * Claude Agent Session Implementation
 *
 * This class is exported so it can be reused by other providers (e.g., Bfloat)
 * that use the same Claude SDK but with different configuration.
 */
export class ClaudeAgentSession implements AgentSession {
  readonly id: string
  readonly provider: AgentProviderId

  private state: AgentSessionState
  private queryInstance: ReturnType<typeof query> | null = null
  private abortController: AbortController | null = null
  private realSessionId: string | null = null // The actual Claude session ID from the CLI
  private config: ClaudeSessionConfig

  constructor(
    sessionId: string,
    private options: AgentSessionOptions,
    config?: Partial<ClaudeSessionConfig>
  ) {
    this.id = sessionId
    this.config = {
      providerId: config?.providerId || 'claude',
      envOverrides: config?.envOverrides,
      useOAuthToken: config?.useOAuthToken ?? true,
      logPrefix: config?.logPrefix || LOG_PREFIX,
    }
    this.provider = this.config.providerId
    // If resumeSessionId is provided, use it as the initial realSessionId
    this.realSessionId = options.resumeSessionId || null
    this.state = {
      id: sessionId,
      status: 'idle',
      messageCount: 0,
      totalTokens: 0,
      totalCost: 0,
      startTime: Date.now(),
    }
    console.log(`${this.config.logPrefix} Session created:`, {
      sessionId,
      providerId: this.config.providerId,
      cwd: options.cwd,
      model: options.model,
      permissionMode: options.permissionMode,
      resumeSessionId: options.resumeSessionId || 'none',
    })
  }

  async *prompt(message: string): AsyncIterable<AgentMessage> {
    const logPrefix = this.config.logPrefix || LOG_PREFIX
    console.log(`${logPrefix} ========================================`)
    console.log(`${logPrefix} STARTING ${this.config.providerId.toUpperCase()} AGENT SESSION`)
    console.log(`${logPrefix} Session ID: ${this.id}`)
    console.log(`${logPrefix} Real Session ID (for resume): ${this.realSessionId || 'new session'}`)
    console.log(`${logPrefix} Model: ${this.options.model || 'default'}`)
    console.log(`${logPrefix} CWD: ${this.options.cwd}`)
    console.log(`${logPrefix} Prompt: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`)
    console.log(`${LOG_PREFIX} ========================================`)

    this.state.status = 'running'
    this.abortController = new AbortController()

    // Ensure Anthropic API env vars are set correctly for local agent mode
    // Always use the real Anthropic API URL (ignore any proxy configuration in .env)
    // Clear placeholder API key so Claude Code CLI uses OAuth authentication from ~/.claude.json
    //
    // IMPORTANT: Electron apps on macOS don't inherit the full shell PATH.
    // We need to explicitly add common paths where npm/node/bun are installed.
    const additionalPaths = [
      path.join(os.homedir(), '.local', 'bin'),       // User local binaries
      path.join(os.homedir(), '.bun', 'bin'),         // Bun
      path.join(os.homedir(), '.nvm', 'current', 'bin'), // NVM (common symlink)
      '/opt/homebrew/bin',                            // Homebrew on Apple Silicon
      '/opt/homebrew/sbin',
      '/usr/local/bin',                               // Homebrew on Intel / common binaries
      '/usr/local/sbin',
      '/usr/bin',
      '/usr/sbin',
      '/bin',
      '/sbin',
    ]
    const currentPath = process.env.PATH || ''
    const enhancedPath =
      process.platform === 'win32'
        ? currentPath
        : [...additionalPaths, ...currentPath.split(path.delimiter)].filter(Boolean).join(path.delimiter)

    // Read the OAuth token from credentials file (captured from setup-token)
    // Only use OAuth token if configured to do so (not for proxy-based providers)
    let storedOAuthToken: string | null = null
    if (this.config.useOAuthToken !== false) {
      storedOAuthToken = getClaudeOAuthToken()
      if (storedOAuthToken) {
        console.log(`${logPrefix} Found stored OAuth token (length: ${storedOAuthToken.length})`)
      } else {
        console.log(`${logPrefix} No stored OAuth token found, using default auth`)
      }
    }

    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: enhancedPath,
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      // Remove placeholder API key - Claude Code will use OAuth from ~/.claude.json
      ANTHROPIC_API_KEY: undefined,
      // Pass the OAuth token from setup-token if available
      CLAUDE_CODE_OAUTH_TOKEN: storedOAuthToken || undefined,
      // Enable agent teams/swarms support
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      // Apply any custom env overrides (e.g., for Bfloat proxy)
      ...this.config.envOverrides,
    }

    // Set Git Bash path for Windows using bundled or system bash
    if (process.platform === 'win32' && !env[WINDOWS_GIT_BASH_PATH_ENV]) {
      const shellPaths = getShellPaths()
      if (fs.existsSync(shellPaths.bash)) {
        env[WINDOWS_GIT_BASH_PATH_ENV] = shellPaths.bash
        console.log(`${LOG_PREFIX} Using ${isBundledShellAvailable() ? 'bundled' : 'system'} bash: ${shellPaths.bash}`)
      } else {
        console.warn(`${LOG_PREFIX} Bash not found. Claude Code may require Git for Windows.`)
      }
    }

    // Include any custom env vars (e.g., Apple credentials for iOS deployment)
    // Only spread if defined to avoid adding undefined values
    if (this.options.env) {
      Object.assign(env, this.options.env)
    }

    // Find Claude Code binary path
    const claudeBinaryPath = findClaudeCodeBinaryPath()
    if (!claudeBinaryPath) {
      throw new Error('Claude Code CLI not found. Please install Claude Code from https://claude.com/download')
    }

    // Ensure 'Skill' is included in allowedTools if tools are specified
    const allowedTools = this.options.allowedTools
      ? [...this.options.allowedTools, 'Skill']
      : undefined

    // Pass MCP servers directly - they're already in the correct format
    // from createSdkMcpServer() which returns McpSdkServerConfigWithInstance
    const mcpServers = this.options.mcpServers

    const sdkOptions: Options = {
      cwd: this.options.cwd,
      permissionMode: mapPermissionMode(this.options.permissionMode),
      model: this.options.model,
      allowedTools,
      disallowedTools: this.options.disallowedTools,
      systemPrompt: this.options.systemPrompt,
      // Enable skills from .claude/skills/ in project directory
      settingSources: ['project'],
      // Use realSessionId for resuming - this is updated after each query
      // so subsequent prompts continue the same conversation
      resume: this.realSessionId || undefined,
      abortController: this.abortController,
      // Auto-approve file edits in acceptEdits mode
      allowDangerouslySkipPermissions: this.options.permissionMode === 'bypassPermissions',
      // Explicitly pass env to ensure correct API URL
      env,
      // Path to the Claude Code CLI binary
      pathToClaudeCodeExecutable: claudeBinaryPath,
      // Prevent infinite loops by limiting agentic turns
      maxTurns: this.options.maxTurns || 50,
      // MCP servers for custom tools (e.g., Stripe, RevenueCat)
      mcpServers: mcpServers as Record<string, any>,
      // Agent/subagent definitions for team orchestration
      agents: this.options.agents as Record<string, any>,
      // Capture stderr for debugging MCP connection issues
      stderr: (data: string) => {
        console.log(`${LOG_PREFIX} [stderr] ${data}`)
      },
    }

    // Log options (excluding non-serializable mcpServers instances)
    const loggableOptions = { ...sdkOptions, mcpServers: mcpServers ? Object.keys(mcpServers) : undefined }
    console.log(`${LOG_PREFIX} SDK Options:`, JSON.stringify(loggableOptions, null, 2))
    console.log(`${LOG_PREFIX} ANTHROPIC_BASE_URL in env:`, env.ANTHROPIC_BASE_URL)
    console.log(`${LOG_PREFIX} ANTHROPIC_API_KEY in env:`, env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET - using OAuth]')
    console.log(`${LOG_PREFIX} CLAUDE_CODE_OAUTH_TOKEN in env:`, env.CLAUDE_CODE_OAUTH_TOKEN ? '[SET]' : '[NOT SET]')
    if (mcpServers) {
      console.log(`${LOG_PREFIX} ========================================`)
      console.log(`${LOG_PREFIX} MCP SERVERS BEING PASSED TO SDK`)
      console.log(`${LOG_PREFIX} Server names:`, Object.keys(mcpServers).join(', '))
      for (const [name, config] of Object.entries(mcpServers)) {
        const configAny = config as any
        console.log(`${LOG_PREFIX} [${name}] type: ${configAny.type}`)
        console.log(`${LOG_PREFIX} [${name}] url: ${configAny.url || 'N/A'}`)
        console.log(`${LOG_PREFIX} [${name}] headers: ${configAny.headers ? Object.keys(configAny.headers).join(', ') : 'none'}`)
        if (configAny.headers?.Authorization) {
          const authHeader = configAny.headers.Authorization
          console.log(`${LOG_PREFIX} [${name}] Auth header: ${authHeader.substring(0, 20)}...`)
        }
      }
      console.log(`${LOG_PREFIX} ========================================`)
    } else {
      console.log(`${LOG_PREFIX} No MCP servers configured`)
    }

    try {
      console.log(`${LOG_PREFIX} Spawning Claude Code via @anthropic-ai/claude-agent-sdk...`)
      console.log(`${LOG_PREFIX} Prompt length: ${message.length} chars`)

      // Verify SDK is available
      if (typeof query !== 'function') {
        throw new Error('Claude Agent SDK query function not available')
      }

      this.queryInstance = query({ prompt: message, options: sdkOptions })

      // Track Bash commands to detect infinite retry loops
      const bashCommandCounts = new Map<string, number>()
      const MAX_DUPLICATE_BASH_COMMANDS = 2

      for await (const sdkMessage of this.queryInstance) {
        // Log raw SDK message type for debugging
        console.log(`${LOG_PREFIX} Received SDK message:`, sdkMessage.type)

        // Detect duplicate Bash commands to prevent infinite retry loops
        if (sdkMessage.type === 'assistant') {
          for (const block of sdkMessage.message.content) {
            if (block.type === 'tool_use' && block.name === 'Bash') {
              const cmd = String((block.input as Record<string, unknown>)?.command || '')
              if (cmd) {
                const count = (bashCommandCounts.get(cmd) || 0) + 1
                bashCommandCounts.set(cmd, count)
                if (count > MAX_DUPLICATE_BASH_COMMANDS) {
                  console.error(`${LOG_PREFIX} Duplicate Bash command detected (${count}x): ${cmd}`)
                  console.error(`${LOG_PREFIX} Aborting session to prevent infinite loop`)
                  this.abortController?.abort()
                  this.state.status = 'error'
                  this.state.endTime = Date.now()
                  yield {
                    type: 'error' as AgentMessageType,
                    content: {
                      code: 'duplicate_command',
                      message: `Agent attempted to run the same Bash command ${count} times: "${cmd.substring(0, 100)}". Session aborted to prevent an infinite loop.`,
                      recoverable: false,
                    } satisfies ErrorContent,
                    metadata: { timestamp: Date.now() },
                  }
                  return
                }
              }
            }
          }
        }

        // Extract real session_id from SDK messages that have it
        // Assistant, user, and result messages include session_id
        const sdkSessionId = (sdkMessage as { session_id?: string }).session_id
        if (sdkSessionId && !this.realSessionId) {
          this.realSessionId = sdkSessionId
          console.log(`${LOG_PREFIX} ========================================`)
          console.log(`${LOG_PREFIX} CAPTURED REAL CLAUDE SESSION ID: ${sdkSessionId}`)
          console.log(`${LOG_PREFIX} ========================================`)

          // Emit an init message with the real session ID
          yield {
            type: 'init' as AgentMessageType,
            content: {
              sessionId: sdkSessionId,
              availableTools: [],
              model: 'unknown',
            } satisfies InitContent,
            metadata: {
              timestamp: Date.now(),
            },
          }
        }

        const agentMessage = convertSDKMessage(sdkMessage, this.id)
        if (agentMessage) {
          this.state.messageCount++

          // Log converted message
          if (agentMessage.type === 'tool_call') {
            const toolContent = agentMessage.content as ToolCallContent
            console.log(`${LOG_PREFIX} Tool call: ${toolContent.name}`)
          } else if (agentMessage.type === 'init') {
            const initContent = agentMessage.content as InitContent
            console.log(`${LOG_PREFIX} Session initialized - Model: ${initContent.model}`)
            // Skip the empty init message since we emit one with the real session ID
            if (!initContent.sessionId) {
              continue
            }
          }

          // Track tokens and cost
          if (agentMessage.metadata?.tokens) {
            this.state.totalTokens += agentMessage.metadata.tokens
          }
          if (agentMessage.metadata?.cost) {
            this.state.totalCost += agentMessage.metadata.cost
          }

          // Update status based on message type
          if (agentMessage.type === 'done') {
            this.state.status = 'completed'
            this.state.endTime = Date.now()
            console.log(`${LOG_PREFIX} ========================================`)
            console.log(`${LOG_PREFIX} CLAUDE SESSION COMPLETED`)
            console.log(`${LOG_PREFIX} Total messages: ${this.state.messageCount}`)
            console.log(`${LOG_PREFIX} Total tokens: ${this.state.totalTokens}`)
            console.log(`${LOG_PREFIX} Total cost: $${this.state.totalCost.toFixed(4)}`)
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
      // If session already completed successfully, ignore exit code errors
      // This happens when Claude Code exits with code 1 after finishing normally
      if (this.state.status === 'completed') {
        console.log(`${LOG_PREFIX} Ignoring post-completion error:`, error instanceof Error ? error.message : error)
        return
      }

      // Log full error details for debugging
      console.error(`${LOG_PREFIX} Execution error:`, error)
      if (error instanceof Error) {
        console.error(`${LOG_PREFIX} Error name:`, error.name)
        console.error(`${LOG_PREFIX} Error message:`, error.message)
        console.error(`${LOG_PREFIX} Error stack:`, error.stack)
      }
      this.state.status = 'error'
      this.state.endTime = Date.now()

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
    }
  }

  getState(): AgentSessionState {
    return { ...this.state }
  }
}

/**
 * Claude Agent Provider Implementation
 */
export class ClaudeAgentProvider implements AgentProvider {
  readonly id: 'claude' = 'claude'
  readonly name = 'Claude'

  async isAuthenticated(): Promise<boolean> {
    try {
      console.log(`${LOG_PREFIX} Checking authentication at ${CLAUDE_CONFIG_PATH} and ${CLAUDE_CREDENTIALS_PATH}`)

      let hasAccount = false
      if (fs.existsSync(CLAUDE_CONFIG_PATH)) {
        try {
          const configContent = fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf-8')
          const config = JSON.parse(configContent)
          hasAccount = !!config.oauthAccount?.accountUuid
        } catch {
          hasAccount = false
        }
      }

      let hasCredentials = false
      if (fs.existsSync(CLAUDE_CREDENTIALS_PATH)) {
        try {
          const credentialsContent = fs.readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8')
          const credentials = JSON.parse(credentialsContent) as {
            claudeAiOauth?: { accessToken?: string }
            apiKey?: string
            anthropicApiKey?: string
            oauthToken?: string
          }
          // Check for OAuth token (from setup-token), API key, or anthropic API key
          hasCredentials = Boolean(
            credentials?.claudeAiOauth?.accessToken ||
            credentials?.oauthToken ||
            credentials?.apiKey ||
            credentials?.anthropicApiKey
          )
        } catch {
          hasCredentials = false
        }
      }

      // Also check for ANTHROPIC_API_KEY environment variable
      if (!hasCredentials && process.env.ANTHROPIC_API_KEY) {
        hasCredentials = true
      }

      const hasAuth = hasAccount || hasCredentials
      console.log(`${LOG_PREFIX} Auth check result: ${hasAuth}`)
      return hasAuth
    } catch (error) {
      console.error(`${LOG_PREFIX} Auth check error:`, error)
      return false
    }
  }

  async createSession(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `claude-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    return new ClaudeAgentSession(sessionId, options)
  }

  async getAvailableModels(): Promise<AgentModel[]> {
    return CLAUDE_MODELS
  }

  async resumeSession(
    sessionId: string,
    options?: Partial<AgentSessionOptions>
  ): Promise<AgentSession> {
    const sessionOptions: AgentSessionOptions = {
      cwd: options?.cwd || process.cwd(),
      resumeSessionId: sessionId,
      ...options,
    }
    return new ClaudeAgentSession(sessionId, sessionOptions)
  }
}
