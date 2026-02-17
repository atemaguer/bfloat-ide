/**
 * Agent Manager
 *
 * Coordinates multiple AI agent providers (Claude and Codex) and provides a unified
 * interface for creating and managing agent sessions.
 */

import type {
  AgentManager,
  AgentProvider,
  AgentProviderId,
  AgentSession,
  AgentSessionOptions,
} from './types'
import { ClaudeAgentProvider } from './providers/claude-provider'
import { CodexAgentProvider } from './providers/codex-provider'
import { BfloatAgentProvider } from './providers/bfloat-provider'

/**
 * Default agent manager implementation
 */
class DefaultAgentManager implements AgentManager {
  private providers: Map<AgentProviderId, AgentProvider>
  // Default to 'claude' - uses existing Claude subscription via OAuth
  private defaultProviderId: AgentProviderId = 'claude'
  private activeSessions: Map<string, AgentSession> = new Map()

  constructor() {
    this.providers = new Map([
      ['claude', new ClaudeAgentProvider()],
      ['codex', new CodexAgentProvider()],
      // API key provider for direct API access (pay-per-use) - kept for backwards compatibility
      ['bfloat', new BfloatAgentProvider()],
    ])
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(id: AgentProviderId): AgentProvider | undefined {
    return this.providers.get(id)
  }

  /**
   * Get all available providers
   */
  getProviders(): AgentProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * Get all authenticated providers
   */
  async getAuthenticatedProviders(): Promise<AgentProvider[]> {
    const authenticated: AgentProvider[] = []
    for (const provider of this.providers.values()) {
      if (await provider.isAuthenticated()) {
        authenticated.push(provider)
      }
    }
    return authenticated
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(id: AgentProviderId): void {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown provider: ${id}`)
    }
    this.defaultProviderId = id
  }

  /**
   * Get the default provider ID
   */
  getDefaultProviderId(): AgentProviderId {
    return this.defaultProviderId
  }

  /**
   * Create a session with the default or specified provider
   * If resumeSessionId is provided, resumes an existing session instead
   */
  async createSession(
    options: AgentSessionOptions & { provider?: AgentProviderId }
  ): Promise<AgentSession> {
    const providerId = options.provider || this.defaultProviderId
    const provider = this.providers.get(providerId)

    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`)
    }

    // Check if provider is authenticated
    const isAuth = await provider.isAuthenticated()
    if (!isAuth) {
      throw new Error(
        `Provider ${providerId} is not authenticated. Please connect your ${provider.name} account first.`
      )
    }

    // If resumeSessionId is provided, resume the existing session
    let session: AgentSession
    if (options.resumeSessionId) {
      console.log(`[Agent Manager] Resuming session: ${options.resumeSessionId}`)
      session = await provider.resumeSession(options.resumeSessionId, options)
    } else {
      session = await provider.createSession(options)
    }

    this.activeSessions.set(session.id, session)
    return session
  }

  /**
   * Get an active session by ID
   */
  getSession(sessionId: string): AgentSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AgentSession[] {
    return Array.from(this.activeSessions.values())
  }

  /**
   * Remove a session from tracking (does not interrupt it)
   */
  removeSession(sessionId: string): boolean {
    return this.activeSessions.delete(sessionId)
  }

  /**
   * Interrupt and remove a session
   */
  async terminateSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (session) {
      await session.interrupt()
      this.activeSessions.delete(sessionId)
    }
  }

  /**
   * Interrupt all active sessions
   */
  async terminateAllSessions(): Promise<void> {
    const sessions = Array.from(this.activeSessions.values())
    await Promise.all(sessions.map((session) => session.interrupt()))
    this.activeSessions.clear()
  }
}

// Singleton instance
let managerInstance: DefaultAgentManager | null = null

/**
 * Get or create the agent manager singleton
 */
export function getAgentManager(): DefaultAgentManager {
  if (!managerInstance) {
    managerInstance = new DefaultAgentManager()
  }
  return managerInstance
}

/**
 * Reset the agent manager (mainly for testing)
 */
export function resetAgentManager(): void {
  if (managerInstance) {
    managerInstance.terminateAllSessions()
  }
  managerInstance = null
}

export { DefaultAgentManager }
export type { AgentManager }
