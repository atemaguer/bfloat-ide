/**
 * Background Session Registry
 *
 * Tracks agent sessions that continue running in the background when the user
 * navigates away from the project page. Buffers messages so they can be replayed
 * when the user returns, and provides session lookup by projectId for reconnection.
 */

import type { AgentProviderId, AgentMessage } from './types'

export type BackgroundSessionStatus = 'running' | 'completed' | 'error'

export interface BackgroundSession {
  /** Manager's internal session ID */
  sessionId: string
  /** Which project this session belongs to */
  projectId: string
  /** Agent provider (claude or codex) */
  provider: AgentProviderId
  /** Working directory the agent is operating in */
  cwd: string
  /** Current IPC stream channel (null if not actively streaming) */
  streamChannel: string | null
  /** Buffered messages for replay on reconnect */
  messages: AgentMessage[]
  /** Monotonic sequence counter for buffered stream events */
  messageSeq: number
  /** Current status */
  status: BackgroundSessionStatus
  /** When the session was registered */
  startedAt: number
}

class BackgroundSessionRegistry {
  /** Sessions indexed by sessionId */
  private sessions: Map<string, BackgroundSession> = new Map()
  /** Alias index: external session ID (e.g. provider init sessionId) -> internal manager session ID */
  private sessionAliasIndex: Map<string, string> = new Map()
  /** Reverse index: projectId → set of sessionIds */
  private projectIndex: Map<string, Set<string>> = new Map()

  /**
   * Register a new background session
   */
  register(sessionId: string, projectId: string, provider: AgentProviderId, cwd: string): void {
    const session: BackgroundSession = {
      sessionId,
      projectId,
      provider,
      cwd,
      streamChannel: null,
      messages: [],
      messageSeq: 0,
      status: 'running',
      startedAt: Date.now(),
    }

    this.sessions.set(sessionId, session)

    let projectSessions = this.projectIndex.get(projectId)
    if (!projectSessions) {
      projectSessions = new Set()
      this.projectIndex.set(projectId, projectSessions)
    }
    projectSessions.add(sessionId)

    console.log(`[BackgroundRegistry] Registered session ${sessionId} for project ${projectId}`)
  }

  /**
   * Register an alias session ID (e.g., provider init session ID) for an existing manager session ID.
   */
  registerAlias(sessionId: string, aliasSessionId: string): void {
    if (!aliasSessionId || aliasSessionId === sessionId) return
    if (!this.sessions.has(sessionId)) return
    this.sessionAliasIndex.set(aliasSessionId, sessionId)
    console.log(`[BackgroundRegistry] Registered alias ${aliasSessionId} -> ${sessionId}`)
  }

  private resolveSessionId(sessionId: string): string {
    return this.sessionAliasIndex.get(sessionId) || sessionId
  }

  /**
   * Set the current stream channel for a session
   */
  setStreamChannel(sessionId: string, channel: string): void {
    const resolvedId = this.resolveSessionId(sessionId)
    const session = this.sessions.get(resolvedId)
    if (session) {
      session.streamChannel = channel
    }
  }

  /**
   * Buffer a message for replay on reconnect
   */
  pushMessage(sessionId: string, message: AgentMessage): void {
    const resolvedId = this.resolveSessionId(sessionId)
    const session = this.sessions.get(resolvedId)
    if (session) {
      session.messageSeq += 1
      session.messages.push({
        ...message,
        metadata: {
          ...message.metadata,
          seq: session.messageSeq,
        },
      })
    }
  }

  /**
   * Get buffered messages after a given sequence number.
   */
  getMessagesSince(sessionId: string, afterSeq: number = 0): AgentMessage[] {
    const resolvedId = this.resolveSessionId(sessionId)
    const session = this.sessions.get(resolvedId)
    if (!session) return []

    return session.messages.filter((msg) => (msg.metadata?.seq || 0) > afterSeq)
  }

  /**
   * Mark a session as completed (agent finished its work)
   */
  markCompleted(sessionId: string): void {
    const resolvedId = this.resolveSessionId(sessionId)
    const session = this.sessions.get(resolvedId)
    if (session) {
      session.status = 'completed'
      session.streamChannel = null
      console.log(`[BackgroundRegistry] Session ${sessionId} completed`)
    }
  }

  /**
   * Mark a session as errored
   */
  markError(sessionId: string): void {
    const resolvedId = this.resolveSessionId(sessionId)
    const session = this.sessions.get(resolvedId)
    if (session) {
      session.status = 'error'
      session.streamChannel = null
      console.log(`[BackgroundRegistry] Session ${sessionId} errored`)
    }
  }

  /**
   * Get the most relevant background session for a project.
   * Prefers running sessions (most recent); falls back to most recent completed/errored.
   */
  getByProject(projectId: string): BackgroundSession | null {
    const sessionIds = this.projectIndex.get(projectId)
    if (!sessionIds || sessionIds.size === 0) return null

    let bestRunning: BackgroundSession | null = null
    let bestOther: BackgroundSession | null = null

    for (const sid of sessionIds) {
      const session = this.sessions.get(sid)
      if (!session) continue

      if (session.status === 'running') {
        if (!bestRunning || session.startedAt > bestRunning.startedAt) {
          bestRunning = session
        }
      } else {
        if (!bestOther || session.startedAt > bestOther.startedAt) {
          bestOther = session
        }
      }
    }

    return bestRunning || bestOther
  }

  /**
   * Get a background session by session ID (also resolves aliases)
   */
  getBySessionId(sessionId: string): BackgroundSession | null {
    const resolvedId = this.resolveSessionId(sessionId)
    return this.sessions.get(resolvedId) || null
  }

  /**
   * Unregister a session (on explicit termination or cleanup)
   */
  unregister(sessionId: string): void {
    const resolvedId = this.resolveSessionId(sessionId)
    const session = this.sessions.get(resolvedId)
    if (session) {
      const projectSessions = this.projectIndex.get(session.projectId)
      if (projectSessions) {
        projectSessions.delete(resolvedId)
        if (projectSessions.size === 0) {
          this.projectIndex.delete(session.projectId)
        }
      }
      this.sessions.delete(resolvedId)

      // Remove aliases that point to this resolved session
      for (const [alias, target] of this.sessionAliasIndex.entries()) {
        if (target === resolvedId) {
          this.sessionAliasIndex.delete(alias)
        }
      }

      console.log(`[BackgroundRegistry] Unregistered session ${resolvedId}`)
    }
  }

  /**
   * Get all active background sessions (status === 'running')
   */
  getAllActive(): BackgroundSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'running')
  }

  /**
   * Get all sessions (any status)
   */
  getAll(): BackgroundSession[] {
    return Array.from(this.sessions.values())
  }
}

// Singleton instance
let registryInstance: BackgroundSessionRegistry | null = null

export function getBackgroundRegistry(): BackgroundSessionRegistry {
  if (!registryInstance) {
    registryInstance = new BackgroundSessionRegistry()
  }
  return registryInstance
}
