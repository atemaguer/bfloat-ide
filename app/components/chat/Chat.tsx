/**
 * Chat Component
 *
 * Uses local AI agent interface (Claude Code / Codex CLI) for code generation.
 * All AI operations run locally through the CLI tools.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { generateId } from 'ai'

import { workbenchStore, type PendingIntegrationId } from '@/app/stores/workbench'
import type { ChatMessage, MessagePart } from '@/app/types/project'
import { useLocalAgent } from '@/app/hooks/useLocalAgent'
import { useSessions, useSaveSession, useDeleteSession, useUpdateSession } from '@/app/hooks/useSessions'
import { getSystemPrompt } from '@/lib/launch/system-prompt'
import { aiAgent, projectFiles, secrets } from '@/app/api/sidecar'
import type { ProviderId, SessionMessageData } from '@/lib/conveyor/schemas/ai-agent-schema'
import { projectStore } from '@/app/stores/project-store'
import { Messages } from './Messages'
import { ChatInput, type ImageAttachment } from './ChatInput'
import { ErrorMessage } from './ErrorMessage'
import { isClaudeAuthError } from './ClaudeAuthBanner'
import type { ConvexIntentMode } from './ConvexIntentBanner'
import { ProviderAuthModal } from '@/app/components/integrations/ProviderAuthModal'
import { TaskProgress, type TodoItem } from './TaskProgress'
import { SuggestionChips } from './SuggestionChips'
import { generateSuggestions } from './generateSuggestions'
import { SessionTabs } from './SessionTabs'
import {
  providerAuthStore,
  providerTypeToAgentProviderId,
  DEFAULT_MODEL_BY_AGENT_PROVIDER,
} from '@/app/stores/provider-auth'
import ConvexLogo from '@/app/components/ui/icons/convex-logo'
import FirebaseLogo from '@/app/components/ui/icons/firebase-logo'
import RevenueCatLogo from '@/app/components/ui/icons/revenuecat-logo'
import StripeLogo from '@/app/components/ui/icons/stripe-logo'
import { isIntegrationAvailableForAppType, type IntegrationId } from '@/app/types/integrations'
import { detectIntegrationSecretsPresence, type IntegrationSecretsPresence } from '@/app/lib/integrations/secrets'
import {
  detectConvexBootstrap,
  detectConvexBootstrapInTree,
  getConvexEnvVarsForSession,
  getConvexSecretStatusFromSecrets,
  type ConvexIntegrationStage,
  type SecretEntry,
} from '@/app/lib/integrations/convex'
import toast from 'react-hot-toast'
import { showErrorToast } from '@/app/components/ui/ErrorToast'
import { sessionContainsSetupPrompt, type IntegrationSetupPromptType } from './integrationSetupPolicy'
import {
  applyAgentMessageToTranscript,
  hydrateTranscriptFromHistory,
  type SessionHistoryEntry,
} from './session-transcript'
import {
  DRAFT_SESSION_KEY,
  createSessionViewState,
  projectSessionsStore,
  type ProjectSessionViewState,
} from '@/app/stores/project-sessions'
import './styles.css'

const FRONTEND_DESIGN_SKILL_PREFIX =
  'Use the /frontend-design skill for this request. If the project has an established design system, preserve it and adapt within it.'
const FIREBASE_SETUP_PROMPT = 'Use the /add-firebase skill to set up Firebase for this project'
const CONVEX_SETUP_PROMPT = 'Use the /convex-setup skill to set up Convex backend integration for this project'
const CONVEX_AUTH_PROMPT = 'Use the /convex-auth skill to set up Convex Better Auth (email/password) for this project'

const SETUP_PROMPT_BY_INTEGRATION: Record<string, IntegrationSetupPromptType> = {
  firebase: 'firebase-setup-prompt',
  convex: 'convex-setup-prompt',
  stripe: 'stripe-setup-prompt',
  revenuecat: 'revenuecat-setup-prompt',
}

function appendSetupPromptIfMissing(
  messages: ChatMessage[],
  promptType: IntegrationSetupPromptType,
  metadata?: {
    integrationId?: string
    originalPrompt?: string
    forceFrontendDesignSkill?: boolean
  }
): ChatMessage[] {
  if (sessionContainsSetupPrompt(messages, promptType)) {
    return messages
  }

  const guidanceMessage: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: '',
    parts: [{ type: promptType, ...metadata } as MessagePart],
    createdAt: new Date().toISOString(),
  }

  return [...messages, guidanceMessage]
}

function extractCommitDraftFromMessage(message: ChatMessage): string | null {
  const content = (message.content || '').trim()
  if (content) {
    const firstLine = content
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
    return firstLine || null
  }

  for (const part of message.parts || []) {
    if (part?.type === 'text') {
      const text = (part.text || '').trim()
      if (!text) continue
      const firstLine = text
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean)
      if (firstLine) return firstLine
    }
  }

  return null
}

function withFrontendDesignSkillPrompt(prompt: string): string {
  if (/\b\/frontend-design\b/i.test(prompt)) {
    return prompt
  }
  return `${FRONTEND_DESIGN_SKILL_PREFIX}\n\n${prompt}`
}

// Image data passed from HomePage via navigation state
interface InitialImageData {
  filename: string
  base64: string
  type: string
}

// Session info from CLI storage discovery
interface LocalSessionInfo {
  sessionId: string
  runtimeSessionId?: string | null
  providerSessionId?: string | null
  createdAt: number
  lastModified: number
  name?: string
  provider?: 'claude' | 'codex'
}

interface ChatProps {
  projectId: string
  initialMessages: ChatMessage[]
  initialImages?: InitialImageData[] // Images attached during project creation
  projectPath?: string | null
  isWorkspaceReady?: boolean // Whether the workspace (git clone + files) is ready - for progressive loading
  initialProvider?: ProviderId
  initialModel?: string // AI model selected during project creation
  autoStart?: boolean // Whether to auto-start the AI on first message (only for new projects)
  initialSessionId?: string | null // Session ID to resume from (for existing projects)
  onSessionIdChange?: (sessionId: string, provider: 'claude' | 'codex') => void // Callback when session ID changes
  projectHasConvex?: boolean // Whether Convex is already provisioned on this project
  projectHasFirebase?: boolean // Whether Firebase is already provisioned on this project
  projectHasStripe?: boolean // Whether Stripe is already provisioned on this project
  projectHasRevenuecat?: boolean // Whether RevenueCat is already provisioned on this project
  appType?: string | null // Project app type (web, mobile, expo, nextjs, vite, etc.)
}

export function Chat({
  projectId,
  initialMessages,
  initialImages,
  projectPath,
  isWorkspaceReady = true,
  initialProvider,
  initialModel,
  autoStart = false,
  initialSessionId,
  onSessionIdChange,
  projectHasFirebase = false,
  projectHasStripe = false,
  projectHasRevenuecat = false,
  appType,
}: ChatProps) {
  // Codex (OpenAI) provider is enabled by default
  const codexBetaEnabled = true
  const providerSettings = useStore(providerAuthStore.settings)
  const defaultProvider = providerTypeToAgentProviderId(providerSettings.defaultProvider)

  // Normalize appType to 'web' or 'mobile' for integration filtering
  const normalizedAppType: 'web' | 'mobile' = useMemo(() => {
    const rawType = appType || 'mobile'
    return rawType === 'nextjs' || rawType === 'vite' || rawType === 'node' || rawType === 'web' ? 'web' : 'mobile'
  }, [appType])
  const usableProjectPath = useMemo(() => {
    if (!projectPath) return null

    const normalizedPath = projectPath.replace(/\\/g, '/')
    const matchesProject =
      normalizedPath.includes(`/projects/${projectId}`) ||
      normalizedPath.endsWith(`/${projectId}`) ||
      normalizedPath.endsWith(projectId)

    if (!matchesProject) return null
    return projectPath
  }, [projectId, projectPath])

  // For local-first mode, session data is stored locally by CLI tools
  // No backend fetch needed - just use the provided session ID
  const resolvedInitialSessionId = initialSessionId ?? null
  const isNewProjectAtMount = useRef(autoStart && resolvedInitialSessionId === null)
  const forcedFrontendDesignSessionIdRef = useRef<string | null>(null)

  // State
  const [input, setInput] = useState('')
  // The selected transcript tab can differ from the currently attached live sidecar session.
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [provider, setProvider] = useState<ProviderId>(initialProvider || defaultProvider)
  const [selectedModel, setSelectedModel] = useState<string>(
    initialModel || DEFAULT_MODEL_BY_AGENT_PROVIDER[initialProvider || defaultProvider]
  )
  const [showReconnectNotice, setShowReconnectNotice] = useState(false)
  const [isProvisioning, setIsProvisioning] = useState(false)
  const [convexProvisioned, setConvexProvisioned] = useState(false)
  const [firebaseProvisioned, setFirebaseProvisioned] = useState(false)
  const [revenuecatProvisioned, setRevenuecatProvisioned] = useState(false)
  const [isFirebaseSettingUp, setIsFirebaseSettingUp] = useState(false)
  const [isStripeSettingUp, setIsStripeSettingUp] = useState(false)
  const [isRevenueCatSettingUp, setIsRevenueCatSettingUp] = useState(false)
  const [pendingConvexAuthAfterSetup, setPendingConvexAuthAfterSetup] = useState(false)
  const hasStartedInitialStream = useRef(false)
  const hasLoadedSession = useRef(false)
  // Capture the initial session ID at mount time - only this one should be loaded
  // Any session IDs received during streaming (current session) should NOT trigger a load
  const initialSessionIdAtMount = useRef(resolvedInitialSessionId)
  const suppressInitialSessionRestore = useRef(false)
  const usageRef = useRef<{ inputTokens: number; outputTokens: number }>({ inputTokens: 0, outputTokens: 0 })
  const submitRef = useRef<
    ((text: string, attachments?: ImageAttachment[], options?: { hideUserMessage?: boolean }) => void) | null
  >(null)
  const providerRef = useRef<ProviderId>(initialProvider || defaultProvider)
  const reconnectToSessionRef = useRef<
    ((sessionId: string, afterSeq?: number) => Promise<{ attached: boolean; canonicalSessionId: string | null }>) | null
  >(null)
  const selectedSessionStore = useMemo(
    () =>
      projectSessionsStore.getSelectedSessionStore(
        projectId,
        initialProvider || defaultProvider,
        initialMessages || []
      ),
    [defaultProvider, initialMessages, initialProvider, projectId]
  )
  const sessionStatesStore = useMemo(
    () =>
      projectSessionsStore.getSessionStatesStore(projectId, initialProvider || defaultProvider, initialMessages || []),
    [defaultProvider, initialMessages, initialProvider, projectId]
  )
  const selectedSessionId = useStore(selectedSessionStore)
  const sessionViewStates = useStore(sessionStatesStore)
  const sessionViewStatesRef = useRef(sessionViewStates)
  const setSelectedSessionId = useCallback(
    (sessionId: string | null) => {
      projectSessionsStore.setSelectedSessionId(
        projectId,
        sessionId,
        initialProvider || defaultProvider,
        initialMessages || []
      )
    },
    [defaultProvider, initialMessages, initialProvider, projectId]
  )
  const activeStreamSessionKeyRef = useRef<string>(resolvedInitialSessionId || DRAFT_SESSION_KEY)
  const messagesRef = useRef<ChatMessage[]>(initialMessages || [])
  const [providerAuthStatus, setProviderAuthStatus] = useState<Record<string, boolean>>({})
  // Track if Claude auth modal should be shown
  const [showClaudeAuthModal, setShowClaudeAuthModal] = useState(false)
  // Track which integrations have their required secrets already configured
  const [hasIntegrationSecrets, setHasIntegrationSecrets] = useState<IntegrationSecretsPresence>({
    firebase: false,
    convex: false,
    stripe: false,
    revenuecat: false,
  })
  const [projectSecrets, setProjectSecrets] = useState<SecretEntry[]>([])
  const activePendingPromptIdRef = useRef<string | null>(null)
  const pendingSessionPromotionRef = useRef<{ stableSessionId: string; provider: ProviderId } | null>(null)
  const suppressedCompletionGateRuntimeIdsRef = useRef<Set<string>>(new Set())
  // Flag to prevent session restoration effects from undoing explicit new-session actions
  const didStartNewSession = useRef(false)
  const shouldPreserveInitialUserMessage = useCallback(
    (sessionIdToLoad: string | null | undefined) => {
      if (!sessionIdToLoad || initialMessages.length === 0 || initialMessages[0]?.role !== 'user') {
        console.log('[Chat] shouldPreserveInitialUserMessage -> false (no eligible initial user message)', {
          sessionIdToLoad,
          initialMessagesCount: initialMessages.length,
          firstInitialRole: initialMessages[0]?.role ?? null,
        })
        return false
      }

      let shouldPreserve = false
      if (initialSessionIdAtMount.current) {
        shouldPreserve = sessionIdToLoad === initialSessionIdAtMount.current
      } else if (forcedFrontendDesignSessionIdRef.current) {
        shouldPreserve = sessionIdToLoad === forcedFrontendDesignSessionIdRef.current
      }

      console.log('[Chat] shouldPreserveInitialUserMessage decision', {
        sessionIdToLoad,
        shouldPreserve,
        initialSessionIdAtMount: initialSessionIdAtMount.current,
        forcedFrontendDesignSessionId: forcedFrontendDesignSessionIdRef.current,
        initialMessagesCount: initialMessages.length,
      })

      return shouldPreserve
    },
    [initialMessages]
  )
  const files = useStore(workbenchStore.files)
  const projectFileTree = useStore(projectStore.fileTreeArray)
  const convexSecretStatus = useMemo(
    () => getConvexSecretStatusFromSecrets(projectSecrets, normalizedAppType),
    [projectSecrets, normalizedAppType]
  )
  const convexBootstrapDetected = useMemo(
    () => detectConvexBootstrap(files) || detectConvexBootstrapInTree(projectFileTree),
    [files, projectFileTree]
  )

  useEffect(() => {
    if (!initialProvider) {
      setProvider(defaultProvider)
      setSelectedModel((current) => current || DEFAULT_MODEL_BY_AGENT_PROVIDER[defaultProvider])
    }
  }, [defaultProvider, initialProvider])

  const convexStage: ConvexIntegrationStage = useMemo(() => {
    if (!convexSecretStatus.isConfigured) return 'disconnected'
    if (convexBootstrapDetected) return 'ready'
    if (convexProvisioned) return 'setting_up'
    return 'connected'
  }, [convexSecretStatus.isConfigured, convexBootstrapDetected, convexProvisioned])

  // Clear in-progress flag once Convex bootstrap artifacts are present.
  useEffect(() => {
    if (convexProvisioned && convexBootstrapDetected) {
      setConvexProvisioned(false)
    }
  }, [convexProvisioned, convexBootstrapDetected])

  const integrationStatus = useMemo(
    () => ({
      firebase: projectHasFirebase || firebaseProvisioned || hasIntegrationSecrets.firebase,
      convex: convexStage === 'ready',
      stripe: projectHasStripe || hasIntegrationSecrets.stripe,
      revenuecat: projectHasRevenuecat || revenuecatProvisioned || hasIntegrationSecrets.revenuecat,
    }),
    [
      projectHasFirebase,
      firebaseProvisioned,
      hasIntegrationSecrets.firebase,
      convexStage,
      projectHasStripe,
      hasIntegrationSecrets.stripe,
      projectHasRevenuecat,
      revenuecatProvisioned,
      hasIntegrationSecrets.revenuecat,
    ]
  )

  const activeSessionKey = selectedSessionId ?? DRAFT_SESSION_KEY
  const activeSessionView = sessionViewStates[activeSessionKey] ?? createSessionViewState(provider)
  const messages = activeSessionView.messages
  const isStreaming = activeSessionView.status === 'running'
  const isResumingSession = activeSessionView.isResumingSession
  const isLoadingSession = activeSessionView.isLoadingSession
  const error = activeSessionView.error
  const agentSessionId = activeSessionView.runtimeSessionId
  const resumeProviderSessionId = activeSessionView.providerSessionId

  const updateSessionViewState = useCallback(
    (sessionKey: string, updater: (prev: ProjectSessionViewState) => ProjectSessionViewState) => {
      projectSessionsStore.updateSessionState(projectId, sessionKey, updater, provider, initialMessages || [])
    },
    [initialMessages, projectId, provider]
  )

  const updateActiveSessionViewState = useCallback(
    (updater: (prev: ProjectSessionViewState) => ProjectSessionViewState) => {
      updateSessionViewState(activeSessionKey, updater)
    },
    [activeSessionKey, updateSessionViewState]
  )

  const replaceSessionViewState = useCallback(
    (sessionKey: string, nextState: ProjectSessionViewState) => {
      projectSessionsStore.replaceSessionState(projectId, sessionKey, nextState, provider, initialMessages || [])
    },
    [initialMessages, projectId, provider]
  )

  const createHydratedSessionViewState = useCallback(
    (
      sessionProvider: ProviderId,
      messages: ChatMessage[],
      options?: {
        providerSessionId?: string | null
        runtimeSessionId?: string | null
        transcriptLastSeq?: number
        runtimeLastSeq?: number
        status?: ProjectSessionStatus
        isAttachedToTransport?: boolean
        isResumingSession?: boolean
        isLoadingSession?: boolean
        error?: string | null
      }
    ): ProjectSessionViewState => {
      const now = Date.now()
      return {
        messages,
        status: options?.status ?? 'completed',
        isAttachedToTransport: options?.isAttachedToTransport ?? false,
        isHydrated: true,
        lastHydratedAt: now,
        lastRuntimeSeenAt: options?.runtimeSessionId ? now : null,
        needsRefresh: false,
        isLoadingSession: options?.isLoadingSession ?? false,
        isResumingSession: options?.isResumingSession ?? false,
        runtimeSessionId: options?.runtimeSessionId ?? null,
        providerSessionId: options?.providerSessionId ?? null,
        provider: sessionProvider,
        transcriptLastSeq: options?.transcriptLastSeq ?? 0,
        runtimeLastSeq: options?.runtimeLastSeq ?? 0,
        error: options?.error ?? null,
      }
    },
    []
  )

  const moveSessionViewState = useCallback(
    (fromKey: string, toKey: string, apply?: (state: ProjectSessionViewState) => ProjectSessionViewState) => {
      projectSessionsStore.moveSessionState(projectId, fromKey, toKey, provider, apply, initialMessages || [])
    },
    [initialMessages, projectId, provider]
  )

  const setSessionMessages = useCallback(
    (sessionKey: string, updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        messages:
          typeof updater === 'function' ? (updater as (prev: ChatMessage[]) => ChatMessage[])(prev.messages) : updater,
        isHydrated: true,
        lastHydratedAt: Date.now(),
        needsRefresh: false,
      }))
    },
    [updateSessionViewState]
  )

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setSessionMessages(activeSessionKey, updater)
    },
    [activeSessionKey, setSessionMessages]
  )

  const setSessionStreaming = useCallback(
    (sessionKey: string, isStreamingValue: boolean) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        status: isStreamingValue ? 'running' : prev.error ? 'error' : 'completed',
        isAttachedToTransport: isStreamingValue,
        lastRuntimeSeenAt: isStreamingValue ? Date.now() : prev.lastRuntimeSeenAt,
      }))
    },
    [updateSessionViewState]
  )

  const setSessionTransportAttached = useCallback(
    (sessionKey: string, isAttachedToTransport: boolean) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        isAttachedToTransport,
      }))
    },
    [updateSessionViewState]
  )

  const markSessionRuntimeActive = useCallback(
    (sessionKey: string, runtimeSessionId: string | null, isAttachedToTransport?: boolean) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        status: 'running',
        runtimeSessionId: runtimeSessionId ?? prev.runtimeSessionId,
        isAttachedToTransport: isAttachedToTransport ?? prev.isAttachedToTransport,
        lastRuntimeSeenAt: Date.now(),
        needsRefresh: false,
      }))
    },
    [updateSessionViewState]
  )

  const setIsStreaming = useCallback(
    (isStreamingValue: boolean) => {
      setSessionStreaming(activeSessionKey, isStreamingValue)
    },
    [activeSessionKey, setSessionStreaming]
  )

  const setSessionResuming = useCallback(
    (sessionKey: string, isResumingValue: boolean) => {
      updateSessionViewState(sessionKey, (prev) => ({ ...prev, isResumingSession: isResumingValue }))
    },
    [updateSessionViewState]
  )

  const setIsResumingSession = useCallback(
    (isResumingValue: boolean) => {
      setSessionResuming(activeSessionKey, isResumingValue)
    },
    [activeSessionKey, setSessionResuming]
  )

  const setSessionLoading = useCallback(
    (sessionKey: string, isLoadingValue: boolean) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        isLoadingSession: isLoadingValue,
        status: isLoadingValue ? 'hydrating' : prev.status === 'hydrating' ? 'idle' : prev.status,
      }))
    },
    [updateSessionViewState]
  )

  const setIsLoadingSession = useCallback(
    (isLoadingValue: boolean) => {
      setSessionLoading(activeSessionKey, isLoadingValue)
    },
    [activeSessionKey, setSessionLoading]
  )

  const setSessionError = useCallback(
    (sessionKey: string, errorValue: string | null) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        error: errorValue,
        status: errorValue ? 'error' : prev.status === 'error' ? 'idle' : prev.status,
      }))
    },
    [updateSessionViewState]
  )

  const setError = useCallback(
    (errorValue: string | null) => {
      setSessionError(activeSessionKey, errorValue)
    },
    [activeSessionKey, setSessionError]
  )

  const setSessionResumeProvider = useCallback(
    (sessionKey: string, providerSessionId: string | null) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        providerSessionId,
        needsRefresh: false,
      }))
    },
    [updateSessionViewState]
  )

  const setResumeProviderSessionId = useCallback(
    (providerSessionId: string | null) => {
      setSessionResumeProvider(activeSessionKey, providerSessionId)
    },
    [activeSessionKey, setSessionResumeProvider]
  )

  const setSessionRuntimeSessionId = useCallback(
    (sessionKey: string, runtimeSessionId: string | null) => {
      updateSessionViewState(sessionKey, (prev) => ({
        ...prev,
        runtimeSessionId,
        runtimeLastSeq: runtimeSessionId === prev.runtimeSessionId ? prev.runtimeLastSeq : 0,
        lastRuntimeSeenAt: runtimeSessionId ? Date.now() : prev.lastRuntimeSeenAt,
        needsRefresh: false,
      }))
    },
    [updateSessionViewState]
  )

  const setAgentSessionId = useCallback(
    (runtimeSessionId: string | null) => {
      setSessionRuntimeSessionId(activeSessionKey, runtimeSessionId)
    },
    [activeSessionKey, setSessionRuntimeSessionId]
  )

  const setSessionRuntimeLastSeq = useCallback(
    (sessionKey: string, runtimeLastSeq: number) => {
      updateSessionViewState(sessionKey, (prev) => ({ ...prev, runtimeLastSeq }))
    },
    [updateSessionViewState]
  )

  const getStoredSessionViewState = useCallback(
    (sessionKey: string) => {
      return projectSessionsStore.getSessionState(projectId, sessionKey, provider, initialMessages || [])
    },
    [initialMessages, projectId, provider]
  )

  // Keep messagesRef in sync
  useEffect(() => {
    sessionViewStatesRef.current = sessionViewStates
  }, [sessionViewStates])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    activeStreamSessionKeyRef.current = activeSessionKey
  }, [activeSessionKey])

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  useEffect(() => {
    return () => {
      console.log('[Chat] Marking project session cache as needing refresh on unmount', { projectId })
      projectSessionsStore.markProjectNeedsRefresh(projectId, providerRef.current)
    }
  }, [projectId])

  // API access (direct imports from sidecar)
  const aiAgentApi = aiAgent
  const localProjectsApi = null // Not used in this component

  // Session management hooks (local-first storage in projects.json)
  // Mirrors workbench pattern but reads from projects.json instead of backend API
  console.log('[Chat] Calling useSessions with projectId:', projectId)
  const {
    sessions: allSessions,
    hasLoadedOnce: hasLoadedSessionCatalog,
    refresh: refreshSessions,
  } = useSessions(projectId)
  const activeTab = useStore(workbenchStore.activeTab)
  const secretsVersion = useStore(workbenchStore.secretsVersion)
  const pendingIntegrationChoice = useStore(workbenchStore.pendingIntegrationChoice)

  // Debug: Log sessions when they change
  useEffect(() => {
    console.log(
      '[Chat] allSessions updated:',
      allSessions.length,
      'sessions',
      allSessions.map((s) => s.sessionId?.slice(0, 8))
    )
  }, [allSessions])

  const resolveStableSessionRecord = useCallback(
    (sessionId: string | null | undefined) => {
      if (!sessionId) return null

      const directMatch = allSessions.find((session) => session.sessionId === sessionId)
      if (directMatch) return directMatch

      return allSessions.find((session) => session.runtimeSessionId === sessionId) ?? null
    },
    [allSessions]
  )

  const resolveSessionIdentity = useCallback(
    (sessionId: string | null | undefined, fallbackProvider: ProviderId = provider) => {
      if (!sessionId) return null

      const stableSession = resolveStableSessionRecord(sessionId)
      const stableSessionId = stableSession?.sessionId ?? sessionId
      const runtimeSessionId = stableSession?.runtimeSessionId ?? null
      const resolved = {
        stableSession,
        stableSessionId,
        runtimeSessionId,
        provider: stableSession?.provider || fallbackProvider,
      }

      console.log('[Chat] Resolved session identity', {
        requestedSessionId: sessionId,
        stableSessionId: resolved.stableSessionId,
        runtimeSessionId: resolved.runtimeSessionId,
        provider: resolved.provider,
        matchedByRuntimeAlias: stableSession ? stableSession.sessionId !== sessionId : false,
      })

      return resolved
    },
    [provider, resolveStableSessionRecord]
  )

  const resolveCallbackTargetSessionKey = useCallback(
    (runtimeSessionId: string | null | undefined) => {
      const fallbackSessionKey = activeStreamSessionKeyRef.current || activeSessionKey
      if (!runtimeSessionId) {
        return fallbackSessionKey
      }

      const stableSession = resolveStableSessionRecord(runtimeSessionId)
      if (stableSession) {
        console.log('[Chat] Resolved callback target from persisted session metadata', {
          runtimeSessionId,
          stableSessionId: stableSession.sessionId,
        })
        return stableSession.sessionId
      }

      for (const [sessionKey, state] of Object.entries(sessionViewStatesRef.current)) {
        if (state.runtimeSessionId === runtimeSessionId) {
          console.log('[Chat] Resolved callback target from in-memory session state', {
            runtimeSessionId,
            stableSessionId: sessionKey,
          })
          return sessionKey
        }
      }

      console.log('[Chat] Falling back to active callback target for runtime session event', {
        runtimeSessionId,
        fallbackSessionKey,
      })
      return fallbackSessionKey
    },
    [activeSessionKey, resolveStableSessionRecord]
  )

  useEffect(() => {
    if (!hasLoadedSessionCatalog || !resolvedInitialSessionId || didStartNewSession.current || selectedSessionId) {
      return
    }

    console.log('[Chat] Syncing selected session from resolved initial session:', resolvedInitialSessionId)
    setSelectedSessionId(resolvedInitialSessionId)
  }, [hasLoadedSessionCatalog, resolvedInitialSessionId, selectedSessionId])

  // Auto-select the most recent session when sessions are loaded and no session is active
  // This prevents the "New Session" tab from appearing when loading an existing project
  useEffect(() => {
    // Skip if:
    // - No sessions loaded yet
    // - A session is already selected
    // - User intentionally started a new session
    // - Auto-start is pending (new project with initial messages)
    if (
      allSessions.length === 0 ||
      !hasLoadedSessionCatalog ||
      selectedSessionId !== null ||
      didStartNewSession.current ||
      (autoStart && !hasStartedInitialStream.current)
    ) {
      return
    }

    const firstSession = allSessions[0]
    if (firstSession) {
      console.log('[Chat] Auto-selecting first stable session:', firstSession.sessionId)
      setSelectedSessionId(firstSession.sessionId)
    }
  }, [allSessions, autoStart, hasLoadedSessionCatalog, selectedSessionId])

  // Memoize the onSuccess callback to prevent useSaveSession from recreating mutate on every render
  const onSaveSessionSuccess = useCallback(() => {
    // Refresh session list after save
    console.log('[Chat] Session saved, refreshing sessions list...')
    refreshSessions()
  }, [refreshSessions])

  const saveSessionMutation = useSaveSession(projectId, onSaveSessionSuccess)
  const deleteSessionMutation = useDeleteSession(projectId, () => {
    // Refresh session list after delete
    refreshSessions()
  })
  const updateSessionMutation = useUpdateSession(projectId)

  // Fetch provider authentication status
  useEffect(() => {
    aiAgentApi
      .getProviders()
      .then((providerList) => {
        const authStatus: Record<string, boolean> = {}
        for (const p of providerList) {
          authStatus[p.id] = p.isAuthenticated
        }
        setProviderAuthStatus(authStatus)
      })
      .catch((err) => {
        console.error('[Chat] Failed to fetch providers:', err)
      })
  }, [])

  // Check if integrations have their required secrets already configured
  useEffect(() => {
    if (!projectId) return

    secrets
      .readSecrets(projectId)
      .then((result) => {
        if (result.error || !result.secrets) return

        setProjectSecrets(result.secrets)
        const secretKeys = result.secrets.map((s) => s.key)
        setHasIntegrationSecrets(detectIntegrationSecretsPresence(secretKeys, normalizedAppType))
      })
      .catch(() => {})
  }, [projectId, normalizedAppType, activeTab, secretsVersion])

  // Handle Claude re-authentication - opens the auth modal
  const handleClaudeReconnect = useCallback(() => {
    setShowClaudeAuthModal(true)
  }, [])

  // Handle Claude auth error detected from message content
  const handleClaudeAuthError = useCallback(() => {
    console.log('[Chat] Claude auth error detected in message stream')
    setProviderAuthStatus((prev) => {
      if (prev.claude === false) return prev
      providerAuthStore.markAuthInvalidated('anthropic')
      return { ...prev, claude: false }
    })
  }, [])

  // Handle Claude auth modal completion - re-fetch actual auth status
  const handleClaudeAuthComplete = useCallback(async () => {
    setShowClaudeAuthModal(false)
    setError(null)

    // Clear the auth invalidation flag since user has re-authenticated
    providerAuthStore.clearAuthInvalidated('anthropic')
    // Also reload tokens from storage to update the global store
    await providerAuthStore.loadFromStorage()

    // Re-fetch actual provider auth status from the API
    try {
      const providerList = await aiAgentApi.getProviders()
      const authStatus: Record<string, boolean> = {}
      for (const p of providerList) {
        authStatus[p.id] = p.isAuthenticated
      }
      setProviderAuthStatus(authStatus)
      console.log('[Chat] Updated provider auth status after reconnect:', authStatus)
    } catch (err) {
      console.error('[Chat] Failed to refresh provider auth status:', err)
    }
  }, [])

  // Integration menu handlers
  const handleIntegrationConnect = useCallback(async (id: string) => {
    const promptType = SETUP_PROMPT_BY_INTEGRATION[id]
    workbenchStore.setActiveTab('settings')
    if (id === 'firebase' || id === 'convex' || id === 'stripe' || id === 'revenuecat') {
      workbenchStore.setPendingIntegrationConnect({
        integrationId: id as PendingIntegrationId,
        source: 'chat',
      })
    }

    if (!promptType) return

    setMessages((prev) => appendSetupPromptIfMissing(prev, promptType))
  }, [])

  const handleIntegrationUse = useCallback(
    async (id: string) => {
      const prompts: Record<string, string> = {
        firebase: FIREBASE_SETUP_PROMPT,
        stripe: 'Use the /add-stripe skill to set up Stripe payments integration for this project',
        convex: CONVEX_AUTH_PROMPT,
        revenuecat: 'Use the /add-revenuecat skill to set up RevenueCat in-app purchases for this project',
      }

      if (id === 'firebase') {
        setFirebaseProvisioned(true)
        setIsFirebaseSettingUp(true)
        const firebasePrompt = prompts.firebase
        if (firebasePrompt) {
          workbenchStore.triggerChatPrompt(firebasePrompt, {
            integrationId: 'firebase',
          })
        }
        return
      }
      if (id === 'convex') {
        if (!convexSecretStatus.isConfigured) {
          const requiredConvexKeys = [convexSecretStatus.urlKey, 'CONVEX_DEPLOY_KEY']
          const secretKeySet = new Set(projectSecrets.map((secret) => secret.key))
          const missingConvexKeys = requiredConvexKeys.filter((key) => !secretKeySet.has(key))
          showErrorToast(
            `Convex Better Auth setup requires ${requiredConvexKeys.join(' + ')}. Missing: ${missingConvexKeys.join(', ')}`
          )
          workbenchStore.setActiveTab('settings')
          workbenchStore.setPendingIntegrationConnect({
            integrationId: 'convex',
            source: 'chat',
          })
          return
        }

        const pendingEnvVars = getConvexEnvVarsForSession(convexSecretStatus)
        if (Object.keys(pendingEnvVars).length > 0) {
          workbenchStore.mergePendingEnvVars(pendingEnvVars)
        }
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1]
          const isDuplicatePrompt =
            lastMessage?.role === 'assistant' &&
            !!lastMessage.parts?.some((part) => part?.type === 'convex-intent-prompt')

          if (isDuplicatePrompt) {
            return prev
          }

          const guidanceMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            parts: [{ type: 'convex-intent-prompt' } as MessagePart],
            createdAt: new Date().toISOString(),
          }

          return [...prev, guidanceMessage]
        })
        return
      }
      if (id === 'revenuecat') {
        const revenuecatApiKey = projectSecrets.find((secret) => secret.key === 'REVENUECAT_API_KEY')?.value
        const revenuecatPublicKey = projectSecrets.find(
          (secret) => secret.key === 'EXPO_PUBLIC_REVENUECAT_API_KEY'
        )?.value
        const pendingRevenuecatEnv: Record<string, string> = {}
        if (revenuecatApiKey) {
          pendingRevenuecatEnv.REVENUECAT_API_KEY = revenuecatApiKey
        }
        if (revenuecatPublicKey) {
          pendingRevenuecatEnv.EXPO_PUBLIC_REVENUECAT_API_KEY = revenuecatPublicKey
        }
        if (Object.keys(pendingRevenuecatEnv).length > 0) {
          workbenchStore.mergePendingEnvVars(pendingRevenuecatEnv)
        }
        setRevenuecatProvisioned(true)
        setIsRevenueCatSettingUp(true)

        const revenuecatPrompt = prompts.revenuecat
        if (revenuecatPrompt) {
          workbenchStore.triggerChatPrompt(revenuecatPrompt, {
            integrationId: 'revenuecat',
          })
        }
        return
      }
      if (id === 'stripe') {
        setIsStripeSettingUp(true)
      }

      const prompt = prompts[id]
      if (prompt) {
        setInput(prompt)
        setTimeout(() => {
          try {
            submitRef.current?.(prompt)
          } catch (error) {
            if (id === 'stripe') {
              setIsStripeSettingUp(false)
            }
            if (id === 'revenuecat') {
              setIsRevenueCatSettingUp(false)
            }
            throw error
          }
          if (id === 'stripe') {
            setIsStripeSettingUp(false)
          }
          if (id === 'revenuecat') {
            setIsRevenueCatSettingUp(false)
          }
        }, 100)
      }
    },
    [convexSecretStatus, projectSecrets]
  )

  const enqueuePrompt = useCallback((prompt: string) => {
    setInput(prompt)
    setTimeout(() => {
      submitRef.current?.(prompt)
    }, 100)
  }, [])

  const handleConvexIntentSelect = useCallback(
    (mode: ConvexIntentMode) => {
      if (!convexSecretStatus.isConfigured) {
        const requiredConvexKeys = [convexSecretStatus.urlKey, 'CONVEX_DEPLOY_KEY']
        const secretKeySet = new Set(projectSecrets.map((secret) => secret.key))
        const missingConvexKeys = requiredConvexKeys.filter((key) => !secretKeySet.has(key))
        showErrorToast(
          `Convex setup requires ${requiredConvexKeys.join(' + ')}. Missing: ${missingConvexKeys.join(', ')}`
        )
        workbenchStore.setActiveTab('settings')
        workbenchStore.setPendingIntegrationConnect({
          integrationId: 'convex',
          source: 'chat',
        })
        return
      }

      const pendingEnvVars = getConvexEnvVarsForSession(convexSecretStatus)
      if (Object.keys(pendingEnvVars).length > 0) {
        workbenchStore.mergePendingEnvVars(pendingEnvVars)
      }

      if (mode === 'convex_only') {
        setPendingConvexAuthAfterSetup(false)
        setConvexProvisioned(true)
        enqueuePrompt(CONVEX_SETUP_PROMPT)
        return
      }

      if (mode === 'auth_only') {
        setPendingConvexAuthAfterSetup(false)
        setConvexProvisioned(true)
        enqueuePrompt(CONVEX_AUTH_PROMPT)
        return
      }

      if (convexBootstrapDetected) {
        setPendingConvexAuthAfterSetup(false)
        setConvexProvisioned(true)
        enqueuePrompt(CONVEX_AUTH_PROMPT)
        return
      }

      setPendingConvexAuthAfterSetup(true)
      setConvexProvisioned(true)
      enqueuePrompt(CONVEX_SETUP_PROMPT)
    },
    [convexSecretStatus, projectSecrets, enqueuePrompt, convexBootstrapDetected]
  )

  const waitForRequiredSecrets = useCallback(
    async (projectIdToCheck: string, requiredSecretKeys: string[], timeoutMs = 8000): Promise<SecretEntry[] | null> => {
      const startedAt = Date.now()
      const pollIntervalMs = 250

      while (Date.now() - startedAt <= timeoutMs) {
        try {
          const result = await secrets.readSecrets(projectIdToCheck)
          if (!result.error && Array.isArray(result.secrets)) {
            const secretMap = new Map(
              result.secrets
                .filter((secret): secret is SecretEntry => !!secret?.key && typeof secret.value === 'string')
                .map((secret) => [secret.key, secret.value.trim()])
            )
            const allPresent = requiredSecretKeys.every((key) => (secretMap.get(key) || '').length > 0)
            if (allPresent) {
              return result.secrets
            }
          }
        } catch {
          // Retry until timeout
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }

      return null
    },
    []
  )

  // Convert session message to ChatMessage format
  const convertSessionMessage = useCallback((msg: SessionMessageData): ChatMessage => {
    const parts: ChatMessage['parts'] = []

    // Debug: Log incoming message
    const hasTextBlocks = msg.blocks?.some((b) => b.type === 'text') || false
    console.log('[Chat] convertSessionMessage:', {
      id: msg.id,
      role: msg.role,
      contentLength: msg.content?.length || 0,
      hasBlocks: !!msg.blocks,
      blocksCount: msg.blocks?.length || 0,
      hasTextBlocks,
    })

    if (msg.role === 'user') {
      parts.push({ type: 'text', text: msg.content })
    } else if (msg.blocks) {
      // Convert blocks to parts
      for (const block of msg.blocks) {
        if (block.type === 'text' && block.content) {
          console.log('[Chat] Adding text part:', { contentLength: block.content.length })
          parts.push({ type: 'text', text: block.content })
        } else if (block.type === 'tool' && block.action) {
          parts.push({
            type: `tool-${block.action.type}`,
            toolCallId: block.action.id,
            toolName: block.action.type,
            state: block.action.status === 'completed' ? 'result' : 'call',
            args: { label: block.action.label },
            result: block.action.output,
          } as ChatMessage['parts'][number])
        }
      }
    } else {
      parts.push({ type: 'text', text: msg.content })
    }

    // Debug: Log resulting parts
    const textParts = parts.filter((p) => p.type === 'text')
    console.log('[Chat] convertSessionMessage result:', {
      totalParts: parts.length,
      textParts: textParts.length,
    })

    return {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      parts,
      createdAt: new Date(msg.timestamp).toISOString(),
    }
  }, [])

  const loadPersistedSession = useCallback(
    async (
      sessionIdToLoad: string,
      sessionProvider: ProviderId = provider,
      options?: { preserveInitialUserMessage?: boolean }
    ) => {
      console.log('[Chat] loadPersistedSession', {
        sessionIdToLoad,
        sessionProvider,
        preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
      })

      const result = await aiAgentApi.readSession(sessionIdToLoad, sessionProvider, usableProjectPath || undefined)
      if (!result.success || !result.session?.messages) {
        throw new Error(result.error || 'Failed to load session')
      }

      const chatMessages = result.session.messages.map(convertSessionMessage)

      if (options?.preserveInitialUserMessage && initialMessages?.length > 0 && initialMessages[0].role === 'user') {
        const hasUserMessage = chatMessages.some((m) => m.role === 'user')
        if (!hasUserMessage) {
          console.log('[Chat] Preserving initial user message not found in CLI session')
          return [initialMessages[0], ...chatMessages]
        }
      }

      console.log('[Chat] loadPersistedSession result', {
        sessionIdToLoad,
        messageCount: chatMessages.length,
        preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
      })

      return chatMessages
    },
    [aiAgentApi, convertSessionMessage, initialMessages, provider, usableProjectPath]
  )

  const loadSessionTranscript = useCallback(
    async (
      sessionIdToLoad: string,
      sessionProvider: ProviderId = provider,
      options?: { preserveInitialUserMessage?: boolean }
    ) => {
      console.log('[Chat] loadSessionTranscript', {
        sessionIdToLoad,
        sessionProvider,
        preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
      })

      const history = await aiAgent.getSessionHistory(sessionIdToLoad)
      if (history.success && Array.isArray(history.entries)) {
        const hydrated = hydrateTranscriptFromHistory(history.entries as SessionHistoryEntry[])
        let messages = hydrated.messages

        if (options?.preserveInitialUserMessage && initialMessages?.length > 0 && initialMessages[0].role === 'user') {
          const hasUserMessage = messages.some((m) => m.role === 'user')
          if (!hasUserMessage) {
            messages = [initialMessages[0], ...messages]
          }
        }

        console.log('[Chat] loadSessionTranscript result from journal', {
          sessionIdToLoad,
          resolvedSessionId: history.sessionId || sessionIdToLoad,
          messageCount: messages.length,
          preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
        })

        return {
          sessionId: history.sessionId || sessionIdToLoad,
          provider: history.provider || sessionProvider,
          providerSessionId: history.providerSessionId,
          messages,
          lastSeq: history.lastSeq || hydrated.lastSeq,
          source: 'journal' as const,
        }
      }

      const messages = await loadPersistedSession(sessionIdToLoad, sessionProvider, options)
      console.log('[Chat] loadSessionTranscript result from provider storage', {
        sessionIdToLoad,
        messageCount: messages.length,
        preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
      })
      return {
        sessionId: sessionIdToLoad,
        provider: sessionProvider,
        messages,
        lastSeq: 0,
        source: 'provider-storage' as const,
      }
    },
    [initialMessages, loadPersistedSession, provider]
  )

  const mergeTranscriptMessages = useCallback(
    (stableMessages: ChatMessage[], runtimeMessages: ChatMessage[]): ChatMessage[] => {
      const messageSignature = (message: ChatMessage) =>
        JSON.stringify({
          role: message.role,
          content: message.content,
          parts: message.parts || [],
        })

      const stableSignatures = stableMessages.map(messageSignature)
      const runtimeSignatures = runtimeMessages.map(messageSignature)
      const maxOverlap = Math.min(stableSignatures.length, runtimeSignatures.length)

      let overlapCount = 0
      for (let candidate = maxOverlap; candidate > 0; candidate -= 1) {
        const stableTail = stableSignatures.slice(stableSignatures.length - candidate)
        const runtimeHead = runtimeSignatures.slice(0, candidate)
        if (stableTail.every((signature, index) => signature === runtimeHead[index])) {
          overlapCount = candidate
          break
        }
      }

      const merged = [...stableMessages, ...runtimeMessages.slice(overlapCount)]
      console.log('[Chat] Merged transcript tail', {
        stableMessageCount: stableMessages.length,
        runtimeMessageCount: runtimeMessages.length,
        overlapCount,
        mergedMessageCount: merged.length,
      })

      return merged
    },
    []
  )

  const loadStableSessionState = useCallback(
    async (
      requestedSessionId: string,
      fallbackProvider: ProviderId = provider,
      options?: { preserveInitialUserMessage?: boolean }
    ) => {
      const identity = resolveSessionIdentity(requestedSessionId, fallbackProvider)
      if (!identity) {
        throw new Error('Session identity could not be resolved')
      }

      const stableTranscript = await loadSessionTranscript(identity.stableSessionId, identity.provider, {
        preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
      })

      let mergedMessages = stableTranscript.messages
      let resumeSessionId = stableTranscript.providerSessionId || null
      let transcriptLastSeq = stableTranscript.lastSeq

      if (identity.runtimeSessionId && identity.runtimeSessionId !== identity.stableSessionId) {
        const runtimeTranscript = await loadSessionTranscript(identity.runtimeSessionId, identity.provider, {
          preserveInitialUserMessage: false,
        }).catch((error) => {
          console.warn('[Chat] Failed to load linked runtime transcript; using stable transcript only', {
            stableSessionId: identity.stableSessionId,
            runtimeSessionId: identity.runtimeSessionId,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        })

        if (runtimeTranscript) {
          mergedMessages = mergeTranscriptMessages(stableTranscript.messages, runtimeTranscript.messages)
          resumeSessionId = runtimeTranscript.providerSessionId || stableTranscript.providerSessionId || null
          transcriptLastSeq = Math.max(stableTranscript.lastSeq, runtimeTranscript.lastSeq)
        }
      }

      console.log('[Chat] Loaded stable session state', {
        requestedSessionId,
        stableSessionId: identity.stableSessionId,
        runtimeSessionId: identity.runtimeSessionId,
        messageCount: mergedMessages.length,
        resumeProviderSessionId: resumeSessionId,
      })

      return {
        stableSessionId: identity.stableSessionId,
        runtimeSessionId: identity.runtimeSessionId,
        provider: identity.provider,
        messages: mergedMessages,
        resumeProviderSessionId: resumeSessionId,
        transcriptLastSeq,
      }
    },
    [loadSessionTranscript, mergeTranscriptMessages, provider, resolveSessionIdentity]
  )

  const persistRuntimeSessionId = useCallback(
    (stableSessionId: string, runtimeSessionId: string | null, providerSessionId?: string | null) => {
      updateSessionMutation.mutate(stableSessionId, {
        runtimeSessionId,
        ...(providerSessionId !== undefined ? { providerSessionId } : {}),
        lastUsedAt: new Date().toISOString(),
      })
    },
    [updateSessionMutation]
  )

  const reconcileSessionState = useCallback(
    async (
      stableSessionId: string,
      sessionProvider: ProviderId,
      options?: {
        preserveInitialUserMessage?: boolean
        persistedRuntimeSessionId?: string | null
        logContext?: string
      }
    ) => {
      const cachedSessionState = getStoredSessionViewState(stableSessionId)
      const shouldShowLoading = !cachedSessionState.isHydrated

      if (cachedSessionState.isHydrated) {
        console.log('[Chat] Rendering cached session state before reconcile', {
          stableSessionId,
          logContext: options?.logContext ?? 'unknown',
          messageCount: cachedSessionState.messages.length,
          cachedRuntimeSessionId: cachedSessionState.runtimeSessionId,
          cachedProviderSessionId: cachedSessionState.providerSessionId,
          needsRefresh: cachedSessionState.needsRefresh,
        })
      }

      if (shouldShowLoading) {
        setSessionLoading(stableSessionId, true)
      }

      let transcriptLastSeq = cachedSessionState.transcriptLastSeq
      let reconnectSessionId = options?.persistedRuntimeSessionId ?? cachedSessionState.runtimeSessionId ?? null
      let runtimeReplayLastSeq = cachedSessionState.runtimeLastSeq
      let loadedProviderSessionId: string | null = cachedSessionState.providerSessionId ?? null

      try {
        const sessionState = await loadStableSessionState(stableSessionId, sessionProvider, {
          preserveInitialUserMessage: options?.preserveInitialUserMessage ?? false,
        })

        const mergedPersistedThenCache = cachedSessionState.isHydrated
          ? mergeTranscriptMessages(sessionState.messages, cachedSessionState.messages)
          : sessionState.messages
        const mergedCacheThenPersisted = cachedSessionState.isHydrated
          ? mergeTranscriptMessages(cachedSessionState.messages, sessionState.messages)
          : sessionState.messages

        const cacheLooksLikeTailExtension =
          cachedSessionState.isHydrated &&
          mergedPersistedThenCache.length === cachedSessionState.messages.length &&
          mergedCacheThenPersisted.length > sessionState.messages.length

        const persistedLooksLikeTailExtension =
          cachedSessionState.isHydrated &&
          mergedCacheThenPersisted.length === sessionState.messages.length &&
          mergedPersistedThenCache.length > cachedSessionState.messages.length

        const mergedMessages = !cachedSessionState.isHydrated
          ? sessionState.messages
          : cacheLooksLikeTailExtension
            ? mergedPersistedThenCache
            : persistedLooksLikeTailExtension
              ? mergedCacheThenPersisted
              : sessionState.messages

        const preferredTranscriptSource = !cachedSessionState.isHydrated
          ? 'persisted'
          : cacheLooksLikeTailExtension
            ? 'cache-tail'
            : persistedLooksLikeTailExtension
              ? 'persisted-tail'
              : 'persisted-divergence'

        if (cachedSessionState.isHydrated && preferredTranscriptSource === 'persisted-divergence') {
          console.warn('[Chat] Persisted transcript won due to cache divergence', {
            stableSessionId,
            cachedTranscriptLastSeq: cachedSessionState.transcriptLastSeq,
            persistedTranscriptLastSeq: sessionState.transcriptLastSeq,
            cachedMessageCount: cachedSessionState.messages.length,
            persistedMessageCount: sessionState.messages.length,
          })
        }

        reconnectSessionId =
          sessionState.runtimeSessionId ??
          options?.persistedRuntimeSessionId ??
          cachedSessionState.runtimeSessionId ??
          null
        runtimeReplayLastSeq =
          reconnectSessionId && cachedSessionState.runtimeSessionId === reconnectSessionId
            ? cachedSessionState.runtimeLastSeq
            : 0
        transcriptLastSeq = Math.max(cachedSessionState.transcriptLastSeq, sessionState.transcriptLastSeq)
        loadedProviderSessionId = sessionState.resumeProviderSessionId ?? cachedSessionState.providerSessionId

        replaceSessionViewState(
          stableSessionId,
          createHydratedSessionViewState(sessionState.provider, mergedMessages, {
            providerSessionId: loadedProviderSessionId,
            runtimeSessionId: reconnectSessionId,
            transcriptLastSeq,
            runtimeLastSeq: runtimeReplayLastSeq,
            status: reconnectSessionId ? 'running' : 'completed',
            isAttachedToTransport: false,
          })
        )

        console.log('[Chat] Reconciled session transcript', {
          stableSessionId,
          cachedMessageCount: cachedSessionState.messages.length,
          persistedMessageCount: sessionState.messages.length,
          mergedMessageCount: mergedMessages.length,
          preferredTranscriptSource,
          transcriptLastSeq,
          runtimeReplayLastSeq,
          reconnectSessionId,
        })

        if (sessionState.runtimeSessionId && sessionState.runtimeSessionId !== options?.persistedRuntimeSessionId) {
          persistRuntimeSessionId(
            stableSessionId,
            sessionState.runtimeSessionId,
            sessionState.resumeProviderSessionId ?? null
          )
        } else if (
          !sessionState.runtimeSessionId &&
          options?.persistedRuntimeSessionId &&
          options.persistedRuntimeSessionId !== cachedSessionState.runtimeSessionId
        ) {
          console.log('[Chat] Clearing stale persisted runtime session ID during reconcile', {
            stableSessionId,
            staleRuntimeSessionId: options.persistedRuntimeSessionId,
          })
          persistRuntimeSessionId(stableSessionId, null, sessionState.resumeProviderSessionId ?? null)
        }
      } catch (err) {
        console.error('[Chat] Error reconciling session:', err)
        if (!cachedSessionState.isHydrated) {
          replaceSessionViewState(
            stableSessionId,
            createHydratedSessionViewState(sessionProvider, [], {
              providerSessionId: null,
              runtimeSessionId: null,
              transcriptLastSeq: 0,
              runtimeLastSeq: 0,
              status: 'error',
              error: err instanceof Error ? err.message : 'Failed to load session',
            })
          )
        } else {
          updateSessionViewState(stableSessionId, (prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : 'Failed to load session',
            status: 'error',
            needsRefresh: true,
          }))
        }
        return
      } finally {
        setSessionLoading(stableSessionId, false)
      }

      const reconnectResult =
        reconnectSessionId && reconnectToSessionRef.current
          ? await reconnectToSessionRef.current(reconnectSessionId, runtimeReplayLastSeq)
          : { attached: false, canonicalSessionId: null }

      if (reconnectSessionId && reconnectResult.attached && reconnectResult.canonicalSessionId === reconnectSessionId) {
        console.log('[Chat] Reconnected to running background session', {
          stableSessionId,
          reconnectSessionId,
          logContext: options?.logContext ?? 'unknown',
        })
        updateSessionViewState(stableSessionId, (prev) => ({
          ...prev,
          runtimeSessionId: reconnectSessionId,
          status: 'running',
          isAttachedToTransport: true,
          isResumingSession: true,
          lastRuntimeSeenAt: Date.now(),
          needsRefresh: false,
        }))
      } else if (
        reconnectSessionId &&
        reconnectResult.canonicalSessionId &&
        reconnectResult.canonicalSessionId !== reconnectSessionId
      ) {
        console.warn('[Chat] Rejecting stale runtime reconnect for selected tab', {
          stableSessionId,
          expectedRuntimeSessionId: reconnectSessionId,
          canonicalSessionId: reconnectResult.canonicalSessionId,
        })
        persistRuntimeSessionId(stableSessionId, null, loadedProviderSessionId)
        updateSessionViewState(stableSessionId, (prev) => ({
          ...prev,
          runtimeSessionId: null,
          status: prev.error ? 'error' : 'completed',
          isAttachedToTransport: false,
          isResumingSession: false,
        }))
      } else {
        if (reconnectSessionId) {
          console.log('[Chat] Runtime session not reattachable; keeping transcript-only state', {
            stableSessionId,
            reconnectSessionId,
            logContext: options?.logContext ?? 'unknown',
          })
          persistRuntimeSessionId(stableSessionId, null, loadedProviderSessionId)
          updateSessionViewState(stableSessionId, (prev) => ({
            ...prev,
            runtimeSessionId: null,
            status: prev.error ? 'error' : 'completed',
            isAttachedToTransport: false,
            isResumingSession: false,
            needsRefresh: false,
          }))
        }

        if (loadedProviderSessionId) {
          console.log(
            '[Chat] Session is transcript-only after reconcile; next prompt will resume it with a fresh live session',
            {
              stableSessionId,
              reconnectSessionId,
              resumeProviderSessionId: loadedProviderSessionId,
            }
          )
          pendingSessionPromotionRef.current = {
            stableSessionId,
            provider: sessionProvider,
          }
        } else {
          pendingSessionPromotionRef.current = null
        }
      }
    },
    [
      createHydratedSessionViewState,
      getStoredSessionViewState,
      loadStableSessionState,
      persistRuntimeSessionId,
      replaceSessionViewState,
      setSessionLoading,
      updateSessionViewState,
    ]
  )

  const hideReconnectNotice = useCallback(() => {
    setShowReconnectNotice(false)
  }, [])

  useEffect(() => {
    if (!showReconnectNotice) return

    const timeoutId = window.setTimeout(() => {
      setShowReconnectNotice(false)
    }, 4000)

    return () => window.clearTimeout(timeoutId)
  }, [showReconnectNotice])

  // Load session messages from local CLI storage
  // Only loads ONCE on component mount when we have a session ID from a PREVIOUS run
  // Uses initialSessionIdAtMount ref to ensure we don't load sessions started during this component's lifecycle
  useEffect(() => {
    if (suppressInitialSessionRestore.current) {
      console.log('[Chat] Skipping initial session restore because a new session was started')
      return
    }

    if (!hasLoadedSessionCatalog) {
      console.log('[Chat] Waiting for persisted session catalog before restoring initial session')
      return
    }

    // Use resolvedInitialSessionId to handle both prop and fetched session
    // Update the ref if we now have a session ID (from async fetch)
    if (resolvedInitialSessionId && !initialSessionIdAtMount.current) {
      initialSessionIdAtMount.current = resolvedInitialSessionId
    }

    const stableSessionId = initialSessionIdAtMount.current

    // Only load if we have a session ID at mount time and haven't already loaded
    if (!stableSessionId || hasLoadedSession.current) {
      return
    }

    const cachedSessionState = getStoredSessionViewState(stableSessionId)
    if (cachedSessionState.isHydrated) {
      console.log('[Chat] Reusing hydrated session state from project session store before reconcile:', {
        stableSessionId,
        messageCount: cachedSessionState.messages.length,
        runtimeSessionId: cachedSessionState.runtimeSessionId,
        needsRefresh: cachedSessionState.needsRefresh,
      })
      setSelectedSessionId(stableSessionId)
    }

    hasLoadedSession.current = true
    activeStreamSessionKeyRef.current = stableSessionId

    reconcileSessionState(stableSessionId, provider, {
      preserveInitialUserMessage: shouldPreserveInitialUserMessage(stableSessionId),
      persistedRuntimeSessionId: cachedSessionState.runtimeSessionId,
      logContext: 'initial-restore',
    })
      .then(() => {
        setSelectedSessionId(stableSessionId)
      })
      .catch((err) => {
        console.error('[Chat] Error loading session:', err)
      })
      .finally(() => {
        setSessionLoading(stableSessionId, false)
      })
    // Note: Also depends on resolvedInitialSessionId to handle async session fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasLoadedSessionCatalog,
    reconcileSessionState,
    provider,
    resolvedInitialSessionId,
    setSessionLoading,
    getStoredSessionViewState,
    shouldPreserveInitialUserMessage,
  ])

  // Log when projectPath is received
  useEffect(() => {
    console.log('[Chat] Project path received:', projectPath)
    console.log('[Chat] Usable project path:', usableProjectPath)
    console.log('[Chat] Initial provider:', initialProvider, '-> using:', provider)
    console.log('[Chat] Initial session ID:', initialSessionId)
    console.log('[Chat] Initial messages count:', initialMessages?.length || 0)
    console.log('[Chat] Initial images count:', initialImages?.length || 0)
    if (initialImages?.length) {
      console.log(
        '[Chat] Initial images:',
        initialImages.map((img) => img.filename)
      )
    }
    if (initialMessages?.length) {
      console.log('[Chat] First message:', initialMessages[0]?.role, initialMessages[0]?.content?.substring(0, 100))
    }
  }, [projectPath, usableProjectPath, initialSessionId, initialMessages, initialImages])

  // Subscribe to prompt errors from preview/runtime
  const promptError = useStore(workbenchStore.promptError)

  // Subscribe to pending screenshot from preview
  const pendingScreenshotDataUrl = useStore(workbenchStore.pendingScreenshot)
  const pendingAttachment = useMemo(() => {
    if (!pendingScreenshotDataUrl) return null
    return {
      type: 'file' as const,
      id: `screenshot-${Date.now()}`,
      mediaType: 'image/png',
      filename: 'preview-screenshot.png',
      url: pendingScreenshotDataUrl,
    }
  }, [pendingScreenshotDataUrl])
  const handlePendingAttachmentConsumed = useCallback(() => {
    workbenchStore.pendingScreenshot.setState(null, true)
  }, [])

  const shouldForceFrontendDesignForCurrentSession = useCallback(() => {
    if (!isNewProjectAtMount.current) return false

    const forcedSessionId = forcedFrontendDesignSessionIdRef.current
    if (forcedSessionId === null) {
      // Before the first session ID is assigned, we are still in the first session.
      return selectedSessionId === null
    }
    return selectedSessionId === forcedSessionId
  }, [selectedSessionId])

  // Handle session ID changes - update local state and persist to projects.json
  // For local-first mode, sessions are stored in ~/.bfloat-ide/projects.json
  const handleSessionIdChange = useCallback(
    (sessionId: string) => {
      console.log('[Chat] ========================================')
      console.log('[Chat] NEW AGENT SESSION ID RECEIVED:', sessionId)
      console.log('[Chat] Provider:', provider)
      console.log('[Chat] ========================================')

      const existingSessionKey =
        Object.entries(sessionViewStatesRef.current).find(
          ([sessionKey, state]) => sessionKey !== DRAFT_SESSION_KEY && state.runtimeSessionId === sessionId
        )?.[0] ?? null

      if (isNewProjectAtMount.current && forcedFrontendDesignSessionIdRef.current === null) {
        forcedFrontendDesignSessionIdRef.current = sessionId
      }

      const pendingPromotion = pendingSessionPromotionRef.current
      const stableSessionId = pendingPromotion?.stableSessionId ?? existingSessionKey ?? sessionId
      const sourceSessionKey =
        pendingPromotion?.stableSessionId ??
        existingSessionKey ??
        activeStreamSessionKeyRef.current ??
        DRAFT_SESSION_KEY
      const providerSessionId =
        sessionViewStatesRef.current[sourceSessionKey]?.providerSessionId ??
        sessionViewStatesRef.current[DRAFT_SESSION_KEY]?.providerSessionId ??
        null

      setSelectedSessionId(stableSessionId)
      moveSessionViewState(sourceSessionKey, stableSessionId, (prev) => ({
        ...prev,
        status: 'running',
        isAttachedToTransport: true,
        isHydrated: true,
        provider,
        runtimeSessionId: sessionId,
        providerSessionId,
        runtimeLastSeq: prev.runtimeSessionId === sessionId ? prev.runtimeLastSeq : 0,
        isResumingSession: false,
        isLoadingSession: false,
        error: null,
      }))
      activeStreamSessionKeyRef.current = stableSessionId
      suppressInitialSessionRestore.current = false

      // Mark session as loaded so the load-session effect won't re-run
      hasLoadedSession.current = true

      if (pendingPromotion || existingSessionKey) {
        console.log('[Chat] Linking stable session to new live sidecar session', {
          stableSessionId,
          runtimeSessionId: sessionId,
          providerSessionId,
          provider: pendingPromotion?.provider ?? provider,
        })
        persistRuntimeSessionId(stableSessionId, sessionId, providerSessionId)
      } else {
        saveSessionMutation.mutate({
          sessionId,
          runtimeSessionId: sessionId,
          providerSessionId,
          provider: provider as 'claude' | 'codex',
        })
      }
      pendingSessionPromotionRef.current = null

      // Notify parent if callback provided
      onSessionIdChange?.(stableSessionId, provider as 'claude' | 'codex')
    },
    [onSessionIdChange, persistRuntimeSessionId, provider, saveSessionMutation]
  )

  const handleReconnectSession = useCallback(
    async (info: {
      sessionId: string
      provider: ProviderId
      status: 'running' | 'completed' | 'error'
      source: 'mount' | 'tab'
    }) => {
      const { sessionId, provider: sessionProvider, status, source } = info
      console.log('[Chat] Reconnected to existing session:', info)

      if (sessionProvider !== provider) {
        setSelectedModel(DEFAULT_MODEL_BY_AGENT_PROVIDER[sessionProvider] || '')
      }
      const resolvedIdentity = resolveSessionIdentity(sessionId, sessionProvider)
      const stableSessionId = resolvedIdentity?.stableSessionId ?? sessionId
      const runtimeSessionId = status === 'running' ? sessionId : null

      setProvider(sessionProvider)
      setSelectedSessionId(stableSessionId)
      setShowReconnectNotice(status === 'running')
      activeStreamSessionKeyRef.current = stableSessionId

      setSessionLoading(stableSessionId, true)
      try {
        const sessionState = await loadStableSessionState(stableSessionId, sessionProvider, {
          preserveInitialUserMessage: shouldPreserveInitialUserMessage(stableSessionId),
        })
        hasLoadedSession.current = true
        replaceSessionViewState(stableSessionId, {
          messages: sessionState.messages,
          status: status === 'running' ? 'running' : 'completed',
          isAttachedToTransport: status === 'running',
          isHydrated: true,
          lastHydratedAt: Date.now(),
          lastRuntimeSeenAt: runtimeSessionId ? Date.now() : null,
          needsRefresh: false,
          isResumingSession: status === 'running',
          isLoadingSession: false,
          error: null,
          providerSessionId: sessionState.resumeProviderSessionId,
          runtimeSessionId,
          provider: sessionState.provider,
          transcriptLastSeq: sessionState.transcriptLastSeq,
          runtimeLastSeq: 0,
        })
        if (status !== 'running' && sessionState.resumeProviderSessionId) {
          pendingSessionPromotionRef.current = {
            stableSessionId: sessionState.stableSessionId,
            provider: sessionState.provider,
          }
          console.log('[Chat] Reattached to completed session transcript; next prompt will resume it in place', {
            stableSessionId: sessionState.stableSessionId,
            runtimeSessionId,
            providerSessionId: sessionState.resumeProviderSessionId,
            source,
          })
        } else if (status !== 'running') {
          pendingSessionPromotionRef.current = null
        }
        if (runtimeSessionId && sessionState.stableSessionId !== runtimeSessionId) {
          persistRuntimeSessionId(
            sessionState.stableSessionId,
            runtimeSessionId,
            sessionState.resumeProviderSessionId ?? null
          )
        }
        return runtimeSessionId ? 0 : sessionState.transcriptLastSeq
      } catch (err) {
        console.error('[Chat] Error restoring resumed session:', err)
        return 0
      } finally {
        setSessionLoading(stableSessionId, false)
      }
    },
    [
      loadStableSessionState,
      persistRuntimeSessionId,
      provider,
      replaceSessionViewState,
      resolveSessionIdentity,
      setSessionLoading,
      shouldPreserveInitialUserMessage,
    ]
  )

  // Compute system prompt (exploration + suggestions for new sessions, suggestions-only for resumed)
  const systemPrompt = useMemo(() => {
    return getSystemPrompt(!!selectedSessionId, provider)
  }, [provider, selectedSessionId])

  // Local agent hook - only use path when it belongs to this project
  const localAgent = useLocalAgent({
    cwd: usableProjectPath || '',
    provider,
    model: selectedModel,
    sessionId: agentSessionId,
    projectId, // Project ID for background session tracking
    enableMountReconnect: false,
    systemPrompt, // System prompt for project exploration (new sessions only)
    resumeProviderSessionId,
    onSessionId: handleSessionIdChange, // Capture session ID from init message
    onReconnectSession: handleReconnectSession,
    onMessage: (msg, context) => {
      const targetSessionKey = resolveCallbackTargetSessionKey(context.runtimeSessionId)
      const shouldMarkSessionRunning =
        !!context.runtimeSessionId &&
        (msg.type === 'connected' ||
          msg.type === 'init' ||
          msg.type === 'text' ||
          msg.type === 'reasoning' ||
          msg.type === 'tool_call' ||
          msg.type === 'tool_result')
      const shouldMarkAttached =
        shouldMarkSessionRunning &&
        targetSessionKey === activeSessionKey &&
        !!context.runtimeSessionId &&
        context.runtimeSessionId === agentSessionId

      console.log('[Chat] Local agent message:', msg.type, msg.content, {
        runtimeSessionId: context.runtimeSessionId,
        targetSessionKey,
      })

      if (shouldMarkSessionRunning) {
        markSessionRuntimeActive(targetSessionKey, context.runtimeSessionId, shouldMarkAttached ? true : undefined)
        const runtimeSeq = msg.metadata?.seq
        if (typeof runtimeSeq === 'number' && Number.isFinite(runtimeSeq)) {
          setSessionRuntimeLastSeq(targetSessionKey, runtimeSeq)
        }
      }

      if (msg.type === 'text') {
        const textContent = msg.content as string

        // Detect poisoned conversation history — the SDK may emit the API error
        // as assistant text rather than throwing.
        if (textContent?.includes('image cannot be empty') || textContent?.includes('image.source.base64')) {
          console.warn('[Chat] Detected poisoned conversation history (empty screenshot base64) in message stream')
          showErrorToast('Screenshot issue detected. Starting a fresh session.', { id: 'agent-error' })
          if (context.runtimeSessionId) {
            void localAgent.terminateSession(context.runtimeSessionId)
          } else {
            void localAgent.terminate()
          }
          setSessionMessages(targetSessionKey, (prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content:
                "A corrupted screenshot was in the conversation history. I've started a fresh session — please resend your message.",
              parts: [
                {
                  type: 'text',
                  text: "A corrupted screenshot was in the conversation history. I've started a fresh session — please resend your message.",
                },
              ],
              createdAt: new Date().toISOString(),
            },
          ])
          setSessionRuntimeSessionId(targetSessionKey, null)
          setSessionResuming(targetSessionKey, false)
          hideReconnectNotice()
          setSessionStreaming(targetSessionKey, false)
          return
        }

        if (targetSessionKey === activeSessionKey) {
          hideReconnectNotice()
        }
        setSessionMessages(targetSessionKey, (prev) => applyAgentMessageToTranscript(prev, msg))
      } else if (msg.type === 'tool_call') {
        if (targetSessionKey === activeSessionKey) {
          hideReconnectNotice()
        }
        const toolContent = msg.content as { name: string; input: Record<string, unknown> }
        console.log('[Chat] Tool call:', toolContent.name, toolContent.input)
        setSessionMessages(targetSessionKey, (prev) => applyAgentMessageToTranscript(prev, msg))
      } else if (msg.type === 'tool_result') {
        if (targetSessionKey === activeSessionKey) {
          hideReconnectNotice()
        }
        const resultContent = msg.content as { callId: string; name: string; output: string; isError: boolean }
        console.log('[Chat] Tool result:', resultContent.callId, resultContent.isError ? 'ERROR' : 'SUCCESS')
        setSessionMessages(targetSessionKey, (prev) => applyAgentMessageToTranscript(prev, msg))
      } else if (msg.type === 'queue_user_prompt') {
        const queuedContent = msg.content as { prompt?: string; reason?: string; source?: string }
        const prompt = typeof queuedContent.prompt === 'string' ? queuedContent.prompt.trim() : ''
        if (prompt.length > 0) {
          if (
            queuedContent.source === 'completion_verification_gate' &&
            context.runtimeSessionId &&
            suppressedCompletionGateRuntimeIdsRef.current.has(context.runtimeSessionId)
          ) {
            console.log('[Chat] Suppressing completion verification follow-up after manual stop', {
              runtimeSessionId: context.runtimeSessionId,
              targetSessionKey,
            })
            return
          }

          console.log('[Chat] Queueing user prompt from stream:', {
            source: queuedContent.source ?? 'unknown',
            reason: queuedContent.reason ?? null,
          })
          workbenchStore.triggerChatPrompt(prompt, {
            source: queuedContent.source,
            hiddenFromUser: queuedContent.source === 'completion_verification_gate',
          })
        }
      } else if (msg.type === 'reasoning') {
        if (targetSessionKey === activeSessionKey) {
          hideReconnectNotice()
        }
        const reasoningContent = msg.content as string
        console.log('[Chat] Reasoning:', reasoningContent?.substring(0, 100))
        setSessionMessages(targetSessionKey, (prev) => applyAgentMessageToTranscript(prev, msg))
      } else if (msg.type === 'init') {
        console.log('[Chat] Agent initialized:', msg.content)
        const initContent = msg.content as { providerSessionId?: string }
        setSessionResumeProvider(targetSessionKey, initContent.providerSessionId || null)
      } else if (msg.type === 'done') {
        if (targetSessionKey === activeSessionKey) {
          hideReconnectNotice()
        }
        console.log('[Chat] Agent completed:', msg.content)
        setSessionMessages(targetSessionKey, (prev) => applyAgentMessageToTranscript(prev, msg))
        // Capture usage data from completion message
        if (msg.metadata?.tokens) {
          usageRef.current.outputTokens += msg.metadata.tokens as number
        }
      }
    },
    onError: (err, context) => {
      const targetSessionKey = resolveCallbackTargetSessionKey(context.runtimeSessionId)
      if (context.runtimeSessionId) {
        suppressedCompletionGateRuntimeIdsRef.current.delete(context.runtimeSessionId)
      }
      console.error('[Chat] Local agent error:', err, {
        runtimeSessionId: context.runtimeSessionId,
        targetSessionKey,
      })
      if (targetSessionKey === activeSessionKey) {
        hideReconnectNotice()
      }

      // Detect poisoned conversation history (empty screenshot base64).
      // Once this enters the history, every subsequent API call fails because
      // the full history is resent. Recover by terminating the session.
      if (err.includes('image cannot be empty') || err.includes('image.source.base64')) {
        console.warn('[Chat] Detected poisoned conversation history — terminating session')
        showErrorToast('Screenshot data corrupted the conversation. Starting a fresh session.', { id: 'agent-error' })
        if (context.runtimeSessionId) {
          void localAgent.terminateSession(context.runtimeSessionId)
        } else {
          void localAgent.terminate()
        }
        setSessionMessages(targetSessionKey, (prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content:
              "The previous session had a corrupted screenshot in its history. I've started a fresh session — please resend your message.",
            parts: [
              {
                type: 'text',
                text: "The previous session had a corrupted screenshot in its history. I've started a fresh session — please resend your message.",
              },
            ],
            createdAt: new Date().toISOString(),
          },
        ])
        setSessionRuntimeSessionId(targetSessionKey, null)
        setSessionResumeProvider(targetSessionKey, null)
        if (targetSessionKey !== DRAFT_SESSION_KEY) {
          persistRuntimeSessionId(targetSessionKey, null, null)
        }
        if (targetSessionKey === activeSessionKey) {
          hideReconnectNotice()
        }
        setSessionStreaming(targetSessionKey, false)
        return
      }

      setSessionError(targetSessionKey, err)
      setSessionResuming(targetSessionKey, false)
      setSessionStreaming(targetSessionKey, false)
      setSessionRuntimeSessionId(targetSessionKey, null)
      if (targetSessionKey !== DRAFT_SESSION_KEY) {
        const providerSessionId = sessionViewStatesRef.current[targetSessionKey]?.providerSessionId ?? null
        persistRuntimeSessionId(targetSessionKey, null, providerSessionId)
      }
      showErrorToast(err, { id: 'agent-error' })

      // If this is a Claude auth error, mark Claude as not authenticated
      if (isClaudeAuthError(err)) {
        console.log('[Chat] Claude auth error detected, marking as not authenticated')
        setProviderAuthStatus((prev) => {
          if (prev.claude === false) return prev
          // Also mark in global store so Connected Accounts page shows correct status
          providerAuthStore.markAuthInvalidated('anthropic')
          return { ...prev, claude: false }
        })
      }
    },
    onComplete: (context) => {
      const targetSessionKey = resolveCallbackTargetSessionKey(context.runtimeSessionId)
      if (context.runtimeSessionId) {
        suppressedCompletionGateRuntimeIdsRef.current.delete(context.runtimeSessionId)
      }
      console.log('[Chat] Local agent completed', {
        runtimeSessionId: context.runtimeSessionId,
        targetSessionKey,
      })
      if (targetSessionKey === activeSessionKey) {
        hideReconnectNotice()
      }
      setSessionResuming(targetSessionKey, false)
      setSessionStreaming(targetSessionKey, false)
      setSessionRuntimeSessionId(targetSessionKey, null)
      if (targetSessionKey !== DRAFT_SESSION_KEY) {
        const providerSessionId = sessionViewStatesRef.current[targetSessionKey]?.providerSessionId ?? null
        persistRuntimeSessionId(targetSessionKey, null, providerSessionId)
      }
      // Session is automatically persisted by the CLI tools (Claude/Codex)
      // No need to manually persist to database
    },
  })

  useEffect(() => {
    reconnectToSessionRef.current = localAgent.reconnectToSession
  }, [localAgent.reconnectToSession])

  useEffect(() => {
    if (!hasLoadedSessionCatalog) return

    for (const session of allSessions) {
      if (!session.runtimeSessionId) continue
      if (session.sessionId === selectedSessionId) continue

      const sessionState = getStoredSessionViewState(session.sessionId)
      void localAgent.watchSession(session.runtimeSessionId, sessionState.runtimeLastSeq)
    }
  }, [allSessions, getStoredSessionViewState, hasLoadedSessionCatalog, localAgent.watchSession, selectedSessionId])

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [])

  // Auto-start stream for newly created projects with initial prompt
  useEffect(() => {
    // Only auto-start if explicitly enabled (new project creation)
    if (!autoStart) {
      return
    }

    // Prevent duplicate execution (React StrictMode runs effects twice)
    if (hasStartedInitialStream.current) {
      console.log('[Chat] Initial stream already started, skipping')
      return
    }

    if (!(messages.length === 1 && messages[0].role === 'user')) {
      console.log('[Chat] Auto-start still pending but no single initial user draft is available', {
        messageCount: messages.length,
        firstRole: messages[0]?.role ?? null,
      })
      return
    }

    if (!usableProjectPath) {
      console.log('[Chat] Auto-start pending; waiting for usable project path', {
        activeSessionKey,
        messageCount: messages.length,
        rawProjectPath: projectPath,
      })
      return
    }

    if (messages.length === 1 && messages[0].role === 'user' && usableProjectPath) {
      // Get message content - prefer content field, fallback to parts[0].text
      const initialMessage = messages[0]
      const messageContent =
        initialMessage.content ||
        (initialMessage.parts?.[0] && 'text' in initialMessage.parts[0] ? initialMessage.parts[0].text : undefined)

      console.log('[Chat] Initial message:', {
        id: initialMessage.id,
        role: initialMessage.role,
        content: initialMessage.content,
        hasContent: !!initialMessage.content,
        parts: initialMessage.parts,
        extractedContent: messageContent,
        projectPath: usableProjectPath,
      })

      if (!messageContent) {
        console.error('[Chat] Cannot start stream: message content is undefined')
        setError('Unable to start AI: message content is missing')
        return
      }

      // Mark as started before async operation
      hasStartedInitialStream.current = true

      const startInitialStream = async () => {
        console.log('[Chat] Starting initial stream for new project:', {
          message: messageContent.substring(0, 100),
          projectPath: usableProjectPath,
          hasInitialImages: !!initialImages?.length,
        })
        activeStreamSessionKeyRef.current = activeSessionKey
        setIsResumingSession(false)
        setIsStreaming(true)

        let fullPrompt = messageContent
        const initialImageParts: MessagePart[] = []

        // If there are initial images, save them and append paths to prompt
        if (initialImages && initialImages.length > 0) {
          console.log('[Chat] Processing', initialImages.length, 'initial images')
          const attachmentPaths: string[] = []

          for (let i = 0; i < initialImages.length; i++) {
            const imageData = initialImages[i]
            console.log('[Chat] Saving initial image', i, ':', imageData.filename)

            // Add image part for display
            initialImageParts.push({
              type: 'image',
              url: imageData.base64,
              mediaType: imageData.type,
              filename: imageData.filename,
            })

            try {
              const filePath = await projectFiles.saveAttachment(imageData.filename, imageData.base64)
              console.log('[Chat] Saved initial image to:', filePath)
              attachmentPaths.push(filePath)
            } catch (err) {
              console.error('[Chat] Failed to save initial image:', err)
            }
          }

          // Update the initial message to include image parts for display
          if (initialImageParts.length > 0) {
            setMessages((prev) => {
              if (prev.length === 0) return prev
              const updated = [...prev]
              const firstMsg = { ...updated[0] }
              firstMsg.parts = [...(firstMsg.parts || []), ...initialImageParts]
              updated[0] = firstMsg
              return updated
            })
          }

          if (attachmentPaths.length > 0 && usableProjectPath) {
            const attachmentText =
              '\n\n[Attachments: ' + attachmentPaths.map((p) => p.replace(usableProjectPath, '.')).join(', ') + ']'
            fullPrompt = messageContent + attachmentText
            console.log('[Chat] Full prompt with attachments:', fullPrompt.substring(0, 200))
          }
        }

        try {
          const promptToSend = shouldForceFrontendDesignForCurrentSession()
            ? withFrontendDesignSkillPrompt(fullPrompt)
            : fullPrompt
          await localAgent.sendPrompt(promptToSend, {
            id: initialMessage.id,
            role: 'user',
            content: initialMessage.content || messageContent,
            parts: [...(initialMessage.parts || []), ...initialImageParts] as Record<string, unknown>[],
            createdAt: initialMessage.createdAt || new Date().toISOString(),
          })
        } catch (err) {
          console.error('[Chat] Failed to start initial stream:', err)
          const errorMsg = err instanceof Error ? err.message : 'Failed to start stream'
          setError(errorMsg)
          setIsStreaming(false)
          showErrorToast(errorMsg, { id: 'stream-error' })
        }
      }
      startInitialStream()
    }
  }, [
    activeSessionKey,
    autoStart,
    messages.length,
    usableProjectPath,
    initialImages,
    localAgent.sendPrompt,
    shouldForceFrontendDesignForCurrentSession,
  ]) // Include sendPrompt to avoid stale closure

  // Update workbench store streaming status
  useEffect(() => {
    workbenchStore.setChatStreaming(isStreaming)
  }, [isStreaming])

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments: ImageAttachment[] = [],
      options?: { hideUserMessage?: boolean; forceFrontendDesignSkill?: boolean }
    ) => {
      console.log('[Chat] handleSubmit called with:', text.substring(0, 100), 'attachments:', attachments.length)

      const hasContent = text.trim().length > 0 || attachments.length > 0
      if (!hasContent || isStreaming) {
        console.log('[Chat] handleSubmit returning early:', { isEmpty: !hasContent, isStreaming })
        return
      }

      // Ensure we have a valid project path before sending prompts
      if (!usableProjectPath) {
        console.error('[Chat] Cannot send prompt: project path not set')
        setError('Project not ready. Please wait for the project to sync.')
        return
      }

      setError(null)
      scrollToBottom()

      // Save files before sending
      await workbenchStore.saveAllFiles()

      // Save attachments and get their file paths
      let attachmentText = ''
      if (attachments.length > 0) {
        console.log('[DEBUG-IMG] Processing', attachments.length, 'attachments')
      }

      if (attachments.length > 0) {
        const attachmentPaths: string[] = []
        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i]
          // FileUIPart format: type, mediaType, filename, url (data URL)
          if (attachment.type !== 'file') continue

          const filename = attachment.filename || `attachment-${i}.png`
          console.log('[DEBUG-IMG] Processing attachment', i, ':', filename, 'mediaType:', attachment.mediaType)

          try {
            // attachment.url is already a base64 data URL
            console.log(
              '[DEBUG-IMG] Data URL length:',
              attachment.url.length,
              'chars, starts with:',
              attachment.url.substring(0, 50)
            )

            const filePath = await projectFiles.saveAttachment(filename, attachment.url)
            console.log('[DEBUG-IMG] Saved attachment to:', filePath)
            attachmentPaths.push(filePath)
          } catch (err) {
            console.error('[DEBUG-IMG] Failed to save attachment:', err)
          }
        }

        if (attachmentPaths.length > 0) {
          attachmentText =
            '\n\n[Attachments: ' + attachmentPaths.map((p) => p.replace(usableProjectPath, '.')).join(', ') + ']'
          console.log('[DEBUG-IMG] Attachment text to append:', attachmentText)
        }
      }

      const fullPrompt = text + attachmentText
      const forceFrontendDesignSkill = options?.forceFrontendDesignSkill ?? shouldForceFrontendDesignForCurrentSession()
      console.log(
        '[DEBUG-IMG] Full prompt length:',
        fullPrompt.length,
        'final prompt:',
        fullPrompt.substring(0, 200) + (fullPrompt.length > 200 ? '...' : '')
      )

      console.log('[Chat] LOCAL MODE - Using provider:', provider, 'CWD:', usableProjectPath)
      console.log('[Chat] Calling localAgent.sendPrompt...')

      // Build message parts: text + any image attachments
      const messageParts: MessagePart[] = []
      if (text) {
        messageParts.push({ type: 'text', text })
      }
      // Add image attachments as parts for display
      for (const attachment of attachments) {
        if (attachment.type === 'file' && attachment.mediaType?.startsWith('image/')) {
          messageParts.push({
            type: 'image',
            url: attachment.url,
            mediaType: attachment.mediaType,
            filename: attachment.filename,
          })
        }
      }

      // Add user message
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: text,
        parts: messageParts,
        createdAt: new Date().toISOString(),
      }

      const hideUserMessage = options?.hideUserMessage === true
      if (!hideUserMessage) {
        // Intercept Firebase-related prompts when Firebase is not provisioned and secrets are not configured
        if (
          /\bfirebase\b/i.test(text) &&
          !projectHasFirebase &&
          !firebaseProvisioned &&
          !hasIntegrationSecrets.firebase &&
          !/\/add-firebase\b/i.test(text)
        ) {
          setMessages((prev) =>
            appendSetupPromptIfMissing([...prev, userMessage], 'firebase-setup-prompt', {
              integrationId: 'firebase',
              originalPrompt: fullPrompt,
              forceFrontendDesignSkill,
            })
          )
          setInput('')
          return
        }

        if (text.includes('/convex-auth') && !convexSecretStatus.isConfigured) {
          const requiredConvexKeys = [convexSecretStatus.urlKey, 'CONVEX_DEPLOY_KEY']
          const guidanceText =
            `Convex Better Auth setup requires ${requiredConvexKeys.join(' + ')} ` +
            'in Project Settings -> Development Variables.'
          const guidanceMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: guidanceText,
            parts: [{ type: 'text', text: guidanceText }],
            createdAt: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, userMessage, guidanceMessage])
          setInput('')
          return
        }

        // Intercept Convex-related prompts when Convex is not provisioned and secrets are not configured
        if (/\bconvex\b/i.test(text) && convexStage === 'disconnected' && !/\/convex-auth\b/i.test(text)) {
          setMessages((prev) =>
            appendSetupPromptIfMissing([...prev, userMessage], 'convex-setup-prompt', {
              integrationId: 'convex',
              originalPrompt: fullPrompt,
              forceFrontendDesignSkill,
            })
          )
          setInput('')
          return
        }

        // Intercept Stripe-related prompts when Stripe is not provisioned and secrets are not configured
        if (
          /\bstripe\b/i.test(text) &&
          !projectHasStripe &&
          !hasIntegrationSecrets.stripe &&
          !/\/add-stripe\b/i.test(text)
        ) {
          setMessages((prev) =>
            appendSetupPromptIfMissing([...prev, userMessage], 'stripe-setup-prompt', {
              integrationId: 'stripe',
              originalPrompt: fullPrompt,
              forceFrontendDesignSkill,
            })
          )
          setInput('')
          return
        }

        // Intercept RevenueCat-related prompts when RevenueCat is not provisioned and secrets are not configured
        if (
          /\brevenue\s*cat\b/i.test(text) &&
          !projectHasRevenuecat &&
          !revenuecatProvisioned &&
          !hasIntegrationSecrets.revenuecat &&
          !/\/add-revenuecat\b/i.test(text)
        ) {
          setMessages((prev) =>
            appendSetupPromptIfMissing([...prev, userMessage], 'revenuecat-setup-prompt', {
              integrationId: 'revenuecat',
              originalPrompt: fullPrompt,
              forceFrontendDesignSkill,
            })
          )
          setInput('')
          return
        }

        setMessages((prev) => [...prev, userMessage])
      }
      activeStreamSessionKeyRef.current = activeSessionKey
      setIsResumingSession(false)
      setIsStreaming(true)

      try {
        const isDraftSession = selectedSessionId === null
        const shouldForceFreshRuntime =
          isDraftSession || (selectedSessionId !== null && !agentSessionId && !!resumeProviderSessionId)
        if (shouldForceFreshRuntime) {
          if (selectedSessionId !== null) {
            pendingSessionPromotionRef.current = {
              stableSessionId: selectedSessionId,
              provider,
            }
          } else {
            pendingSessionPromotionRef.current = null
          }
        } else if (isDraftSession) {
          pendingSessionPromotionRef.current = null
        }
        console.log('[Chat] Submitting prompt with session context', {
          selectedSessionId,
          agentSessionId,
          resumeProviderSessionId,
          provider,
          isDraftSession,
          shouldForceFreshRuntime,
        })
        console.log('[Chat] About to call localAgent.sendPrompt')
        const promptToSend = forceFrontendDesignSkill ? withFrontendDesignSkillPrompt(fullPrompt) : fullPrompt
        await localAgent.sendPrompt(
          promptToSend,
          hideUserMessage
            ? undefined
            : {
                id: userMessage.id,
                role: 'user',
                content: userMessage.content,
                parts: (userMessage.parts || []) as Record<string, unknown>[],
                createdAt: userMessage.createdAt || new Date().toISOString(),
              },
          {
            forceNewSession: shouldForceFreshRuntime,
            retryConflictWithFreshSession: shouldForceFreshRuntime,
          }
        )
        console.log('[Chat] localAgent.sendPrompt completed')
      } catch (err) {
        console.error('[Chat] Local agent error:', err)
        const errorMsg = err instanceof Error ? err.message : 'Local agent error'
        setError(errorMsg)
        setIsStreaming(false)
        setIsRevenueCatSettingUp(false)
        showErrorToast(errorMsg, { id: 'agent-error' })
      }

      setInput('')
    },
    [
      activeSessionKey,
      isStreaming,
      provider,
      localAgent,
      scrollToBottom,
      usableProjectPath,
      convexStage,
      convexSecretStatus,
      projectHasFirebase,
      firebaseProvisioned,
      hasIntegrationSecrets.firebase,
      projectHasStripe,
      hasIntegrationSecrets.stripe,
      projectHasRevenuecat,
      revenuecatProvisioned,
      hasIntegrationSecrets.revenuecat,
      shouldForceFrontendDesignForCurrentSession,
      selectedSessionId,
      agentSessionId,
      resumeProviderSessionId,
    ]
  )

  const handleIntegrationSkip = useCallback(
    async (integrationId: string, originalPrompt?: string, forceFrontendDesignSkill?: boolean, messageId?: string) => {
      if (isStreaming) return

      if (!originalPrompt) {
        setError('Could not recover the original prompt. Please resend it.')
        return
      }

      const setupPromptType = SETUP_PROMPT_BY_INTEGRATION[integrationId]

      if (messageId && setupPromptType) {
        setMessages((prev) =>
          prev.flatMap((message) => {
            if (message.id !== messageId || message.role !== 'assistant') return [message]

            const filteredParts = (message.parts || []).filter((part) => part?.type !== setupPromptType)
            if (filteredParts.length === 0 && !message.content) {
              return []
            }

            return [{ ...message, parts: filteredParts }]
          })
        )
      }

      await handleSubmit(originalPrompt, [], {
        hideUserMessage: true,
        forceFrontendDesignSkill,
      })
    },
    [handleSubmit, isStreaming]
  )

  // Keep submitRef in sync so handleIntegrationUse can auto-submit
  submitRef.current = handleSubmit

  const handleStop = useCallback(async () => {
    console.log('[Chat] Stopping agent')
    if (agentSessionId) {
      suppressedCompletionGateRuntimeIdsRef.current.add(agentSessionId)
      console.log('[Chat] Suppressing completion verification follow-up for manually stopped runtime', {
        runtimeSessionId: agentSessionId,
        activeSessionKey,
      })
    }
    await localAgent.stop()
    hideReconnectNotice()
    setIsResumingSession(false)
    setIsStreaming(false)
  }, [activeSessionKey, agentSessionId, hideReconnectNotice, localAgent])

  // Handle session switching - load a different session from CLI storage
  const handleSelectSession = useCallback(
    async (session: LocalSessionInfo) => {
      if (!usableProjectPath || session.sessionId === selectedSessionId) return

      console.log('[Chat] Switching to session:', session.sessionId)

      // Detach from current session (keeps it running in background)
      setSessionTransportAttached(activeSessionKey, false)
      await localAgent.detach()

      // Prevent session restoration effects from undoing this action
      didStartNewSession.current = true
      suppressInitialSessionRestore.current = false

      // Keep the selected tab stable even if we are not attached to a live sidecar session yet.
      setSelectedSessionId(session.sessionId)
      activeStreamSessionKeyRef.current = session.sessionId
      updateSessionViewState(session.sessionId, (prev) => ({
        ...prev,
        provider: (session.provider || provider) as ProviderId,
        isAttachedToTransport: false,
        error: null,
        isResumingSession: false,
      }))
      hideReconnectNotice()

      // Restore provider from session (if available)
      if (session.provider) {
        setProvider(session.provider)
      }

      onSessionIdChange?.(session.sessionId, (session.provider || provider) as 'claude' | 'codex')

      // Update lastUsedAt in projects.json (using mutation)
      updateSessionMutation.mutate(session.sessionId, {
        lastUsedAt: new Date().toISOString(),
      })

      const cachedSessionState = getStoredSessionViewState(session.sessionId)
      if (cachedSessionState.isHydrated) {
        console.log('[Chat] Reusing hydrated session state on tab switch before reconcile', {
          stableSessionId: session.sessionId,
          messageCount: cachedSessionState.messages.length,
          runtimeSessionId: cachedSessionState.runtimeSessionId,
          providerSessionId: cachedSessionState.providerSessionId,
          needsRefresh: cachedSessionState.needsRefresh,
        })
      }

      await reconcileSessionState(session.sessionId, (session.provider || provider) as ProviderId, {
        preserveInitialUserMessage: shouldPreserveInitialUserMessage(session.sessionId),
        persistedRuntimeSessionId: session.runtimeSessionId ?? cachedSessionState.runtimeSessionId ?? null,
        logContext: 'tab-switch',
      })
    },
    [
      usableProjectPath,
      selectedSessionId,
      hideReconnectNotice,
      localAgent,
      onSessionIdChange,
      provider,
      reconcileSessionState,
      setSessionLoading,
      setSessionTransportAttached,
      shouldPreserveInitialUserMessage,
      updateSessionMutation,
      updateSessionViewState,
    ]
  )

  // Handle session deletion - remove from projects.json
  const handleDeleteSession = useCallback(
    async (session: LocalSessionInfo) => {
      console.log('[Chat] Deleting session:', session.sessionId)

      const remainingSessions = allSessions.filter((candidate) => candidate.sessionId !== session.sessionId)
      console.log('[Chat] Delete session candidate state', {
        sessionId: session.sessionId,
        selectedSessionId,
        remainingSessionIds: remainingSessions.map((candidate) => candidate.sessionId),
      })

      // Delete session using mutation (handles refresh automatically)
      try {
        await deleteSessionMutation.mutate(session.sessionId)
      } catch (error) {
        console.error('[Chat] Delete session failed; keeping local session state intact', {
          sessionId: session.sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }

      console.log('[Chat] Delete session succeeded; pruning local session state', {
        sessionId: session.sessionId,
      })
      projectSessionsStore.deleteSessionState(projectId, session.sessionId, provider)

      // If we deleted the active session, switch to adjacent or clear
      if (session.sessionId === selectedSessionId) {
        // Find adjacent session to switch to
        const currentIndex = allSessions.findIndex((s) => s.sessionId === session.sessionId)
        const adjacentSession = remainingSessions[currentIndex] || remainingSessions[currentIndex - 1]
        console.log('[Chat] Resolving next session after delete', {
          deletedSessionId: session.sessionId,
          currentIndex,
          adjacentSessionId: adjacentSession?.sessionId ?? null,
        })

        if (adjacentSession) {
          // Switch to adjacent session
          handleSelectSession(adjacentSession)
        } else {
          // No other sessions, start fresh
          setSelectedSessionId(null)
          activeStreamSessionKeyRef.current = DRAFT_SESSION_KEY
          replaceSessionViewState(DRAFT_SESSION_KEY, createSessionViewState(provider))
        }
      }
    },
    [
      allSessions,
      deleteSessionMutation,
      handleSelectSession,
      projectId,
      provider,
      replaceSessionViewState,
      selectedSessionId,
    ]
  )

  // Handle creating a new session (with optional provider/model selection)
  const handleNewSession = useCallback(
    async (providerId?: 'claude' | 'codex', modelId?: string) => {
      const nextProvider = providerId || defaultProvider
      const nextModel = modelId || DEFAULT_MODEL_BY_AGENT_PROVIDER[nextProvider]
      console.log('[Chat] Creating new session', {
        providerId: nextProvider,
        modelId: nextModel,
        previousSessionId: agentSessionId,
        previousMessagesCount: messagesRef.current.length,
      })

      // Detach from the current session - agent continues running in background
      // Do NOT call stop() here: that would kill the CLI process, preventing reconnect
      setSessionTransportAttached(activeSessionKey, false)
      await localAgent.detach()

      // Prevent session restoration effects from undoing this action
      didStartNewSession.current = true
      suppressInitialSessionRestore.current = true

      // Starting from tab "+" optionally sets provider/model for the next session
      setProvider(nextProvider)
      setSelectedModel(nextModel)

      // Clear messages completely - each session tab is its own context
      replaceSessionViewState(DRAFT_SESSION_KEY, createSessionViewState(nextProvider))

      // Reset session and error state
      activeStreamSessionKeyRef.current = DRAFT_SESSION_KEY
      hideReconnectNotice()
      setSelectedSessionId(null)
      console.log('[Chat] New session state reset complete', {
        providerId: nextProvider,
        modelId: nextModel,
        previousSessionId: agentSessionId,
      })

      // Reset refs so we don't try to load the old session
      hasLoadedSession.current = false
      initialSessionIdAtMount.current = null
      hasStartedInitialStream.current = false
    },
    [
      activeSessionKey,
      defaultProvider,
      hideReconnectNotice,
      localAgent,
      replaceSessionViewState,
      setSessionTransportAttached,
    ]
  )

  // Handle fix error - submit error to AI for fixing
  const handleFixError = useCallback(() => {
    if (!promptError) return
    const errorPrompt = `Please fix the following error:\n\n\`\`\`\n${promptError}\n\`\`\``
    handleSubmit(errorPrompt)
    workbenchStore.clearPromptError()
  }, [promptError, handleSubmit])

  const composerPlaceholder = !isWorkspaceReady
    ? 'Waiting for workspace...'
    : isStreaming
      ? isResumingSession
        ? 'Resuming active agent session...'
        : 'Agent is working in this session...'
      : 'Describe what you want to build...'

  // Handle dismiss error
  const handleDismissError = useCallback(() => {
    workbenchStore.clearPromptError()
  }, [])

  // Watch for pending prompts from external components (e.g., deployment)
  const pendingPromptRequest = useStore(workbenchStore.pendingPrompt)
  const pendingCommitMessageDraftRequest = useStore(workbenchStore.pendingCommitMessageDraftRequest)
  useEffect(() => {
    if (!pendingIntegrationChoice || pendingIntegrationChoice.integrationId !== 'convex') {
      return
    }

    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1]
      const isDuplicatePrompt =
        lastMessage?.role === 'assistant' && !!lastMessage.parts?.some((part) => part?.type === 'convex-intent-prompt')

      if (isDuplicatePrompt) {
        return prev
      }

      const guidanceMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        parts: [{ type: 'convex-intent-prompt' } as MessagePart],
        createdAt: new Date().toISOString(),
      }

      return [...prev, guidanceMessage]
    })
    workbenchStore.clearPendingIntegrationChoice()
  }, [pendingIntegrationChoice])

  useEffect(() => {
    if (!pendingConvexAuthAfterSetup) return
    if (isStreaming) return
    let cancelled = false

    const triggerConvexAuth = () => {
      if (cancelled) return
      setPendingConvexAuthAfterSetup(false)
      toast.success('Convex setup complete. Starting auth setup...')
      workbenchStore.triggerChatPrompt(CONVEX_AUTH_PROMPT, { integrationId: 'convex' })
    }

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const waitForConvexBootstrap = async () => {
      if (convexBootstrapDetected) {
        triggerConvexAuth()
        return
      }

      const deadline = Date.now() + 120_000
      while (!cancelled && Date.now() < deadline) {
        try {
          await projectStore.refreshFileTree()
        } catch (error) {
          console.warn('[Chat] Convex bootstrap refresh failed:', error)
        }

        if (cancelled) return

        const latestFiles = workbenchStore.files.getState()
        const latestTree = projectStore.fileTreeArray.getState()
        if (detectConvexBootstrap(latestFiles) || detectConvexBootstrapInTree(latestTree)) {
          triggerConvexAuth()
          return
        }

        await sleep(1000)
      }

      if (!cancelled) {
        console.warn('[Chat] Convex bootstrap not detected within fallback window')
      }
    }

    waitForConvexBootstrap()
    return () => {
      cancelled = true
    }
  }, [pendingConvexAuthAfterSetup, isStreaming, convexBootstrapDetected])

  useEffect(() => {
    const pendingPrompt = pendingPromptRequest?.prompt
    console.log('[Chat] pendingPrompt effect fired', {
      hasPendingPrompt: !!pendingPrompt,
      isStreaming,
      hasProjectPath: !!usableProjectPath,
      pendingPrompt: pendingPrompt?.substring(0, 100),
    })

    if (!pendingPromptRequest || !pendingPrompt || isStreaming || !usableProjectPath) {
      console.log('[Chat] Not sending pending prompt, conditions:', {
        hasPrompt: !!pendingPrompt,
        isStreaming,
        hasProjectPath: !!usableProjectPath,
      })
      return
    }

    const requestId = pendingPromptRequest.id
    if (activePendingPromptIdRef.current === requestId) {
      return
    }
    activePendingPromptIdRef.current = requestId

    const run = async () => {
      console.log('[Chat] Sending pending prompt:', pendingPrompt)
      const isFirebasePrompt =
        pendingPromptRequest.integrationId === 'firebase' || /\/add-firebase\b/i.test(pendingPrompt)
      const isStripePrompt = pendingPromptRequest.integrationId === 'stripe' || /\/add-stripe\b/i.test(pendingPrompt)
      const isRevenueCatPrompt =
        pendingPromptRequest.integrationId === 'revenuecat' || /\/add-revenuecat\b/i.test(pendingPrompt)

      if (isFirebasePrompt) {
        setIsFirebaseSettingUp(true)
      }
      if (isStripePrompt) {
        setIsStripeSettingUp(true)
      }
      if (isRevenueCatPrompt) {
        setIsRevenueCatSettingUp(true)
      }

      try {
        if (/\/convex-auth\b/i.test(pendingPrompt) || /\/convex-setup\b/i.test(pendingPrompt)) {
          if (!convexSecretStatus.isConfigured) {
            workbenchStore.setActiveTab('settings')
            workbenchStore.setPendingIntegrationConnect({
              integrationId: 'convex',
              source: 'chat',
            })
            return
          }

          const pendingEnvVars = getConvexEnvVarsForSession(convexSecretStatus)
          if (Object.keys(pendingEnvVars).length > 0) {
            workbenchStore.mergePendingEnvVars(pendingEnvVars)
          }
          setConvexProvisioned(true)
        }

        if (/\/add-firebase\b/i.test(pendingPrompt)) {
          setFirebaseProvisioned(true)
        }

        if (
          pendingPromptRequest.waitForSecrets &&
          pendingPromptRequest.projectId &&
          pendingPromptRequest.requiredSecretKeys &&
          pendingPromptRequest.requiredSecretKeys.length > 0
        ) {
          const resolvedSecrets = await waitForRequiredSecrets(
            pendingPromptRequest.projectId,
            pendingPromptRequest.requiredSecretKeys,
            pendingPromptRequest.timeoutMs ?? 8000
          )

          if (activePendingPromptIdRef.current !== requestId) {
            return
          }

          if (!resolvedSecrets) {
            const requiredKeysText = pendingPromptRequest.requiredSecretKeys.join(', ')
            showErrorToast(`Setup paused: required secret(s) not readable in time (${requiredKeysText}).`)
            return
          }

          const envFromSecrets: Record<string, string> = {}
          for (const key of pendingPromptRequest.requiredSecretKeys) {
            const match = resolvedSecrets.find((secret) => secret.key === key)
            const value = match?.value?.trim()
            if (value) {
              envFromSecrets[key] = value
            }
          }
          if (Object.keys(envFromSecrets).length > 0) {
            workbenchStore.mergePendingEnvVars(envFromSecrets)
          }
        }

        if (activePendingPromptIdRef.current !== requestId) {
          return
        }

        await handleSubmit(pendingPrompt, [], { hideUserMessage: pendingPromptRequest.hiddenFromUser === true })
      } catch (err) {
        console.error('[Chat] Failed to handle pending prompt:', err)
      } finally {
        if (activePendingPromptIdRef.current === requestId) {
          workbenchStore.clearPendingPrompt()
          activePendingPromptIdRef.current = null
        }
        if (isFirebasePrompt) {
          setIsFirebaseSettingUp(false)
        }
        if (isRevenueCatPrompt) {
          setIsRevenueCatSettingUp(false)
        }
        if (isStripePrompt) {
          setIsStripeSettingUp(false)
        }
      }
    }

    run()
  }, [pendingPromptRequest, isStreaming, usableProjectPath, handleSubmit, convexSecretStatus, waitForRequiredSecrets])

  useEffect(() => {
    if (!pendingCommitMessageDraftRequest || isStreaming) return

    const requestCreatedAt = pendingCommitMessageDraftRequest.createdAt
    const latestAssistantMessage = [...messages]
      .reverse()
      .find((msg) => msg.role === 'assistant' && new Date(msg.createdAt || 0).getTime() >= requestCreatedAt)

    if (!latestAssistantMessage) return

    const draft = extractCommitDraftFromMessage(latestAssistantMessage)
    if (!draft) {
      workbenchStore.resolveCommitMessageDraft(pendingCommitMessageDraftRequest.id, 'Update project changes')
      return
    }

    workbenchStore.resolveCommitMessageDraft(pendingCommitMessageDraftRequest.id, draft)
    toast.success('Commit message draft ready')
  }, [pendingCommitMessageDraftRequest, isStreaming, messages])

  // Extract todos from messages (find most recent TodoWrite)
  const todos = useMemo(() => {
    // Look through messages in reverse to find the most recent TodoWrite
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== 'assistant' || !msg.parts) continue

      // Search parts in reverse for TodoWrite
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const part = msg.parts[j]
        if (!part) continue

        const toolName =
          ((part as Record<string, unknown>).toolName as string)?.toLowerCase() ||
          part.type?.replace('tool-', '').toLowerCase()

        if (toolName === 'todowrite') {
          const args = (part as Record<string, unknown>).args as Record<string, unknown>
          if (args?.todos && Array.isArray(args.todos)) {
            return args.todos as TodoItem[]
          }
        }
      }
    }
    return null
  }, [messages])

  // Generate next-step suggestion chips based on last assistant message
  const suggestions = useMemo(() => {
    if (isStreaming) return []
    return generateSuggestions(messages)
  }, [messages, isStreaming])

  // Handle suggestion chip selection - auto-submit the prompt
  const handleSuggestionSelect = useCallback(
    (suggestion: { prompt: string }) => {
      handleSubmit(suggestion.prompt)
    },
    [handleSubmit]
  )

  // Handle AskUserQuestion submission
  const handleAskUserSubmit = useCallback(
    async (toolCallId: string, answers: Record<string, string>) => {
      console.log('[Chat] AskUserQuestion submitted:', toolCallId, answers)

      // Update the tool part in messages to mark it as answered
      setMessages((prev) => {
        return prev.map((msg) => {
          if (msg.role === 'assistant' && msg.parts) {
            const updatedParts = msg.parts.map((part) => {
              if ('toolCallId' in part && part.toolCallId === toolCallId && part.type?.includes('AskUserQuestion')) {
                return {
                  ...part,
                  state: 'result' as const,
                  result: { answers },
                  args: {
                    ...((part as Record<string, unknown>).args as Record<string, unknown>),
                    answers,
                  },
                }
              }
              return part
            })
            return { ...msg, parts: updatedParts }
          }
          return msg
        })
      })

      // Format answers as a user response and send to agent
      const formattedAnswers = Object.entries(answers)
        .map(([question, answer]) => `${question}: ${answer}`)
        .join('\n')

      const responseText = `Here are my answers:\n\n${formattedAnswers}`

      // Send as a regular message to continue the conversation
      await handleSubmit(responseText)
    },
    [handleSubmit]
  )

  // Provider options for new session dropdown
  const newSessionAgentOptions = useMemo(() => {
    return [
      { id: 'claude' as const, label: 'Claude' },
      ...(codexBetaEnabled ? [{ id: 'codex' as const, label: 'Codex' }] : []),
    ]
  }, [codexBetaEnabled])

  return (
    <div
      className="chat-container"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}
    >
      {/* Session Tabs - always visible for session management */}
      <SessionTabs
        sessions={allSessions}
        activeSessionId={selectedSessionId}
        newSessionAgentOptions={newSessionAgentOptions}
        selectedNewSessionProviderId={defaultProvider as 'claude' | 'codex'}
        selectedNewSessionModelId={DEFAULT_MODEL_BY_AGENT_PROVIDER[defaultProvider]}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
      />

      {/* Messages */}
      <div className="chat-messages" ref={scrollAreaRef} style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}>
        {isLoadingSession ? (
          <div className="chat-loading-session">
            <span className="chat-loading-spinner" />
            <span>Loading conversation...</span>
          </div>
        ) : (
          <Messages
            messages={messages}
            isStreaming={isStreaming}
            onAskUserSubmit={handleAskUserSubmit}
            onIntegrationConnect={handleIntegrationConnect}
            onIntegrationUse={handleIntegrationUse}
            onIntegrationSkip={handleIntegrationSkip}
            onConvexIntentSelect={handleConvexIntentSelect}
            onClaudeReconnect={handleClaudeReconnect}
            onClaudeAuthError={handleClaudeAuthError}
            convexStage={convexStage}
            convexMissingKey={convexSecretStatus.missingKey}
            isFirebaseConnected={integrationStatus.firebase}
            isFirebaseSettingUp={isFirebaseSettingUp}
            isStripeConnected={integrationStatus.stripe}
            isStripeSettingUp={isStripeSettingUp}
            isRevenueCatConnected={integrationStatus.revenuecat}
            isRevenueCatSettingUp={isRevenueCatSettingUp}
            isClaudeAuthenticated={providerAuthStatus.claude}
          />
        )}
        {/* Preview/Runtime Error with Fix button */}
        {promptError && !isStreaming && (
          <ErrorMessage errorMessage={promptError} onDismiss={handleDismissError} onFix={handleFixError} />
        )}
      </div>

      {/* Input */}
      <div className="chat-input-container" style={{ flexShrink: 0 }}>
        {/* Workspace loading indicator - shown when git clone/file sync in progress */}
        {!isWorkspaceReady && (
          <div className="chat-workspace-loading">
            <div className="chat-workspace-loading-content">
              <div className="chat-workspace-loading-spinner" />
              <span>Preparing workspace...</span>
            </div>
          </div>
        )}

        {/* Task Progress - shown above input when todos exist */}
        {todos && todos.length > 0 && <TaskProgress todos={todos} isStreaming={isStreaming} />}

        {showReconnectNotice && (
          <div
            style={{
              margin: '0 16px 12px',
              padding: '10px 12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.03)',
              fontSize: 13,
              color: 'rgba(255, 255, 255, 0.78)',
            }}
          >
            Reconnected to the active agent session. Output is still streaming in this tab.
          </div>
        )}

        {/* Next step suggestion chips */}
        <SuggestionChips suggestions={suggestions} onSelect={handleSuggestionSelect} />

        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onStop={handleStop}
          isStreaming={isStreaming}
          isProvisioning={isProvisioning}
          isDisabled={!isWorkspaceReady}
          placeholder={composerPlaceholder}
          showAttachment={true}
          showHint={true}
          providerSelector={{
            provider,
            onProviderChange: (p) => {
              const pid = p as ProviderId
              setProvider(pid)
              // Reset model to the provider's default to avoid passing e.g. a Claude model to Codex
              setSelectedModel(DEFAULT_MODEL_BY_AGENT_PROVIDER[pid] || '')
            },
            onModelChange: (modelId) => setSelectedModel(modelId),
            options: [
              { id: 'claude', label: 'Claude', isAuthenticated: providerAuthStatus['claude'] },
              ...(codexBetaEnabled
                ? [{ id: 'codex', label: 'Codex', isAuthenticated: providerAuthStatus['codex'] }]
                : []),
            ],
          }}
          pendingAttachment={pendingAttachment}
          onPendingAttachmentConsumed={handlePendingAttachmentConsumed}
          integrationsMenu={{
            integrations: [
              {
                id: 'firebase',
                name: 'Firebase',
                icon: <FirebaseLogo width="20" height="20" />,
                isConnected: integrationStatus.firebase,
              },
              {
                id: 'stripe',
                name: 'Stripe',
                icon: <StripeLogo width="20" height="20" />,
                isConnected: integrationStatus.stripe,
              },
              {
                id: 'revenuecat',
                name: 'RevenueCat',
                icon: <RevenueCatLogo width="20" height="20" />,
                isConnected: integrationStatus.revenuecat,
              },
              {
                id: 'convex',
                name: 'Convex',
                icon: <ConvexLogo width="20" height="20" />,
                isConnected: integrationStatus.convex,
              },
            ].filter((integration) =>
              isIntegrationAvailableForAppType(integration.id as IntegrationId, normalizedAppType)
            ),
            onConnect: handleIntegrationConnect,
            onUse: handleIntegrationUse,
          }}
        />
      </div>

      {/* Claude Re-authentication Modal */}
      <ProviderAuthModal
        open={showClaudeAuthModal}
        provider="anthropic"
        onOpenChange={setShowClaudeAuthModal}
        onComplete={handleClaudeAuthComplete}
      />
    </div>
  )
}
