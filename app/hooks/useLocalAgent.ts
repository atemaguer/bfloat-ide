/**
 * useLocalAgent Hook
 *
 * Provides integration with the local AI agent interface (Claude Code / Codex CLI).
 * This enables direct control of AI agents on the desktop without going through the backend.
 *
 * Supports background sessions: when the user navigates away from the project page,
 * the agent continues running. When the user returns, the hook reconnects to the
 * background session, replaying buffered messages and resuming live streaming.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { workbenchStore } from '@/app/stores/workbench'
import { aiAgent, secrets as secretsApi } from '@/app/api/sidecar'
import type { AgentMessage, SessionOptions, ProviderId, AgentTool } from '@/lib/conveyor/schemas/ai-agent-schema'
import type { PromptDisplayMessage } from '@/packages/desktop/src/api/agent'

// Tools to disable - AskUserQuestion requires special UI handling that isn't fully reliable yet
const DISALLOWED_TOOLS = ['AskUserQuestion']
const DEFAULT_AGENT_ERROR_MESSAGE = 'Agent failed before returning a detailed error. Check the sidecar logs for more information.'
const DEFAULT_CODEX_ERROR_MESSAGE =
  'Codex failed before returning a detailed error. Check authentication, model access, or sidecar logs for details.'

function normalizeAgentErrorMessage(error: string | undefined, provider?: ProviderId): string {
  const trimmed = error?.trim()
  if (trimmed && trimmed !== '[object Object]' && trimmed.toLowerCase() !== 'unknown error') {
    return trimmed
  }

  return provider === 'codex' ? DEFAULT_CODEX_ERROR_MESSAGE : DEFAULT_AGENT_ERROR_MESSAGE
}

/**
 * Detect whether a prompt error indicates the session no longer exists on the
 * sidecar (e.g., the backing CLI process died mid-stream and the in-memory
 * session was cleaned up).  When this returns true the caller should clear the
 * stale session ref and retry with a fresh session.
 */
function isSessionLostError(error: string | undefined): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  // Some API paths collapse 404s to just "Not Found" without including
  // the full session message body. Treat that as recoverable here.
  return lower.includes('not found') && (lower.includes('session') || lower.trim() === 'not found')
}

interface LocalAgentState {
  isConnected: boolean
  isRunning: boolean
  sessionId: string | null
  error: string | null
  messages: AgentMessage[]
}

type PermissionMode = 'default' | 'plan' | 'bypassPermissions' | 'delegate' | 'dontAsk'

interface ReconnectSessionInfo {
  sessionId: string
  provider: ProviderId
  status: 'running' | 'completed' | 'error'
  source: 'mount' | 'tab'
}

interface ReconnectResult {
  attached: boolean
  canonicalSessionId: string | null
}

interface AgentCallbackContext {
  runtimeSessionId: string | null
}

interface SendPromptOptions {
  forceNewSession?: boolean
  retryConflictWithFreshSession?: boolean
}

interface UseLocalAgentOptions {
  cwd: string
  provider?: ProviderId
  model?: string
  sessionId?: string | null // Canonical sidecar/app session ID for subsequent turns
  systemPrompt?: string // Custom system prompt for exploration
  permissionMode?: PermissionMode // Permission mode for the session
  disallowedTools?: string[] // Tools to disable
  allowedTools?: AgentTool[] // Tools to allow
  resumeProviderSessionId?: string | null // Provider session ID/thread ID to resume from
  projectId?: string // Project ID for background session tracking
  maxTurns?: number // Maximum agentic turns (prevents infinite loops)
  agents?: Record<string, import('@/lib/agents/types').AgentDefinition> // Agent/subagent definitions for team orchestration
  onMessage?: (message: AgentMessage, context: AgentCallbackContext) => void
  onError?: (error: string, context: AgentCallbackContext) => void
  onComplete?: (context: AgentCallbackContext) => void
  onSessionId?: (sessionId: string) => void // Called when we get a session ID from init
  onReconnectSession?: (info: ReconnectSessionInfo) => Promise<number | undefined> | number | undefined // Called when reattaching to an existing session
  enableMountReconnect?: boolean
}

export function useLocalAgent(options: UseLocalAgentOptions) {
  const [state, setState] = useState<LocalAgentState>({
    isConnected: false,
    isRunning: false,
    sessionId: null,
    error: null,
    messages: [],
  })

  const subscriptionBySessionRef = useRef<Map<string, () => void>>(new Map())
  const streamChannelBySessionRef = useRef<Map<string, string>>(new Map())
  /** Per-session subscription token used to discard stale callbacks after resubscribe/unsubscribe */
  const subscriptionTokenBySessionRef = useRef<Map<string, number>>(new Map())
  const sessionIdRef = useRef<string | null>(options.sessionId || null)
  const providerSessionIdRef = useRef<string | null>(options.resumeProviderSessionId || null)
  const requestedResumeSessionIdRef = useRef<string | null>(options.resumeProviderSessionId || null)
  const skipResumeOnceRef = useRef(false)
  const cwdRef = useRef<string>(options.cwd)
  const hasReconnected = useRef(false)
  /** Per-session last seen seq number for deduplication on reconnect */
  const lastSeqBySessionRef = useRef<Map<string, number>>(new Map())

  // Callback refs — keep options callbacks fresh without destabilising subscribeToStream
  const onMessageRef = useRef(options.onMessage)
  const onCompleteRef = useRef(options.onComplete)
  const onSessionIdRef = useRef(options.onSessionId)
  const onReconnectSessionRef = useRef(options.onReconnectSession)
  const onErrorRef = useRef(options.onError)

  useEffect(() => {
    onMessageRef.current = options.onMessage
    onCompleteRef.current = options.onComplete
    onSessionIdRef.current = options.onSessionId
    onReconnectSessionRef.current = options.onReconnectSession
    onErrorRef.current = options.onError

    requestedResumeSessionIdRef.current = options.resumeProviderSessionId || null
    if (options.sessionId && sessionIdRef.current !== options.sessionId) {
      console.log('[useLocalAgent] Syncing internal live session ref from options.sessionId', {
        previousSessionId: sessionIdRef.current,
        nextSessionId: options.sessionId,
      })
      sessionIdRef.current = options.sessionId
      setState((prev) => ({ ...prev, sessionId: options.sessionId }))
    }
    if (!skipResumeOnceRef.current && options.resumeProviderSessionId === null && providerSessionIdRef.current !== null) {
      console.log('[useLocalAgent] Clearing provider resume session ref from options.resumeProviderSessionId=null', {
        previousProviderSessionId: providerSessionIdRef.current,
      })
      providerSessionIdRef.current = null
    } else if (
      !skipResumeOnceRef.current &&
      options.resumeProviderSessionId &&
      providerSessionIdRef.current !== options.resumeProviderSessionId
    ) {
      console.log('[useLocalAgent] Syncing provider resume session ref from options.resumeProviderSessionId', {
        previousProviderSessionId: providerSessionIdRef.current,
        nextProviderSessionId: options.resumeProviderSessionId,
      })
      providerSessionIdRef.current = options.resumeProviderSessionId
    }
  })

  const getLastSeq = useCallback((sessionId: string): number => {
    return lastSeqBySessionRef.current.get(sessionId) || 0
  }, [])

  const updateLastSeq = useCallback((sessionId: string, message: AgentMessage) => {
    const seq = message.metadata?.seq
    if (typeof seq === 'number' && Number.isFinite(seq)) {
      const current = lastSeqBySessionRef.current.get(sessionId) || 0
      if (seq > current) {
        lastSeqBySessionRef.current.set(sessionId, seq)
      }
    }
  }, [])

  const seedLastSeq = useCallback((sessionId: string, seq?: number) => {
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq <= 0) return

    const current = lastSeqBySessionRef.current.get(sessionId) || 0
    if (seq > current) {
      lastSeqBySessionRef.current.set(sessionId, seq)
    }
  }, [])

  const shouldProcessMessage = useCallback(
    (sessionId: string, message: AgentMessage): boolean => {
      const seq = message.metadata?.seq
      if (typeof seq !== 'number' || !Number.isFinite(seq)) {
        return true
      }

      const current = getLastSeq(sessionId)
      if (seq <= current) {
        console.log('[useLocalAgent] Dropping duplicate/old message', { sessionId, seq, current })
        return false
      }

      return true
    },
    [getLastSeq]
  )

  const handleAgentMessage = useCallback(
    (agentMsg: AgentMessage, runtimeSessionId: string | null) => {
      if (runtimeSessionId && runtimeSessionId === sessionIdRef.current) {
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, agentMsg],
        }))
      }

      onMessageRef.current?.(agentMsg, { runtimeSessionId })

      // Handle init message - extract and report session ID
      if (agentMsg.type === 'init') {
        const initContent = agentMsg.content as { sessionId: string; providerSessionId?: string }
        console.log('[useLocalAgent] ========================================')
        console.log('[useLocalAgent] INIT MESSAGE RECEIVED')
        console.log('[useLocalAgent] Session ID:', initContent.sessionId || '(empty)')
        console.log('[useLocalAgent] Has onSessionId callback:', !!onSessionIdRef.current)
        console.log('[useLocalAgent] ========================================')
        if (initContent.sessionId) {
          skipResumeOnceRef.current = false
          const providerSessionId = initContent.providerSessionId || initContent.sessionId
          if (providerSessionIdRef.current && providerSessionIdRef.current !== providerSessionId) {
            console.warn('[useLocalAgent] Provider session ID rotated during active session', {
              previousProviderSessionId: providerSessionIdRef.current,
              nextProviderSessionId: providerSessionId,
              activeSidecarSessionId: sessionIdRef.current,
              requestedResumeSessionId: requestedResumeSessionIdRef.current,
            })
          }

          providerSessionIdRef.current = providerSessionId
          console.log('[useLocalAgent] Calling onSessionId callback...')
          onSessionIdRef.current?.(initContent.sessionId)
          console.log('[useLocalAgent] onSessionId callback completed')
        } else {
          console.log('[useLocalAgent] Skipping callback - sessionId is empty')
        }
      }

      // Handle errors
      if (agentMsg.type === 'error') {
        const errorContent = agentMsg.content as { message: string }
        const errorMessage = normalizeAgentErrorMessage(errorContent.message, options.provider)
        if (runtimeSessionId && runtimeSessionId === sessionIdRef.current) {
          setState((prev) => ({ ...prev, error: errorMessage }))
        }
        onErrorRef.current?.(errorMessage, { runtimeSessionId })
      }

      // Completion is finalized on stream_end so we don't double-fire onComplete
      // for the same runtime session.
      if (agentMsg.type === 'done' && runtimeSessionId && runtimeSessionId === sessionIdRef.current) {
        setState((prev) => ({ ...prev, isRunning: false }))
      }
    },
    []
  )

  const unsubscribeFromSession = useCallback((sessionId: string) => {
    const unsubscribe = subscriptionBySessionRef.current.get(sessionId)
    if (unsubscribe) {
      unsubscribe()
      subscriptionBySessionRef.current.delete(sessionId)
    }
    streamChannelBySessionRef.current.delete(sessionId)
    const currentToken = subscriptionTokenBySessionRef.current.get(sessionId) || 0
    subscriptionTokenBySessionRef.current.set(sessionId, currentToken + 1)
  }, [])

  /**
   * Replay buffered messages from the background registry that were missed
   * while the renderer was detached (e.g. user switched session tabs).
   */
  const replayBufferedMessages = useCallback(
    async (sessionId: string, afterSeqOverride?: number) => {
      try {
        const afterSeq = afterSeqOverride ?? getLastSeq(sessionId)
        console.log('[useLocalAgent] Replaying buffered messages', { sessionId, afterSeq })
        const replay = await aiAgent.getBackgroundMessages(sessionId, afterSeq)
        console.log('[useLocalAgent] Buffered message replay result', {
          sessionId,
          success: replay.success,
          count: replay.messages?.length ?? 0,
          afterSeq,
        })
        if (!replay.success || !replay.messages || replay.messages.length === 0) return

        for (const msg of replay.messages) {
          if (!shouldProcessMessage(sessionId, msg)) continue
          updateLastSeq(sessionId, msg)
          handleAgentMessage(msg, sessionId)
        }
      } catch (error) {
        console.error('[useLocalAgent] Failed to replay buffered messages:', error)
      }
    },
    [getLastSeq, handleAgentMessage, shouldProcessMessage, updateLastSeq]
  )

  /**
   * Subscribe to a live stream channel. Captures a subscription ID so that
   * callbacks from stale subscriptions (e.g. after a tab switch) are silently
   * discarded.
   */
  const subscribeToStream = useCallback(
    (sessionId: string, streamChannel: string) => {
      const currentChannel = streamChannelBySessionRef.current.get(sessionId)
      if (currentChannel === streamChannel && subscriptionBySessionRef.current.has(sessionId)) {
        console.log('[useLocalAgent] Reusing existing stream subscription', { sessionId, streamChannel })
        return
      }

      unsubscribeFromSession(sessionId)
      streamChannelBySessionRef.current.set(sessionId, streamChannel)
      const subscriptionToken = (subscriptionTokenBySessionRef.current.get(sessionId) || 0) + 1
      subscriptionTokenBySessionRef.current.set(sessionId, subscriptionToken)

      console.log('[useLocalAgent] Subscribing to stream', { sessionId, streamChannel, subscriptionToken })
      const unsubscribe = aiAgent.onStreamMessage(
        streamChannel,
        (msg) => {
          console.log('[useLocalAgent] Stream message received:', msg.type)

          const activeToken = subscriptionTokenBySessionRef.current.get(sessionId)
          if (activeToken !== subscriptionToken) {
            console.log('[useLocalAgent] Ignoring stale subscription event', {
              sessionId,
              subscriptionToken,
              activeToken,
              type: msg.type,
            })
            return
          }

          if (msg.type === 'stream_end') {
            console.log('[useLocalAgent] Stream ended', { sessionId, streamChannel })
            unsubscribeFromSession(sessionId)
            if (sessionIdRef.current === sessionId) {
              setState((prev) => ({ ...prev, isRunning: false }))
            }
            onCompleteRef.current?.({ runtimeSessionId: sessionId })
            return
          }

          const agentMsg = msg as AgentMessage
          if (!shouldProcessMessage(sessionId, agentMsg)) return
          updateLastSeq(sessionId, agentMsg)
          handleAgentMessage(agentMsg, sessionId)
        }
      )
      subscriptionBySessionRef.current.set(sessionId, unsubscribe)
    },
    [handleAgentMessage, shouldProcessMessage, unsubscribeFromSession, updateLastSeq]
  )

  /**
   * Attempt to attach to a running background session. Polls briefly for the
   * stream channel to be published (it is set in a setImmediate on the main
   * process side, so it may not be available immediately after prompt() returns).
   *
   * The caller may pass `afterSeq` from a previously hydrated transcript so
   * replay only fetches frames that were not already rendered.
   */
  const reconnectToRunningSession = useCallback(
    async (
      sessionId: string,
      { maxAttempts = 8, delayMs = 200, afterSeq }: { maxAttempts?: number; delayMs?: number; afterSeq?: number } = {}
    ): Promise<boolean> => {
      console.log('[useLocalAgent] Attempting to reconnect to running session', { sessionId, maxAttempts, delayMs, afterSeq })
      seedLastSeq(sessionId, afterSeq)
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await aiAgent.getBackgroundSessionById(sessionId)
        const bgSession = result.session
        console.log('[useLocalAgent] Reconnect attempt', {
          sessionId,
          attempt: attempt + 1,
          success: result.success,
          status: bgSession?.status,
          streamChannel: bgSession?.streamChannel || null,
        })

        if (!result.success || !bgSession || bgSession.status !== 'running') {
          console.log('[useLocalAgent] Session no longer running, aborting reconnect', { sessionId })
          return false
        }

        // Stream channel is set asynchronously via setImmediate on the main process.
        // Poll until it is published.
        if (!bgSession.streamChannel) {
          console.log('[useLocalAgent] Stream channel not yet available, waiting...', { sessionId, attempt: attempt + 1 })
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }

        subscribeToStream(sessionId, bgSession.streamChannel)
        await replayBufferedMessages(sessionId, afterSeq)
        console.log('[useLocalAgent] Successfully reconnected to session', { sessionId, streamChannel: bgSession.streamChannel })
        return true
      }

      console.warn('[useLocalAgent] Failed to reconnect after max attempts', { sessionId, maxAttempts })
      return false
    },
    [replayBufferedMessages, seedLastSeq, subscribeToStream]
  )

  // Cleanup on unmount - only unsubscribe from stream, do NOT terminate the session.
  // The agent continues running in the background via the main process.
  useEffect(() => {
    return () => {
      for (const [sessionId, unsubscribe] of subscriptionBySessionRef.current.entries()) {
        unsubscribe()
        const currentToken = subscriptionTokenBySessionRef.current.get(sessionId) || 0
        subscriptionTokenBySessionRef.current.set(sessionId, currentToken + 1)
      }
      subscriptionBySessionRef.current.clear()
      streamChannelBySessionRef.current.clear()
      // NOTE: We intentionally do NOT terminate the session here.
      // The session continues running in the background and can be
      // reconnected to when the user returns to the project page.
      console.log('[useLocalAgent] Unmounting - detaching from session:', sessionIdRef.current)
    }
  }, [])

  // Reconnect to a background session on mount (if one exists for this project)
  useEffect(() => {
    if (!options.projectId || !options.enableMountReconnect || hasReconnected.current) return
    hasReconnected.current = true

    const reconnect = async () => {
      try {
        console.log('[useLocalAgent] Checking for background sessions for project:', options.projectId)
        const sessions = await aiAgent.listBackgroundSessions()
        const projectSessions = sessions
          .filter((session) => session.projectId === options.projectId)
          .sort((a, b) => b.startedAt - a.startedAt)

        if (projectSessions.length === 0) {
          console.log('[useLocalAgent] No background session found')
          return
        }

        if (projectSessions.length > 1) {
          console.log('[useLocalAgent] Skipping mount reconnect because project has multiple background sessions', {
            projectId: options.projectId,
            sessions: projectSessions.map((session) => ({
              sessionId: session.sessionId,
              provider: session.provider,
              status: session.status,
              startedAt: session.startedAt,
            })),
          })
          return
        }

        const bgSession = projectSessions[0]
        console.log('[useLocalAgent] Found background session:', {
          sessionId: bgSession.sessionId,
          status: bgSession.status,
        })

        if (bgSession.status === 'running') {
          // Only running background sessions should seed the live session ref.
          sessionIdRef.current = bgSession.sessionId
          setState((prev) => ({
            ...prev,
            sessionId: bgSession.sessionId,
          }))
          setState((prev) => ({ ...prev, isRunning: true }))
          const afterSeq = await onReconnectSessionRef.current?.({
            sessionId: bgSession.sessionId,
            provider: bgSession.provider,
            status: bgSession.status,
            source: 'mount',
          })
          const attached = await reconnectToRunningSession(bgSession.sessionId, { afterSeq })
          if (!attached) {
            // Keep session selected even if currently unattached
            setState((prev) => ({ ...prev, isRunning: false }))
            console.log('[useLocalAgent] Could not attach to running session on mount', { sessionId: bgSession.sessionId })
          }
        } else if (bgSession.status === 'completed') {
          // Session completed while user was away
          console.log('[useLocalAgent] Background session already completed')
          sessionIdRef.current = null
          setState((prev) => ({ ...prev, sessionId: null, isRunning: false }))
          await onReconnectSessionRef.current?.({
            sessionId: bgSession.sessionId,
            provider: bgSession.provider,
            status: bgSession.status,
            source: 'mount',
          })
          onCompleteRef.current?.({ runtimeSessionId: bgSession.sessionId })

          // Clean up the completed background session
          aiAgent.unregisterBackgroundSession(bgSession.sessionId)
        } else if (bgSession.status === 'error') {
          // Session errored while user was away
          console.log('[useLocalAgent] Background session errored')
          sessionIdRef.current = null
          setState((prev) => ({ ...prev, sessionId: null, isRunning: false }))
          await onReconnectSessionRef.current?.({
            sessionId: bgSession.sessionId,
            provider: bgSession.provider,
            status: bgSession.status,
            source: 'mount',
          })
          onErrorRef.current?.('Agent session encountered an error while running in the background', {
            runtimeSessionId: bgSession.sessionId,
          })

          // Clean up the errored background session
          aiAgent.unregisterBackgroundSession(bgSession.sessionId)
        }
      } catch (error) {
        console.error('[useLocalAgent] Failed to reconnect to background session:', error)
      }
    }

    reconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enableMountReconnect, options.projectId, reconnectToRunningSession])

  // Invalidate session when cwd changes to a DIFFERENT project
  // Don't terminate if transitioning from empty string to valid path (initial load)
  useEffect(() => {
    const oldCwd = cwdRef.current
    const newCwd = options.cwd

    // Only terminate if BOTH old and new are valid paths and they're different
    // This prevents termination during initial load when cwd goes from '' to '/path'
    if (oldCwd && newCwd && oldCwd !== newCwd && sessionIdRef.current) {
      console.log('[useLocalAgent] CWD changed to different project, invalidating session:', {
        oldCwd,
        newCwd,
        sessionId: sessionIdRef.current,
      })
      // Terminate the old session (CWD change means different project context)
      aiAgent.terminateSession(sessionIdRef.current)
      sessionIdRef.current = null
      setState((prev) => ({ ...prev, sessionId: null }))
    }
    cwdRef.current = newCwd
  }, [options.cwd])

  // Check if provider is authenticated (CLI-based)
  const checkAuthentication = useCallback(async (providerId: ProviderId = 'claude') => {
    try {
      const isAuth = await aiAgent.isAuthenticated(providerId)
      setState((prev) => ({ ...prev, isConnected: isAuth }))
      return isAuth
    } catch (error) {
      console.error('[useLocalAgent] Auth check failed:', error)
      return false
    }
  }, [])

  // Create a new session (or resume existing one)
  const createSession = useCallback(async () => {
    // Validate cwd before creating session
    if (!options.cwd) {
      const error = 'Cannot create agent session: project path is not set'
      console.error('[useLocalAgent]', error)
      throw new Error(error)
    }

    console.log('[useLocalAgent] createSession called, current sessionId:', sessionIdRef.current)

    // Get any pending environment variables (e.g., credentials saved in settings)
    const pendingEnvVars = workbenchStore.takePendingEnvVars()
    const sessionEnvVars: Record<string, string> = {}

    if (options.projectId) {
      try {
        const secretResult = await secretsApi.readSecrets(options.projectId)
        if (!secretResult.error && Array.isArray(secretResult.secrets)) {
          for (const secret of secretResult.secrets) {
            if (secret?.key && typeof secret.value === 'string') {
              sessionEnvVars[secret.key] = secret.value
            }
          }
        }
      } catch (error) {
        console.warn('[useLocalAgent] Failed to load project secrets for session env:', error)
      }
    }

    if (pendingEnvVars) {
      Object.assign(sessionEnvVars, pendingEnvVars)
    }

    // Build session options - only include properties that are defined
    const sessionOptions: SessionOptions = {
      cwd: options.cwd,
      permissionMode: options.permissionMode || 'bypassPermissions',
      disallowedTools: options.disallowedTools || DISALLOWED_TOOLS,
    }

    if (options.provider) sessionOptions.provider = options.provider
    if (options.model) sessionOptions.model = options.model
    if (options.systemPrompt) sessionOptions.systemPrompt = options.systemPrompt
    const resumeSessionId =
      skipResumeOnceRef.current ? null : providerSessionIdRef.current || options.resumeProviderSessionId || null
    if (resumeSessionId) {
      sessionOptions.resumeSessionId = resumeSessionId
    }
    if (options.allowedTools) sessionOptions.allowedTools = options.allowedTools
    if (Object.keys(sessionEnvVars).length > 0) sessionOptions.env = sessionEnvVars
    if (options.projectId) sessionOptions.projectId = options.projectId
    sessionOptions.maxTurns = options.maxTurns || 50
    if (options.agents) sessionOptions.agents = options.agents

    console.log('[useLocalAgent] ========================================')
    if (Object.keys(sessionEnvVars).length > 0) {
      console.log('[useLocalAgent] Session env vars:', Object.keys(sessionEnvVars))
      console.log('[useLocalAgent] Env var values (sanitized):', Object.fromEntries(
        Object.entries(sessionEnvVars).map(([k, v]) => [k, k.includes('PASSWORD') || k.includes('SECRET') ? '***' : v])
      ))
    } else {
      console.log('[useLocalAgent] No session env vars')
    }
    console.log('[useLocalAgent] ' + (resumeSessionId ? 'RESUMING SESSION' : 'CREATING NEW SESSION'))
    console.log('[useLocalAgent] CWD:', options.cwd)
    console.log('[useLocalAgent] Provider:', options.provider || 'default')
    console.log('[useLocalAgent] Model:', options.model || 'default')
    console.log('[useLocalAgent] Project ID:', options.projectId || 'none')
    console.log('[useLocalAgent] sessionOptions.env keys:', sessionOptions.env ? Object.keys(sessionOptions.env) : 'none')
    if (resumeSessionId) {
      console.log('[useLocalAgent] Resume Session ID:', resumeSessionId)
    } else if (skipResumeOnceRef.current) {
      console.log('[useLocalAgent] Resume temporarily disabled after stale-session recovery')
    }
    console.log('[useLocalAgent] ========================================')
    const result = await aiAgent.createSession(sessionOptions)

    if (!result.success || !result.sessionId) {
      const error = result.error || 'Failed to create session'
      console.error('[useLocalAgent] Session creation failed:', error)
      setState((prev) => ({ ...prev, error }))
      throw new Error(error)
    }

    console.log('[useLocalAgent] Session created:', result.sessionId)
    sessionIdRef.current = result.sessionId
    setState((prev) => ({
      ...prev,
      sessionId: result.sessionId!,
      error: null,
    }))
    onSessionIdRef.current?.(result.sessionId)

    return result.sessionId
  }, [options.cwd, options.provider, options.model, options.sessionId, options.systemPrompt, options.resumeProviderSessionId, options.projectId])

  // Send a prompt to the agent
  const sendPrompt = useCallback(
    async (message: string, displayMessage?: PromptDisplayMessage, sendOptions?: SendPromptOptions) => {
      console.log('[useLocalAgent] sendPrompt called with:', message)
      try {
        setState((prev) => ({ ...prev, isRunning: true, error: null }))

        // Create session if not exists OR if there are pending env vars
        // Pending env vars (e.g., Apple credentials for iOS deployment) require a new session
        const shouldForceNewSession = sendOptions?.forceNewSession === true
        let sessionId = shouldForceNewSession ? null : sessionIdRef.current
        const hasPendingEnvVars = workbenchStore.hasPendingEnvVars()

        console.log('[useLocalAgent] Has pending env vars:', hasPendingEnvVars)
        if (shouldForceNewSession) {
          console.log('[useLocalAgent] sendPrompt forcing a fresh runtime session', {
            previousSessionId: sessionIdRef.current,
            resumeProviderSessionId: providerSessionIdRef.current || options.resumeProviderSessionId || null,
          })
        }

        if (!sessionId || hasPendingEnvVars || shouldForceNewSession) {
          if (hasPendingEnvVars && sessionIdRef.current) {
            console.log('[useLocalAgent] Creating new session to pick up pending env vars')
          }
          if (shouldForceNewSession && sessionIdRef.current) {
            console.log('[useLocalAgent] Ignoring currently attached runtime session for fresh prompt', {
              attachedSessionId: sessionIdRef.current,
            })
          }
          sessionId = await createSession()
        }

        console.log('[useLocalAgent] Sending prompt to session:', sessionId)
        console.log('[useLocalAgent] Prompt message:', message)
        let result = await aiAgent.prompt(sessionId, message, displayMessage)

        if (!result.success || !result.streamChannel) {
          // Session is gone (404 or similar) — clear stale ref and retry once with a fresh session
          if (isSessionLostError(result.error)) {
            console.warn('[useLocalAgent] Session lost, recovering with new session:', {
              oldSessionId: sessionId,
              error: result.error,
            })
            skipResumeOnceRef.current = true
            sessionIdRef.current = null
            providerSessionIdRef.current = null
            requestedResumeSessionIdRef.current = null
            setState((prev) => ({ ...prev, sessionId: null }))
            sessionId = await createSession()
            result = await aiAgent.prompt(sessionId, message, displayMessage)
            if (!result.success || !result.streamChannel) {
              throw new Error(result.error || 'Failed to send prompt after session recovery')
            }
          } else if (result.error === 'Conflict' && sendOptions?.retryConflictWithFreshSession) {
            console.warn('[useLocalAgent] Session conflict, retrying with a fresh runtime session:', {
              oldSessionId: sessionId,
              resumeProviderSessionId: providerSessionIdRef.current || options.resumeProviderSessionId || null,
            })
            sessionIdRef.current = null
            setState((prev) => ({ ...prev, sessionId: null }))
            sessionId = await createSession()
            result = await aiAgent.prompt(sessionId, message, displayMessage)
            if (!result.success || !result.streamChannel) {
              throw new Error(result.error || 'Failed to send prompt after conflict recovery')
            }
          } else {
            throw new Error(result.error || 'Failed to send prompt')
          }
        }

        console.log('[useLocalAgent] Subscribed to stream channel:', result.streamChannel)

        subscribeToStream(sessionId, result.streamChannel)
      } catch (error) {
        const rawErrorMsg = error instanceof Error ? error.message : String(error)
        const errorMsg = normalizeAgentErrorMessage(rawErrorMsg, options.provider)
        console.error('[useLocalAgent] Error:', errorMsg)
        setState((prev) => ({
          ...prev,
          isRunning: false,
          error: errorMsg,
        }))
        onErrorRef.current?.(errorMsg, {
          runtimeSessionId: sessionIdRef.current,
        })
      }
    },
    [createSession, subscribeToStream]
  )

  // Stop the current prompt (explicit user action)
  const stop = useCallback(async () => {
    if (sessionIdRef.current) {
      console.log('[useLocalAgent] Interrupting session:', sessionIdRef.current)
      await aiAgent.interrupt(sessionIdRef.current)
      setState((prev) => ({ ...prev, isRunning: false }))
    }
  }, [])

  // Detach the active tab from the current session without touching live background subscriptions.
  // Used for session switching - the selected tab changes, but other running sessions keep streaming.
  const detach = useCallback(async () => {
    console.log('[useLocalAgent] Detached from session:', sessionIdRef.current)
    sessionIdRef.current = null

    setState((prev) => ({
      ...prev,
      isConnected: false,
      isRunning: false,
      sessionId: null,
    }))
  }, [])

  // Reconnect to a specific background session by session ID
  // Used when switching back to a session tab that was previously detached
  const reconnectToSession = useCallback(
    async (sessionId: string, afterSeq?: number): Promise<ReconnectResult> => {
      try {
        console.log('[useLocalAgent] reconnectToSession called for:', sessionId)
        const result = await aiAgent.getBackgroundSessionById(sessionId)
        const bgSession = result.session

        if (!result.success || !bgSession || bgSession.status !== 'running') {
          console.log('[useLocalAgent] Session not running or not found', {
            sessionId,
            success: result.success,
            status: bgSession?.status || null,
          })
          return { attached: false, canonicalSessionId: null }
        }

        const canonicalSessionId = bgSession.sessionId
        sessionIdRef.current = canonicalSessionId
        setState((prev) => ({ ...prev, sessionId: canonicalSessionId, isRunning: true }))

        console.log('[useLocalAgent] tab-reconnect: attaching to session', {
          requestedSessionId: sessionId,
          canonicalSessionId,
          streamChannel: bgSession.streamChannel || null,
        })

        const attached = await reconnectToRunningSession(canonicalSessionId, { afterSeq })
        return {
          attached,
          canonicalSessionId,
        }
      } catch (error) {
        console.error('[useLocalAgent] Failed to reconnect to session:', error)
        return { attached: false, canonicalSessionId: null }
      }
    },
    [reconnectToRunningSession]
  )

  const watchSession = useCallback(
    async (sessionId: string, afterSeq?: number): Promise<boolean> => {
      try {
        console.log('[useLocalAgent] watchSession called for:', sessionId)
        return await reconnectToRunningSession(sessionId, { afterSeq })
      } catch (error) {
        console.error('[useLocalAgent] Failed to watch session:', error)
        return false
      }
    },
    [reconnectToRunningSession]
  )

  const terminateSession = useCallback(
    async (sessionId: string) => {
      console.log('[useLocalAgent] Terminating explicit session:', sessionId)
      unsubscribeFromSession(sessionId)
      await aiAgent.terminateSession(sessionId)
      if (sessionIdRef.current === sessionId) {
        sessionIdRef.current = null
        setState({
          isConnected: false,
          isRunning: false,
          sessionId: null,
          error: null,
          messages: [],
        })
      }
    },
    [unsubscribeFromSession]
  )

  // Terminate the session (explicit user action)
  const terminate = useCallback(async () => {
    if (sessionIdRef.current) {
      await terminateSession(sessionIdRef.current)
    }

    setState({
      isConnected: false,
      isRunning: false,
      sessionId: null,
      error: null,
      messages: [],
    })
  }, [terminateSession])

  // Get available providers
  const getProviders = useCallback(async () => {
    return aiAgent.getProviders()
  }, [])

  return {
    ...state,
    checkAuthentication,
    sendPrompt,
    stop,
    detach,
    terminate,
    getProviders,
    reconnectToSession,
    watchSession,
    terminateSession,
  }
}
