/**
 * Common Agent Interface Types
 *
 * This module defines a unified interface for interacting with different AI coding agents
 * (Claude Agent SDK and Codex/OpenAI). It abstracts away provider-specific details while
 * exposing a consistent API for session management, message streaming, and tool execution.
 */

// Provider identification
export type AgentProviderId = 'claude' | 'codex' | 'bfloat'

// Available tools that agents can use
export type AgentTool =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Glob'
  | 'Grep'
  | 'WebSearch'
  | 'WebFetch'
  | 'Task'
  | 'TodoWrite'
  | 'TodoRead'
  | 'AskUser'
  | 'Skill'

// Permission modes for agent operations
export type AgentPermissionMode =
  | 'default' // Ask before dangerous actions
  | 'acceptEdits' // Auto-approve file changes
  | 'bypassPermissions' // No prompts (use cautiously)
  | 'plan' // Planning only, no execution
  | 'delegate' // Restricts team lead to Teammate + Task tools only
  | 'dontAsk' // Don't prompt for permissions, deny if not pre-approved

// Agent/subagent definition for team orchestration
export interface AgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  mcpServers?: Array<string | Record<string, unknown>>
}

// Model information
export interface AgentModel {
  id: string
  name: string
  provider: AgentProviderId
  description?: string
  contextWindow?: number
  maxOutputTokens?: number
}

// MCP Server configuration types
// SDK server (in-process)
export interface McpSdkServerConfig {
  type: 'sdk'
  name: string
  instance: unknown // McpServer instance from SDK
}

// HTTP/SSE server (remote)
export interface McpHttpServerConfig {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
}

// stdio server (local process)
export interface McpStdioServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type McpServerConfig = McpSdkServerConfig | McpHttpServerConfig | McpStdioServerConfig

// Session configuration options
export interface AgentSessionOptions {
  /** Working directory for file operations */
  cwd: string
  /** Model to use (provider-specific ID) */
  model?: string
  /** Permission mode for tool execution */
  permissionMode?: AgentPermissionMode
  /** Restrict available tools (whitelist) */
  allowedTools?: AgentTool[]
  /** Disable specific tools (blacklist) */
  disallowedTools?: string[]
  /** Custom system prompt */
  systemPrompt?: string
  /** Session ID to resume from */
  resumeSessionId?: string
  /** Temperature for generation (0-1) */
  temperature?: number
  /** Environment variables to pass to the agent session */
  env?: Record<string, string>
  /** Project ID for background session tracking */
  projectId?: string
  /** Maximum number of agentic turns before stopping (prevents infinite loops) */
  maxTurns?: number
  /** MCP servers to make available to the agent (keyed by server name) */
  mcpServers?: Record<string, McpServerConfig>
  /** User auth token for fetching integration credentials (e.g., Stripe) */
  authToken?: string
  /** Agent/subagent definitions for team orchestration (agent teams/swarms) */
  agents?: Record<string, AgentDefinition>
}

// Message types in the streaming response
export type AgentMessageType =
  | 'init' // Session initialized
  | 'text' // Text response chunk
  | 'reasoning' // Extended thinking/reasoning
  | 'tool_call' // Tool invocation started
  | 'tool_result' // Tool execution result
  | 'error' // Error occurred
  | 'done' // Stream completed

// Tool call content
export interface ToolCallContent {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'error'
}

// Tool result content
export interface ToolResultContent {
  callId: string
  name: string
  output: string
  isError: boolean
}

// Error content
export interface ErrorContent {
  code: string
  message: string
  recoverable: boolean
}

// Init content
export interface InitContent {
  sessionId: string
  availableTools: string[]
  model: string
}

// Done content
export interface DoneContent {
  sessionId: string
  result?: string
  interrupted: boolean
}

// Unified message from agent stream
export interface AgentMessage {
  type: AgentMessageType
  content: string | ToolCallContent | ToolResultContent | ErrorContent | InitContent | DoneContent
  metadata?: {
    /** Tokens used for this message */
    tokens?: number
    /** Cost in USD for this message */
    cost?: number
    /** Timestamp */
    timestamp?: number
    /** Monotonic sequence number for deduplication on reconnect */
    seq?: number
  }
}

// Session state
export interface AgentSessionState {
  id: string
  status: 'idle' | 'running' | 'completed' | 'error' | 'interrupted'
  messageCount: number
  totalTokens: number
  totalCost: number
  startTime: number
  endTime?: number
}

// Agent session interface
export interface AgentSession {
  /** Unique session identifier */
  readonly id: string

  /** Provider that created this session */
  readonly provider: AgentProviderId

  /**
   * Send a prompt and stream responses
   * @param message - The user message/prompt
   * @returns AsyncIterable of agent messages
   */
  prompt(message: string): AsyncIterable<AgentMessage>

  /**
   * Interrupt the current execution
   */
  interrupt(): Promise<void>

  /**
   * Get the current session state
   */
  getState(): AgentSessionState
}

// Agent provider interface
export interface AgentProvider {
  /** Provider identifier */
  readonly id: AgentProviderId

  /** Human-readable provider name */
  readonly name: string

  /**
   * Check if the provider is authenticated and ready to use
   */
  isAuthenticated(): Promise<boolean>

  /**
   * Create a new agent session
   * @param options - Session configuration
   */
  createSession(options: AgentSessionOptions): Promise<AgentSession>

  /**
   * Get available models for this provider
   */
  getAvailableModels(): Promise<AgentModel[]>

  /**
   * Resume an existing session
   * @param sessionId - The session ID to resume
   * @param options - Additional options
   */
  resumeSession(sessionId: string, options?: Partial<AgentSessionOptions>): Promise<AgentSession>
}

// Agent manager interface for coordinating multiple providers
export interface AgentManager {
  /**
   * Get a specific provider by ID
   */
  getProvider(id: AgentProviderId): AgentProvider | undefined

  /**
   * Get all available providers
   */
  getProviders(): AgentProvider[]

  /**
   * Get all authenticated providers
   */
  getAuthenticatedProviders(): Promise<AgentProvider[]>

  /**
   * Create a session with the default or specified provider
   */
  createSession(options: AgentSessionOptions & { provider?: AgentProviderId }): Promise<AgentSession>
}

// Events emitted by agent sessions
export interface AgentSessionEvents {
  message: (message: AgentMessage) => void
  stateChange: (state: AgentSessionState) => void
  error: (error: Error) => void
}
