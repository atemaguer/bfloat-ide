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
import type { AgentMessage, SessionOptions, ProviderId, AgentTool } from '@/lib/conveyor/api/ai-agent-api'

// Tools to disable - AskUserQuestion requires special UI handling that isn't fully reliable yet
const DISALLOWED_TOOLS = ['AskUserQuestion']

interface LocalAgentState {
  isConnected: boolean
  isRunning: boolean
  sessionId: string | null
  error: string | null
  messages: AgentMessage[]
}

type PermissionMode = 'default' | 'plan' | 'bypassPermissions' | 'delegate' | 'dontAsk'

interface UseLocalAgentOptions {
  cwd: string
  provider?: ProviderId
  model?: string
  systemPrompt?: string // Custom system prompt for exploration
  permissionMode?: PermissionMode // Permission mode for the session
  disallowedTools?: string[] // Tools to disable
  allowedTools?: AgentTool[] // Tools to allow
  resumeSessionId?: string | null // Session ID to resume from
  projectId?: string // Project ID for background session tracking
  maxTurns?: number // Maximum agentic turns (prevents infinite loops)
  agents?: Record<string, import('@/lib/agents/types').AgentDefinition> // Agent/subagent definitions for team orchestration
  onMessage?: (message: AgentMessage) => void
  onError?: (error: string) => void
  onComplete?: () => void
  onSessionId?: (sessionId: string) => void // Called when we get a session ID from init
}

export function useLocalAgent(options: UseLocalAgentOptions) {
  const [state, setState] = useState<LocalAgentState>({
    isConnected: false,
    isRunning: false,
    sessionId: null,
    error: null,
    messages: [],
  })

  const unsubscribeRef = useRef<(() => void) | null>(null)
  /** Monotonically incrementing counter used to detect and discard stale subscription callbacks */
  const activeSubscriptionIdRef = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
  const cwdRef = useRef<string>(options.cwd)
  const hasReconnected = useRef(false)
  /** Per-session last seen seq number for deduplication on reconnect */
  const lastSeqBySessionRef = useRef<Map<string, number>>(new Map())

  // Callback refs — keep options callbacks fresh without destabilising subscribeToStream
  const onMessageRef = useRef(options.onMessage)
  const onCompleteRef = useRef(options.onComplete)
  const onSessionIdRef = useRef(options.onSessionId)
  const onErrorRef = useRef(options.onError)

  useEffect(() => {
    onMessageRef.current = options.onMessage
    onCompleteRef.current = options.onComplete
    onSessionIdRef.current = options.onSessionId
    onErrorRef.current = options.onError
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
    (agentMsg: AgentMessage) => {
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, agentMsg],
      }))

      onMessageRef.current?.(agentMsg)

      // Handle init message - extract and report session ID
      if (agentMsg.type === 'init') {
        const initContent = agentMsg.content as { sessionId: string }
        console.log('[useLocalAgent] ========================================')
        console.log('[useLocalAgent] INIT MESSAGE RECEIVED')
        console.log('[useLocalAgent] Session ID:', initContent.sessionId || '(empty)')
        console.log('[useLocalAgent] Has onSessionId callback:', !!onSessionIdRef.current)
        console.log('[useLocalAgent] ========================================')
        if (initContent.sessionId) {
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
        setState((prev) => ({ ...prev, error: errorContent.message }))
        onErrorRef.current?.(errorContent.message)
      }

      // Handle completion
      if (agentMsg.type === 'done') {
        setState((prev) => ({ ...prev, isRunning: false }))
        onCompleteRef.current?.()
      }
    },
    []
  )

  /**
   * Replay buffered messages from the background registry that were missed
   * while the renderer was detached (e.g. user switched session tabs).
   */
  const replayBufferedMessages = useCallback(
    async (sessionId: string) => {
      try {
        const afterSeq = getLastSeq(sessionId)
        console.log('[useLocalAgent] Replaying buffered messages', { sessionId, afterSeq })
        const replay = await window.conveyor.aiAgent.getBackgroundMessages(sessionId, afterSeq)
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
          handleAgentMessage(msg)
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
      activeSubscriptionIdRef.current += 1
      const subscriptionId = activeSubscriptionIdRef.current
      console.log('[useLocalAgent] Subscribing to stream', { sessionId, streamChannel, subscriptionId })

      // Unsubscribe any previous listener before attaching the new one
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }

      unsubscribeRef.current = window.conveyor.aiAgent.onStreamMessage(
        streamChannel,
        (msg) => {
          console.log('[useLocalAgent] Stream message received:', msg.type)

          // Discard events from stale subscriptions that raced with tab/session switches
          if (subscriptionId !== activeSubscriptionIdRef.current) {
            console.log('[useLocalAgent] Ignoring stale subscription event', {
              sessionId,
              subscriptionId,
              activeSubscriptionId: activeSubscriptionIdRef.current,
              type: msg.type,
            })
            return
          }

          if (msg.type === 'stream_end') {
            console.log('[useLocalAgent] Stream ended', { sessionId, streamChannel })
            setState((prev) => ({ ...prev, isRunning: false }))
            onCompleteRef.current?.()
            return
          }

          const agentMsg = msg as AgentMessage
          if (!shouldProcessMessage(sessionId, agentMsg)) return
          updateLastSeq(sessionId, agentMsg)
          handleAgentMessage(agentMsg)
        }
      )
    },
    [handleAgentMessage, shouldProcessMessage, updateLastSeq]
  )

  /**
   * Attempt to attach to a running background session. Polls briefly for the
   * stream channel to be published (it is set in a setImmediate on the main
   * process side, so it may not be available immediately after prompt() returns).
   */
  const reconnectToRunningSession = useCallback(
    async (sessionId: string, maxAttempts = 8, delayMs = 200): Promise<boolean> => {
      console.log('[useLocalAgent] Attempting to reconnect to running session', { sessionId, maxAttempts, delayMs })
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await window.conveyor.aiAgent.getBackgroundSessionById(sessionId)
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
        await replayBufferedMessages(sessionId)
        console.log('[useLocalAgent] Successfully reconnected to session', { sessionId, streamChannel: bgSession.streamChannel })
        return true
      }

      console.warn('[useLocalAgent] Failed to reconnect after max attempts', { sessionId, maxAttempts })
      return false
    },
    [replayBufferedMessages, subscribeToStream]
  )

  // Cleanup on unmount - only unsubscribe from stream, do NOT terminate the session.
  // The agent continues running in the background via the main process.
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        // Invalidate the subscription ID so any in-flight callbacks are discarded
        activeSubscriptionIdRef.current += 1
      }
      // NOTE: We intentionally do NOT terminate the session here.
      // The session continues running in the background and can be
      // reconnected to when the user returns to the project page.
      console.log('[useLocalAgent] Unmounting - detaching from session:', sessionIdRef.current)
    }
  }, [])

  // Reconnect to a background session on mount (if one exists for this project)
  useEffect(() => {
    if (!options.projectId || hasReconnected.current) return
    hasReconnected.current = true

    const reconnect = async () => {
      try {
        console.log('[useLocalAgent] Checking for background session for project:', options.projectId)
        const result = await window.conveyor.aiAgent.getBackgroundSession(options.projectId!)

        if (!result.success || !result.session) {
          console.log('[useLocalAgent] No background session found')
          return
        }

        const bgSession = result.session
        console.log('[useLocalAgent] Found background session:', {
          sessionId: bgSession.sessionId,
          status: bgSession.status,
          streamChannel: bgSession.streamChannel,
        })

        // Set the session ID so future prompts use the same session
        sessionIdRef.current = bgSession.sessionId
        setState((prev) => ({
          ...prev,
          sessionId: bgSession.sessionId,
        }))

        // NOTE: We do NOT replay buffered messages here for the mount-reconnect path.
        // Past messages are loaded by Chat.tsx via the existing CLI session
        // reading mechanism (readSession). We only handle streaming state
        // and live stream subscription for ongoing sessions.

        if (bgSession.status === 'running') {
          setState((prev) => ({ ...prev, isRunning: true }))
          const attached = await reconnectToRunningSession(bgSession.sessionId)
          if (!attached) {
            // Keep session selected even if currently unattached
            setState((prev) => ({ ...prev, isRunning: false }))
            console.log('[useLocalAgent] Could not attach to running session on mount', { sessionId: bgSession.sessionId })
          }
        } else if (bgSession.status === 'completed') {
          // Session completed while user was away
          console.log('[useLocalAgent] Background session already completed')
          onCompleteRef.current?.()

          // Clean up the completed background session
          window.conveyor.aiAgent.unregisterBackgroundSession(bgSession.sessionId)
        } else if (bgSession.status === 'error') {
          // Session errored while user was away
          console.log('[useLocalAgent] Background session errored')
          onErrorRef.current?.('Agent session encountered an error while running in the background')

          // Clean up the errored background session
          window.conveyor.aiAgent.unregisterBackgroundSession(bgSession.sessionId)
        }
      } catch (error) {
        console.error('[useLocalAgent] Failed to reconnect to background session:', error)
      }
    }

    reconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.projectId, reconnectToRunningSession])

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
      window.conveyor.aiAgent.terminateSession(sessionIdRef.current)
      sessionIdRef.current = null
      setState((prev) => ({ ...prev, sessionId: null }))
    }
    cwdRef.current = newCwd
  }, [options.cwd])

  // Check if provider is authenticated (CLI-based)
  const checkAuthentication = useCallback(async (providerId: ProviderId = 'claude') => {
    try {
      const isAuth = await window.conveyor.aiAgent.isAuthenticated(providerId)
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

    // Get any pending environment variables (e.g., Apple credentials for iOS deployment)
    const pendingEnvVars = workbenchStore.takePendingEnvVars()

    // Build session options - only include properties that are defined
    const sessionOptions: SessionOptions = {
      cwd: options.cwd,
      permissionMode: options.permissionMode || 'bypassPermissions',
      disallowedTools: options.disallowedTools || DISALLOWED_TOOLS,
    }

    if (options.provider) sessionOptions.provider = options.provider
    if (options.model) sessionOptions.model = options.model
    if (options.systemPrompt) sessionOptions.systemPrompt = options.systemPrompt
    if (options.resumeSessionId) sessionOptions.resumeSessionId = options.resumeSessionId
    if (options.allowedTools) sessionOptions.allowedTools = options.allowedTools
    if (pendingEnvVars) sessionOptions.env = pendingEnvVars
    if (options.projectId) sessionOptions.projectId = options.projectId
    sessionOptions.maxTurns = options.maxTurns || 50
    if (options.agents) sessionOptions.agents = options.agents

    console.log('[useLocalAgent] ========================================')
    if (pendingEnvVars) {
      console.log('[useLocalAgent] Pending env vars:', Object.keys(pendingEnvVars))
      console.log('[useLocalAgent] Env var values (sanitized):', Object.fromEntries(
        Object.entries(pendingEnvVars).map(([k, v]) => [k, k.includes('PASSWORD') || k.includes('SECRET') ? '***' : v])
      ))
    } else {
      console.log('[useLocalAgent] No pending env vars')
    }
    console.log('[useLocalAgent] ' + (options.resumeSessionId ? 'RESUMING SESSION' : 'CREATING NEW SESSION'))
    console.log('[useLocalAgent] CWD:', options.cwd)
    console.log('[useLocalAgent] Provider:', options.provider || 'default')
    console.log('[useLocalAgent] Model:', options.model || 'default')
    console.log('[useLocalAgent] Project ID:', options.projectId || 'none')
    console.log('[useLocalAgent] sessionOptions.env keys:', sessionOptions.env ? Object.keys(sessionOptions.env) : 'none')
    if (options.resumeSessionId) {
      console.log('[useLocalAgent] Resume Session ID:', options.resumeSessionId)
    }
    console.log('[useLocalAgent] ========================================')
    const result = await window.conveyor.aiAgent.createSession(sessionOptions)

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

    return result.sessionId
  }, [options.cwd, options.provider, options.model, options.systemPrompt, options.resumeSessionId, options.projectId])

  // Send a prompt to the agent
  const sendPrompt = useCallback(
    async (message: string) => {
      console.log('[useLocalAgent] sendPrompt called with:', message)
      try {
        setState((prev) => ({ ...prev, isRunning: true, error: null, messages: [] }))

        // Create session if not exists OR if there are pending env vars
        // Pending env vars (e.g., Apple credentials for iOS deployment) require a new session
        let sessionId = sessionIdRef.current
        const hasPendingEnvVars = workbenchStore.hasPendingEnvVars()

        console.log('[useLocalAgent] Has pending env vars:', hasPendingEnvVars)

        if (!sessionId || hasPendingEnvVars) {
          if (hasPendingEnvVars && sessionId) {
            console.log('[useLocalAgent] Creating new session to pick up pending env vars')
          }
          sessionId = await createSession()
        }

        console.log('[useLocalAgent] Sending prompt to session:', sessionId)
        console.log('[useLocalAgent] Prompt message:', message)
        const result = await window.conveyor.aiAgent.prompt(sessionId, message)

        if (!result.success || !result.streamChannel) {
          throw new Error(result.error || 'Failed to send prompt')
        }

        console.log('[useLocalAgent] Subscribed to stream channel:', result.streamChannel)

        subscribeToStream(sessionId, result.streamChannel)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error('[useLocalAgent] Error:', errorMsg)
        setState((prev) => ({
          ...prev,
          isRunning: false,
          error: errorMsg,
        }))
        onErrorRef.current?.(errorMsg)
      }
    },
    [createSession, subscribeToStream]
  )

  // Stop the current prompt (explicit user action)
  const stop = useCallback(async () => {
    if (sessionIdRef.current) {
      console.log('[useLocalAgent] Interrupting session:', sessionIdRef.current)
      await window.conveyor.aiAgent.interrupt(sessionIdRef.current)
      setState((prev) => ({ ...prev, isRunning: false }))
    }
  }, [])

  // Detach from the current session (unsubscribe from stream but keep session running)
  // Used for session switching - the session continues in background
  const detach = useCallback(async () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
      activeSubscriptionIdRef.current += 1
    }

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
    async (sessionId: string): Promise<boolean> => {
      try {
        console.log('[useLocalAgent] reconnectToSession called for:', sessionId)
        const result = await window.conveyor.aiAgent.getBackgroundSessionById(sessionId)
        const bgSession = result.session

        if (!result.success || !bgSession || bgSession.status !== 'running') {
          console.log('[useLocalAgent] Session not running or not found', {
            sessionId,
            success: result.success,
            status: bgSession?.status || null,
          })
          return false
        }

        const canonicalSessionId = bgSession.sessionId
        sessionIdRef.current = canonicalSessionId
        setState((prev) => ({ ...prev, sessionId: canonicalSessionId, isRunning: true }))

        console.log('[useLocalAgent] tab-reconnect: attaching to session', {
          requestedSessionId: sessionId,
          canonicalSessionId,
          streamChannel: bgSession.streamChannel || null,
        })

        return reconnectToRunningSession(canonicalSessionId)
      } catch (error) {
        console.error('[useLocalAgent] Failed to reconnect to session:', error)
        return false
      }
    },
    [reconnectToRunningSession]
  )

  // Terminate the session (explicit user action)
  const terminate = useCallback(async () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
      activeSubscriptionIdRef.current += 1
    }

    if (sessionIdRef.current) {
      console.log('[useLocalAgent] Terminating session:', sessionIdRef.current)
      await window.conveyor.aiAgent.terminateSession(sessionIdRef.current)
      sessionIdRef.current = null
    }

    setState({
      isConnected: false,
      isRunning: false,
      sessionId: null,
      error: null,
      messages: [],
    })
  }, [])

  // Get available providers
  const getProviders = useCallback(async () => {
    return window.conveyor.aiAgent.getProviders()
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
  }
}
