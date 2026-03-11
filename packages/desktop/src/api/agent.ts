/**
 * agent.ts — AI Agent API client for the Bfloat sidecar.
 *
 * Mirrors the existing Electron AIAgentApi surface so that renderer code can
 * be migrated with minimal changes.
 *
 * HTTP routes expected on the sidecar:
 *   GET    /agent/providers                      — list providers + auth status
 *   GET    /agent/providers/authenticated         — only authenticated providers
 *   GET    /agent/providers/:id/authenticated     — is provider authenticated?
 *   GET    /agent/providers/:id/models            — models for a provider
 *   POST   /agent/providers/default               — set default provider
 *   GET    /agent/providers/default               — get default provider
 *
 *   POST   /agent/sessions                        — create a session
 *   POST   /agent/sessions/:id/prompt             — send a prompt
 *   POST   /agent/sessions/:id/interrupt          — interrupt a session
 *   GET    /agent/sessions/:id/state              — get session state
 *   GET    /agent/sessions                        — list active sessions
 *   DELETE /agent/sessions/:id                    — terminate a session
 *
 *   GET    /agent/sessions/:id/messages           — buffered background messages
 *   GET    /agent/background/:projectId           — background session for project
 *   GET    /agent/background                      — all background sessions
 *   DELETE /agent/background/:id                  — unregister background session
 *   GET    /agent/background/by-id/:id            — background session by session id
 *
 *   GET    /agent/storage/:provider/sessions      — list persisted sessions
 *   GET    /agent/storage/:provider/sessions/:id  — read a persisted session
 *
 *   POST   /agent/generate-project-name           — generate project name via AI
 *
 *   WS     /agent/sessions/:id/stream             — streaming response channel
 */

import type { HttpClient } from "./client"
import { SidecarWebSocket } from "./websocket"

// ---------------------------------------------------------------------------
// Re-exported domain types (matching ai-agent-schema.ts)
// ---------------------------------------------------------------------------

export type ProviderId = "claude" | "codex"

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "delegate"
  | "dontAsk"

export type MessageType =
  | "init"
  | "text"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "queue_user_prompt"
  | "error"
  | "done"

export type BackgroundSessionStatus = "running" | "completed" | "error"
export type SessionStatus = "idle" | "running" | "completed" | "error" | "interrupted"

export interface AgentModel {
  id: string
  name: string
  provider: ProviderId
  description?: string
  contextWindow?: number
  maxOutputTokens?: number
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  isAuthenticated: boolean
}

export interface SessionOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
  systemPrompt?: string
  resumeSessionId?: string
  temperature?: number
  provider?: ProviderId
  env?: Record<string, string>
  projectId?: string
  maxTurns?: number
  authToken?: string
}

export interface ToolCallContent {
  id: string
  name: string
  input: Record<string, unknown>
  status: "pending" | "running" | "completed" | "error"
}

export interface ToolResultContent {
  callId: string
  name: string
  output: string
  isError: boolean
}

export interface ErrorContent {
  code: string
  message: string
  recoverable: boolean
}

export interface QueueUserPromptContent {
  prompt: string
  reason?: string
  source?: string
}

export interface InitContent {
  sessionId: string
  providerSessionId?: string
  availableTools: string[]
  model: string
}

export interface DoneContent {
  sessionId: string
  result?: string
  interrupted: boolean
}

export interface AgentMessage {
  type: MessageType
  content:
    | string
    | ToolCallContent
    | ToolResultContent
    | QueueUserPromptContent
    | ErrorContent
    | InitContent
    | DoneContent
  metadata?: {
    tokens?: number
    cost?: number
    timestamp?: number
    seq?: number
  }
}

export interface SessionState {
  id: string
  status: SessionStatus
  messageCount: number
  totalTokens: number
  totalCost: number
  startTime: number
  endTime?: number
}

export interface SessionInfo {
  id: string
  provider: ProviderId
  state: SessionState
}

export interface BackgroundSessionData {
  sessionId: string
  projectId: string
  provider: ProviderId
  cwd: string
  streamChannel: string | null
  status: BackgroundSessionStatus
  startedAt: number
}

export interface BackgroundSessionInfo {
  sessionId: string
  projectId: string
  provider: ProviderId
  status: BackgroundSessionStatus
  startedAt: number
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

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

export interface BackgroundSessionResult {
  success: boolean
  session?: BackgroundSessionData
}

export interface BackgroundMessagesResult {
  success: boolean
  messages: AgentMessage[]
}

export interface PromptDisplayMessage {
  id: string
  role: "user"
  content: string
  parts?: Record<string, unknown>[]
  createdAt: string
}

export interface SessionHistoryEntry {
  kind: "user_message" | "agent_message"
  message: PromptDisplayMessage | AgentMessage
}

export interface SessionHistoryResult {
  success: boolean
  sessionId?: string
  provider?: ProviderId
  providerSessionId?: string
  status?: SessionStatus
  lastSeq?: number
  entries?: SessionHistoryEntry[]
  error?: string
}

export interface SessionMessageBlock {
  type: "text" | "tool"
  content?: string
  action?: {
    id: string
    type: string
    label: string
    status: "running" | "completed" | "error"
    output?: string
    timestamp: number
  }
}

export interface SessionMessageData {
  id: string
  role: "user" | "assistant"
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

/** Messages delivered over the agent stream WebSocket. */
export type AgentStreamMessage = AgentMessage | { type: "stream_end" }

// ---------------------------------------------------------------------------
// AgentApi
// ---------------------------------------------------------------------------

export class AgentApi {
  constructor(private readonly http: HttpClient) {}

  // --------------------------------------------------------------------------
  // Provider management
  // --------------------------------------------------------------------------

  /** Get all providers with their authentication status. */
  async getProviders(): Promise<ProviderInfo[]> {
    const res = await this.http.get<{ providers: ProviderInfo[] }>("/api/agent/providers")
    return res.providers
  }

  /** Get only providers that are currently authenticated. */
  async getAuthenticatedProviders(): Promise<ProviderInfo[]> {
    // Sidecar only has GET /api/agent/providers which returns auth status.
    // Filter to only authenticated ones client-side.
    const all = await this.getProviders()
    return all.filter((p) => p.isAuthenticated)
  }

  /** Check if a specific provider is authenticated. */
  async isAuthenticated(providerId: ProviderId): Promise<boolean> {
    // Sidecar doesn't have a per-provider auth check endpoint.
    // Use the providers list and filter.
    try {
      const all = await this.getProviders()
      const provider = all.find((p) => p.id === providerId)
      return provider?.isAuthenticated ?? false
    } catch {
      return false
    }
  }

  /** Get available models for a provider. */
  async getModels(providerId: ProviderId): Promise<AgentModel[]> {
    const res = await this.http.get<{ provider: string; models: AgentModel[] }>(
      `/api/agent/providers/${encodeURIComponent(providerId)}/models`,
    )
    return res.models
  }

  /** Set the default provider for new sessions. */
  async setDefaultProvider(providerId: ProviderId): Promise<OperationResult> {
    return this.http.post<OperationResult>("/api/agent/providers/default", {
      providerId,
    })
  }

  /** Get the current default provider. */
  async getDefaultProvider(): Promise<ProviderId> {
    const result = await this.http.get<{ providerId: ProviderId }>(
      "/api/agent/providers/default",
    )
    return result.providerId
  }

  // --------------------------------------------------------------------------
  // Session lifecycle
  // --------------------------------------------------------------------------

  /**
   * Create a new agent session.
   *
   * @param options  Session configuration including working directory, model,
   *                 permission mode, and optional environment variables.
   */
  async createSession(options: SessionOptions): Promise<CreateSessionResult> {
    try {
      const res = await this.http.post<{
        sessionId: string
        provider: string
        status: string
        model?: string
        cwd?: string
        projectId?: string
        startTime?: string
      }>("/api/agent/sessions", options)
      return { success: true, sessionId: res.sessionId }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  }

  /**
   * Send a prompt to an existing session.
   *
   * Returns a `streamChannel` identifier that can be used to construct the
   * WebSocket stream URL via `connectStream(sessionId)`.
   *
   * The sidecar endpoint is POST /api/agent/sessions/:id/message with body
   * `{ content }`.  It returns `{ queued, sessionId, wsPath }`.  We translate
   * the response into the `PromptResult` shape expected by the React app:
   * `{ success, streamChannel }`.
   *
   * @param sessionId  Session identifier returned from `createSession()`.
   * @param message    The user's text prompt.
   */
  async prompt(
    sessionId: string,
    message: string,
    displayMessage?: PromptDisplayMessage,
  ): Promise<PromptResult> {
    try {
      const res = await this.http.post<{
        queued: boolean
        sessionId: string
        wsPath: string
        message?: string
      }>(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}/message`,
        { content: message, displayMessage },
      )
      // The streamChannel used by the React app is the sessionId — it's used
      // as the key for the agent WebSocket stream.
      return { success: true, streamChannel: res.sessionId || sessionId }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errMsg }
    }
  }

  /**
   * Interrupt a running session (equivalent to pressing Ctrl+C in the agent).
   *
   * @param sessionId  Session identifier.
   */
  async interrupt(sessionId: string): Promise<OperationResult> {
    return this.http.post<OperationResult>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`,
      {},
    )
  }

  /**
   * Get the current state of a session.
   *
   * @param sessionId  Session identifier.
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    try {
      return await this.http.get<SessionState | null>(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
      )
    } catch {
      return null
    }
  }

  /** Get all active sessions. */
  async getActiveSessions(): Promise<SessionInfo[]> {
    const res = await this.http.get<{ sessions: SessionInfo[]; total: number }>("/api/agent/sessions")
    return res.sessions
  }

  /**
   * Terminate a session (interrupt + cleanup).
   *
   * @param sessionId  Session identifier.
   */
  async terminateSession(sessionId: string): Promise<OperationResult> {
    return this.http.delete<OperationResult>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
    )
  }

  // --------------------------------------------------------------------------
  // Background session management
  // --------------------------------------------------------------------------

  /**
   * Get the background session for a project (if running or recently completed).
   *
   * @param projectId  The project identifier.
   */
  async getBackgroundSession(
    projectId: string,
  ): Promise<BackgroundSessionResult> {
    return this.http.get<BackgroundSessionResult>(
      `/api/agent/background/${encodeURIComponent(projectId)}`,
    )
  }

  /** List all active background sessions. */
  async listBackgroundSessions(): Promise<BackgroundSessionInfo[]> {
    return this.http.get<BackgroundSessionInfo[]>("/api/agent/background")
  }

  /**
   * Unregister a background session (cleanup after reconnecting to it).
   *
   * @param sessionId  The session ID to unregister.
   */
  async unregisterBackgroundSession(
    sessionId: string,
  ): Promise<OperationResult> {
    return this.http.delete<OperationResult>(
      `/api/agent/background/${encodeURIComponent(sessionId)}`,
    )
  }

  /**
   * Get a background session by its session ID (for tab reconnection).
   *
   * @param sessionId  The session ID to look up.
   */
  async getBackgroundSessionById(
    sessionId: string,
  ): Promise<BackgroundSessionResult> {
    return this.http.get<BackgroundSessionResult>(
      `/api/agent/background/by-id/${encodeURIComponent(sessionId)}`,
    )
  }

  /**
   * Get buffered background messages for a session.
   * Used to replay messages missed while the UI was detached from the stream.
   *
   * @param sessionId  The session ID.
   * @param afterSeq   Only return messages with seq > afterSeq.  Pass 0 for all.
   */
  async getBackgroundMessages(
    sessionId: string,
    afterSeq?: number,
  ): Promise<BackgroundMessagesResult> {
    const params = new URLSearchParams()
    if (afterSeq !== undefined) params.set("afterSeq", String(afterSeq))
    const qs = params.size ? `?${params}` : ""
    return this.http.get<BackgroundMessagesResult>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages${qs}`,
    )
  }

  async getSessionHistory(sessionId: string): Promise<SessionHistoryResult> {
    return this.http.get<SessionHistoryResult>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/history`,
    )
  }

  // --------------------------------------------------------------------------
  // Session storage (local CLI files)
  // --------------------------------------------------------------------------

  /**
   * Read a persisted session from local Claude / Codex storage.
   *
   * @param sessionId    The session ID to read.
   * @param provider     Which provider's storage to read from.
   * @param projectPath  Optional project path to aid session discovery.
   */
  async readSession(
    sessionId: string,
    provider: ProviderId,
    projectPath?: string,
  ): Promise<ReadSessionResult> {
    const params = new URLSearchParams({ sessionId })
    if (projectPath) params.set("projectPath", projectPath)
    return this.http.get<ReadSessionResult>(
      `/api/agent/storage/${encodeURIComponent(provider)}/sessions/${encodeURIComponent(sessionId)}?${params}`,
    )
  }

  /**
   * List available sessions for a project from local storage.
   *
   * @param provider     Which provider's storage to list.
   * @param projectPath  Project path to list sessions for.
   */
  async listSessions(
    provider: ProviderId,
    projectPath?: string,
  ): Promise<ListSessionsResult> {
    const params = projectPath
      ? `?projectPath=${encodeURIComponent(projectPath)}`
      : ""
    return this.http.get<ListSessionsResult>(
      `/api/agent/storage/${encodeURIComponent(provider)}/sessions${params}`,
    )
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Generate a short project name from a description using AI.
   *
   * @param description  The project description or prompt.
   * @param provider     Which provider to use for name generation.
   */
  async generateProjectName(
    description: string,
    provider: ProviderId = "claude",
  ): Promise<{
    success: boolean
    name: string
    source: "ai" | "fallback"
    error?: string
  }> {
    return this.http.post("/api/agent/generate-project-name", {
      description,
      provider,
    })
  }

  // --------------------------------------------------------------------------
  // Streaming
  // --------------------------------------------------------------------------

  /**
   * Open a WebSocket connection to receive streaming agent responses for a
   * session.
   *
   * The caller must call `ws.connect()` after subscribing to events.  Each
   * incoming message is a parsed `AgentStreamMessage`.  The stream ends with
   * a `{ type: "stream_end" }` message.
   *
   * @example
   *   const ws = api.agent.connectStream(sessionId)
   *   ws.on("message", (msg) => {
   *     if (msg.type === "text") appendText(msg.content as string)
   *     if (msg.type === "stream_end") markComplete()
   *   })
   *   ws.connect()
   *
   * @param sessionId  The session to stream from.
   */
  connectStream(
    sessionId: string,
  ): SidecarWebSocket<AgentStreamMessage, never> {
    const wsUrl = this.http.wsUrl(
      `/api/agent/ws/${encodeURIComponent(sessionId)}`,
    )
    return new SidecarWebSocket<AgentStreamMessage, never>(wsUrl)
  }
}
