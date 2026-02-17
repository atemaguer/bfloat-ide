/**
 * AI Agent API
 *
 * Renderer-side API for the common AI agent interface.
 * Provides methods to interact with Claude Agent SDK and Codex.
 */

import { ConveyorApi } from '@/lib/preload/shared'
import type {
  ProviderId,
  AgentModel,
  SessionOptions,
  SessionState,
  ProviderInfo,
  AgentMessage,
} from '@/lib/conveyor/schemas/ai-agent-schema'

export type { ProviderId, AgentModel, SessionOptions, SessionState, ProviderInfo, AgentMessage }

// Background session types
export type BackgroundSessionStatus = 'running' | 'completed' | 'error'

export interface BackgroundSessionData {
  sessionId: string
  projectId: string
  provider: ProviderId
  cwd: string
  streamChannel: string | null
  status: BackgroundSessionStatus
  startedAt: number
}

export interface BackgroundSessionResult {
  success: boolean
  session?: BackgroundSessionData
}

export interface BackgroundMessagesResult {
  success: boolean
  messages: AgentMessage[]
}

export interface BackgroundSessionInfo {
  sessionId: string
  projectId: string
  provider: ProviderId
  status: BackgroundSessionStatus
  startedAt: number
}

// Result types
export interface CreateSessionResult {
  success: boolean
  sessionId?: string
  error?: string
}

export interface PromptResult {
  success: boolean
  streamChannel?: string
  error?: string
}

export interface OperationResult {
  success: boolean
  error?: string
}

export interface SessionInfo {
  id: string
  provider: ProviderId
  state: SessionState
}

// Session reading types
export interface SessionMessageBlock {
  type: 'text' | 'tool'
  content?: string
  action?: {
    id: string
    type: string
    label: string
    status: 'running' | 'completed' | 'error'
    output?: string
    timestamp: number
  }
}

export interface SessionMessageData {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks?: SessionMessageBlock[]
  timestamp: number
}

export interface ReadSessionResult {
  success: boolean
  session?: {
    sessionId: string
    provider: ProviderId
    messages: SessionMessageData[]
    cwd?: string
    createdAt?: number
    lastModified?: number
  }
  error?: string
}

export interface ListSessionsResult {
  success: boolean
  sessions?: Array<{ sessionId: string; lastModified: number }>
  error?: string
}

/**
 * AI Agent API - Unified interface for Claude and Codex
 *
 * Provides methods to:
 * - Check provider authentication status
 * - Create and manage agent sessions
 * - Send prompts and receive streaming responses
 * - Get available models for each provider
 */
export class AIAgentApi extends ConveyorApi {
  // ============================================================================
  // Provider Management
  // ============================================================================

  /**
   * Get all available providers with their authentication status
   */
  getProviders = (): Promise<ProviderInfo[]> => this.invoke('ai-agent:get-providers')

  /**
   * Get only authenticated providers
   */
  getAuthenticatedProviders = (): Promise<ProviderInfo[]> =>
    this.invoke('ai-agent:get-authenticated-providers')

  /**
   * Check if a specific provider is authenticated
   */
  isAuthenticated = (providerId: ProviderId): Promise<boolean> =>
    this.invoke('ai-agent:is-authenticated', providerId)

  /**
   * Get available models for a provider
   */
  getModels = (providerId: ProviderId): Promise<AgentModel[]> =>
    this.invoke('ai-agent:get-models', providerId)

  /**
   * Set the default provider for new sessions
   */
  setDefaultProvider = (providerId: ProviderId): Promise<OperationResult> =>
    this.invoke('ai-agent:set-default-provider', providerId)

  /**
   * Get the current default provider
   */
  getDefaultProvider = (): Promise<ProviderId> => this.invoke('ai-agent:get-default-provider')

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new agent session
   */
  createSession = (options: SessionOptions): Promise<CreateSessionResult> =>
    this.invoke('ai-agent:create-session', options)

  /**
   * Send a prompt to an existing session
   * Returns a stream channel name for receiving responses
   */
  prompt = (sessionId: string, message: string): Promise<PromptResult> =>
    this.invoke('ai-agent:prompt', sessionId, message)

  /**
   * Interrupt a running session
   */
  interrupt = (sessionId: string): Promise<OperationResult> =>
    this.invoke('ai-agent:interrupt', sessionId)

  /**
   * Get the current state of a session
   */
  getSessionState = (sessionId: string): Promise<SessionState | null> =>
    this.invoke('ai-agent:get-session-state', sessionId)

  /**
   * Get all active sessions
   */
  getActiveSessions = (): Promise<SessionInfo[]> => this.invoke('ai-agent:get-active-sessions')

  /**
   * Terminate a session (interrupt and cleanup)
   */
  terminateSession = (sessionId: string): Promise<OperationResult> =>
    this.invoke('ai-agent:terminate-session', sessionId)

  // ============================================================================
  // Streaming
  // ============================================================================

  /**
   * Subscribe to messages on a stream channel
   * @param streamChannel - The channel name returned from prompt()
   * @param callback - Called for each agent message
   * @returns Unsubscribe function
   */
  onStreamMessage = (
    streamChannel: string,
    callback: (message: AgentMessage | { type: 'stream_end' }) => void
  ): (() => void) => {
    return this.on(streamChannel, callback)
  }

  // ============================================================================
  // Background Session Management
  // ============================================================================

  /**
   * Get background session for a project (if one is running or recently completed)
   * @param projectId - The project ID to check
   */
  getBackgroundSession = (projectId: string): Promise<BackgroundSessionResult> =>
    this.invoke('ai-agent:get-background-session', projectId)

  /**
   * List all active background sessions (for home page indicators)
   */
  listBackgroundSessions = (): Promise<BackgroundSessionInfo[]> =>
    this.invoke('ai-agent:list-background-sessions')

  /**
   * Unregister a background session (cleanup after reconnect to completed session)
   * @param sessionId - The session ID to unregister
   */
  unregisterBackgroundSession = (sessionId: string): Promise<OperationResult> =>
    this.invoke('ai-agent:unregister-background-session', sessionId)

  /**
   * Get background session by session ID (for reconnecting to specific sessions)
   * @param sessionId - The session ID to look up
   */
  getBackgroundSessionById = (sessionId: string): Promise<BackgroundSessionResult> =>
    this.invoke('ai-agent:get-background-session-by-id', sessionId)

  /**
   * Get buffered background messages for a session after a sequence number.
   * Used to replay messages missed while the UI was detached from the stream.
   * @param sessionId - The session ID to get messages for
   * @param afterSeq - Only return messages with seq > afterSeq (0 = all messages)
   */
  getBackgroundMessages = (sessionId: string, afterSeq?: number): Promise<BackgroundMessagesResult> =>
    this.invoke('ai-agent:get-background-messages', sessionId, afterSeq)

  // ============================================================================
  // Session Reading (from local CLI storage)
  // ============================================================================

  /**
   * Read a session from local CLI storage (Claude or Codex)
   * This loads the conversation history directly from the AI agent's files
   * @param sessionId - The session ID to read
   * @param provider - Which provider's storage to read from
   * @param projectPath - Optional project path to help locate the session
   */
  readSession = (
    sessionId: string,
    provider: ProviderId,
    projectPath?: string
  ): Promise<ReadSessionResult> =>
    this.invoke('ai-agent:read-session', sessionId, provider, projectPath)

  /**
   * List available sessions for a project
   * @param provider - Which provider's storage to list
   * @param projectPath - Project path to list sessions for
   */
  listSessions = (provider: ProviderId, projectPath?: string): Promise<ListSessionsResult> =>
    this.invoke('ai-agent:list-sessions', provider, projectPath)

  // ============================================================================
  // Project Name Generation
  // ============================================================================

  /**
   * Generate a project name from a description using AI
   * @param description - The project description/prompt
   * @param provider - Which provider to use for generation
   */
  generateProjectName = (
    description: string,
    provider: ProviderId = 'claude'
  ): Promise<{
    success: boolean
    name: string
    source: 'ai' | 'fallback'
    error?: string
  }> => this.invoke('ai-agent:generate-project-name', description, provider)
}
