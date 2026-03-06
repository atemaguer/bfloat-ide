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
import { providerAuthStore } from '@/app/stores/provider-auth'
import ConvexLogo from '@/app/components/ui/icons/convex-logo'
import RevenueCatLogo from '@/app/components/ui/icons/revenuecat-logo'
import StripeLogo from '@/app/components/ui/icons/stripe-logo'
import { isIntegrationAvailableForAppType, type IntegrationId } from '@/app/types/integrations'
import {
  detectIntegrationSecretsPresence,
  type IntegrationSecretsPresence,
} from '@/app/lib/integrations/secrets'
import {
  detectConvexBootstrap,
  detectConvexBootstrapInTree,
  getConvexEnvVarsForSession,
  getConvexSecretStatusFromSecrets,
  type ConvexIntegrationStage,
  type SecretEntry,
} from '@/app/lib/integrations/convex'
import toast from 'react-hot-toast'
import './styles.css'

const FRONTEND_DESIGN_SKILL_PREFIX =
  'Use the /frontend-design skill for this request. If the project has an established design system, preserve it and adapt within it.'
const CONVEX_SETUP_PROMPT = 'Use the /convex-setup skill to set up Convex backend integration for this project'
const CONVEX_AUTH_PROMPT = 'Use the /convex-auth skill to set up Convex Better Auth (email/password) for this project'

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
  lastModified: number
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
  // Session ID for resuming conversations (null = new session, backwards compatible with old projects)
  const [agentSessionId, setAgentSessionId] = useState<string | null>(resolvedInitialSessionId)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderId>(initialProvider || 'claude')
  const [selectedModel, setSelectedModel] = useState<string>(initialModel || 'claude-sonnet-4-20250514')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages || [])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [isProvisioning, setIsProvisioning] = useState(false)
  const [convexProvisioned, setConvexProvisioned] = useState(false)
  const [firebaseProvisioned, setFirebaseProvisioned] = useState(false)
  const [revenuecatProvisioned, setRevenuecatProvisioned] = useState(false)
  const [isStripeSettingUp, setIsStripeSettingUp] = useState(false)
  const [isRevenueCatSettingUp, setIsRevenueCatSettingUp] = useState(false)
  const [pendingConvexAuthAfterSetup, setPendingConvexAuthAfterSetup] = useState(false)
  const hasStartedInitialStream = useRef(false)
  const hasLoadedSession = useRef(false)
  // Capture the initial session ID at mount time - only this one should be loaded
  // Any session IDs received during streaming (current session) should NOT trigger a load
  const initialSessionIdAtMount = useRef(resolvedInitialSessionId)
  const usageRef = useRef<{ inputTokens: number; outputTokens: number }>({ inputTokens: 0, outputTokens: 0 })
  const submitRef = useRef<
    ((text: string, attachments?: ImageAttachment[], options?: { hideUserMessage?: boolean }) => void) | null
  >(null)
  const messagesRef = useRef<ChatMessage[]>(messages)
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

  // Keep messagesRef in sync
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // API access (direct imports from sidecar)
  const aiAgentApi = aiAgent
  const localProjectsApi = null // Not used in this component

  // Session management hooks (local-first storage in projects.json)
  // Mirrors workbench pattern but reads from projects.json instead of backend API
  console.log('[Chat] Calling useSessions with projectId:', projectId)
  const { sessions: allSessions, refresh: refreshSessions } = useSessions(projectId)
  const activeTab = useStore(workbenchStore.activeTab)
  const secretsVersion = useStore(workbenchStore.secretsVersion)
  const pendingIntegrationChoice = useStore(workbenchStore.pendingIntegrationChoice)

  // Debug: Log sessions when they change
  useEffect(() => {
    console.log('[Chat] allSessions updated:', allSessions.length, 'sessions', allSessions.map(s => s.sessionId?.slice(0, 8)))
  }, [allSessions])

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
      agentSessionId !== null ||
      didStartNewSession.current ||
      (autoStart && !hasStartedInitialStream.current)
    ) {
      return
    }

    // Select the most recent session (sessions are sorted by lastModified desc)
    const mostRecentSession = allSessions[0]
    if (mostRecentSession) {
      console.log('[Chat] Auto-selecting most recent session:', mostRecentSession.sessionId)
      setAgentSessionId(mostRecentSession.sessionId)
    }
  }, [allSessions, agentSessionId, autoStart])

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

  // Flag to prevent session restoration effects from undoing new session action
  const didStartNewSession = useRef(false)

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
    const setupPromptByIntegration: Record<string, MessagePart['type']> = {
      firebase: 'firebase-setup-prompt',
      convex: 'convex-setup-prompt',
      stripe: 'stripe-setup-prompt',
      revenuecat: 'revenuecat-setup-prompt',
    }

    const promptType = setupPromptByIntegration[id]
    workbenchStore.setActiveTab('settings')
    if (id === 'firebase' || id === 'convex' || id === 'stripe' || id === 'revenuecat') {
      workbenchStore.setPendingIntegrationConnect({
        integrationId: id as PendingIntegrationId,
        source: 'chat',
      })
    }

    if (!promptType) return

    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1]
      const isDuplicatePrompt =
        lastMessage?.role === 'assistant' && !!lastMessage.parts?.some((part) => part?.type === promptType)

      if (isDuplicatePrompt) {
        return prev
      }

      const guidanceMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        parts: [{ type: promptType } as MessagePart],
        createdAt: new Date().toISOString(),
      }

      return [...prev, guidanceMessage]
    })
  }, [])

  const handleIntegrationUse = useCallback(
    async (id: string) => {
      const prompts: Record<string, string> = {
        stripe: 'Use the /add-stripe skill to set up Stripe payments integration for this project',
        convex: CONVEX_AUTH_PROMPT,
        revenuecat: 'Use the /add-revenuecat skill to set up RevenueCat in-app purchases for this project',
      }

      if (id === 'firebase') {
        setFirebaseProvisioned(true)
      }
      if (id === 'convex') {
        if (!convexSecretStatus.isConfigured) {
          const requiredConvexKeys = [convexSecretStatus.urlKey, 'CONVEX_DEPLOY_KEY']
          const secretKeySet = new Set(projectSecrets.map((secret) => secret.key))
          const missingConvexKeys = requiredConvexKeys.filter((key) => !secretKeySet.has(key))
          toast.error(
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
        return
      }
      if (id === 'revenuecat') {
        const revenuecatApiKey = projectSecrets.find((secret) => secret.key === 'REVENUECAT_API_KEY')?.value
        const revenuecatPublicKey = projectSecrets.find((secret) => secret.key === 'EXPO_PUBLIC_REVENUECAT_API_KEY')?.value
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
        toast.error(
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

  // Load session messages from local CLI storage
  // Only loads ONCE on component mount when we have a session ID from a PREVIOUS run
  // Uses initialSessionIdAtMount ref to ensure we don't load sessions started during this component's lifecycle
  useEffect(() => {
    // Use resolvedInitialSessionId to handle both prop and fetched session
    // Update the ref if we now have a session ID (from async fetch)
    if (resolvedInitialSessionId && !initialSessionIdAtMount.current) {
      initialSessionIdAtMount.current = resolvedInitialSessionId
    }

    const sessionIdToLoad = initialSessionIdAtMount.current

    // Only load if we have a session ID at mount time and haven't already loaded
    if (!sessionIdToLoad || hasLoadedSession.current) {
      return
    }

    // Check if we already have assistant messages (fully loaded from old system)
    const hasAssistantMessages = initialMessages?.some((m) => m.role === 'assistant')
    if (hasAssistantMessages) {
      console.log('[Chat] Already have assistant messages from database, skipping session load')
      hasLoadedSession.current = true
      return
    }

    hasLoadedSession.current = true
    setIsLoadingSession(true)

    console.log('[Chat] Loading session from local storage:', {
      sessionId: sessionIdToLoad,
      provider,
      projectPath: usableProjectPath,
      initialMessagesCount: initialMessages?.length || 0,
    })

    aiAgentApi
      .readSession(sessionIdToLoad, provider, usableProjectPath || undefined)
      .then((result) => {
        if (result.success && result.session?.messages) {
          // Debug: Log detailed session info
          const messages = result.session.messages
          const textMsgs = messages.filter((m) => m.role === 'assistant' && m.blocks?.some((b) => b.type === 'text'))
          console.log('[Chat] Session loaded from storage:', {
            messageCount: messages.length,
            userMessages: messages.filter((m) => m.role === 'user').length,
            assistantMessages: messages.filter((m) => m.role === 'assistant').length,
            messagesWithTextBlocks: textMsgs.length,
            cwd: result.session.cwd,
          })

          // Debug: Log first text message if found
          if (textMsgs.length > 0) {
            const firstText = textMsgs[0]
            const textBlock = firstText.blocks?.find((b) => b.type === 'text')
            console.log('[Chat] First text message from storage:', {
              id: firstText.id,
              contentLength: firstText.content?.length || 0,
              blocksCount: firstText.blocks?.length || 0,
              firstBlockType: firstText.blocks?.[0]?.type,
              textBlockContent: textBlock?.content?.substring(0, 100) + '...',
            })
          } else {
            console.warn('[Chat] WARNING: No text messages found in loaded session!')
            // Log all assistant messages to see what blocks they have
            const assistantMsgs = messages.filter((m) => m.role === 'assistant')
            if (assistantMsgs.length > 0) {
              console.log(
                '[Chat] Assistant message block types:',
                assistantMsgs.map((m) => ({
                  id: m.id,
                  blocksCount: m.blocks?.length || 0,
                  blockTypes: m.blocks?.map((b) => b.type) || [],
                }))
              )
            }
          }

          // Convert session messages to ChatMessage format
          const chatMessages = result.session.messages.map(convertSessionMessage)

          // Debug: Log converted messages
          const convertedTextMsgs = chatMessages.filter(
            (m) => m.role === 'assistant' && m.parts?.some((p) => p.type === 'text')
          )
          console.log('[Chat] After conversion:', {
            totalMessages: chatMessages.length,
            messagesWithTextParts: convertedTextMsgs.length,
          })

          // Preserve the initial user message if the loaded session doesn't have it
          // The CLI session storage may not include the initial user prompt
          let finalMessages = chatMessages
          if (initialMessages?.length > 0 && initialMessages[0].role === 'user') {
            const hasUserMessage = chatMessages.some((m) => m.role === 'user')
            if (!hasUserMessage) {
              console.log('[Chat] Preserving initial user message not found in CLI session')
              finalMessages = [initialMessages[0], ...chatMessages]
            }
          }

          setMessages(finalMessages)
        } else {
          console.warn('[Chat] Failed to load session:', result.error)
          // Session not found is not an error - just means new session
        }
      })
      .catch((err) => {
        console.error('[Chat] Error loading session:', err)
      })
      .finally(() => {
        setIsLoadingSession(false)
      })
    // Note: Also depends on resolvedInitialSessionId to handle async session fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAgentApi, resolvedInitialSessionId, usableProjectPath])

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
      return agentSessionId === null
    }
    return agentSessionId === forcedSessionId
  }, [agentSessionId])

  // Handle session ID changes - update local state and persist to projects.json
  // For local-first mode, sessions are stored in ~/.bfloat-ide/projects.json
  const handleSessionIdChange = useCallback(
    (sessionId: string) => {
      console.log('[Chat] ========================================')
      console.log('[Chat] NEW AGENT SESSION ID RECEIVED:', sessionId)
      console.log('[Chat] Provider:', provider)
      console.log('[Chat] ========================================')

      if (isNewProjectAtMount.current && forcedFrontendDesignSessionIdRef.current === null) {
        forcedFrontendDesignSessionIdRef.current = sessionId
      }

      setAgentSessionId(sessionId)

      // Mark session as loaded so the load-session effect won't re-run
      hasLoadedSession.current = true

      // Save session to projects.json (mutation handles refresh automatically)
      saveSessionMutation.mutate({
        sessionId,
        provider: provider as 'claude' | 'codex',
      })

      // Notify parent if callback provided
      onSessionIdChange?.(sessionId, provider as 'claude' | 'codex')
    },
    [onSessionIdChange, provider, selectedModel, saveSessionMutation]
  )

  // Compute system prompt (exploration + suggestions for new sessions, suggestions-only for resumed)
  const systemPrompt = useMemo(() => {
    return getSystemPrompt(!!agentSessionId)
  }, [agentSessionId])

  // Local agent hook - only use path when it belongs to this project
  const localAgent = useLocalAgent({
    cwd: usableProjectPath || '',
    provider,
    model: selectedModel,
    projectId, // Project ID for background session tracking
    systemPrompt, // System prompt for project exploration (new sessions only)
    resumeSessionId: agentSessionId, // Resume from previous session if available
    onSessionId: handleSessionIdChange, // Capture session ID from init message
    onMessage: (msg) => {
      console.log('[Chat] Local agent message:', msg.type, msg.content)

      if (msg.type === 'text') {
        const textContent = msg.content as string

        // Detect poisoned conversation history — the SDK may emit the API error
        // as assistant text rather than throwing.
        if (
          textContent?.includes('image cannot be empty') ||
          textContent?.includes('image.source.base64')
        ) {
          console.warn('[Chat] Detected poisoned conversation history (empty screenshot base64) in message stream')
          toast.error('Screenshot issue detected. Starting a fresh session.', { id: 'agent-error' })
          localAgent.terminate()
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: 'A corrupted screenshot was in the conversation history. I\'ve started a fresh session — please resend your message.',
              parts: [{ type: 'text', text: 'A corrupted screenshot was in the conversation history. I\'ve started a fresh session — please resend your message.' }],
              createdAt: new Date().toISOString(),
            },
          ])
          setAgentSessionId(null)
          setIsStreaming(false)
          return
        }

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            // Append text to last assistant message
            const existingParts = lastMsg.parts || []
            const lastPart = existingParts[existingParts.length - 1]

            // If last part is text, append to it; otherwise add new text part
            let newParts
            if (lastPart && lastPart.type === 'text' && 'text' in lastPart) {
              newParts = [
                ...existingParts.slice(0, -1),
                { type: 'text' as const, text: (lastPart.text || '') + textContent },
              ]
            } else {
              newParts = [...existingParts, { type: 'text' as const, text: textContent }]
            }

            return [
              ...prev.slice(0, -1),
              {
                ...lastMsg,
                content: (lastMsg.content || '') + textContent,
                parts: newParts,
              },
            ]
          } else {
            // Create new assistant message
            return [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: textContent,
                parts: [{ type: 'text', text: textContent }],
                createdAt: new Date().toISOString(),
              },
            ]
          }
        })
      } else if (msg.type === 'tool_call') {
        // Convert to AI SDK tool part format
        const toolContent = msg.content as {
          id: string
          name: string
          input: Record<string, unknown>
          status?: string
          output?: string
        }
        console.log('[Chat] Tool call:', toolContent.name, toolContent.input)

        const toolPart = {
          type: `tool-${toolContent.name}` as string,
          toolCallId: toolContent.id || generateId(),
          toolName: toolContent.name,
          state: (toolContent.status === 'completed' ? 'result' : 'call') as 'call' | 'result',
          args: toolContent.input,
          result: toolContent.output,
        }

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            // Add tool part to existing assistant message
            const existingParts = lastMsg.parts || []
            return [
              ...prev.slice(0, -1),
              {
                ...lastMsg,
                parts: [...existingParts, toolPart],
              },
            ]
          } else {
            // Create new assistant message with tool part
            return [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: '',
                parts: [toolPart],
                createdAt: new Date().toISOString(),
              },
            ]
          }
        })
      } else if (msg.type === 'tool_result') {
        // Update existing tool part with result
        const resultContent = msg.content as { callId: string; name: string; output: string; isError: boolean }
        console.log('[Chat] Tool result:', resultContent.callId, resultContent.isError ? 'ERROR' : 'SUCCESS')

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.parts) {
            // Find and update the matching tool part
            const updatedParts = lastMsg.parts.map((part) => {
              if ('toolCallId' in part && part.toolCallId === resultContent.callId) {
                return {
                  ...part,
                  state: 'result' as const,
                  result: resultContent.output,
                }
              }
              return part
            })
            return [
              ...prev.slice(0, -1),
              {
                ...lastMsg,
                parts: updatedParts,
              },
            ]
          }
          return prev
        })
      } else if (msg.type === 'queue_user_prompt') {
        const queuedContent = msg.content as { prompt?: string; reason?: string; source?: string }
        const prompt = typeof queuedContent.prompt === 'string' ? queuedContent.prompt.trim() : ''
        if (prompt.length > 0) {
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
        // Handle reasoning messages (agent's thinking)
        const reasoningContent = msg.content as string
        console.log('[Chat] Reasoning:', reasoningContent?.substring(0, 100))

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            // Add reasoning as text part
            const existingParts = lastMsg.parts || []
            return [
              ...prev.slice(0, -1),
              {
                ...lastMsg,
                parts: [...existingParts, { type: 'reasoning' as const, text: reasoningContent || '' }],
              },
            ]
          } else {
            // Create new assistant message with reasoning
            return [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: reasoningContent || '',
                parts: [{ type: 'reasoning', text: reasoningContent || '' }],
                createdAt: new Date().toISOString(),
              },
            ]
          }
        })
      } else if (msg.type === 'init') {
        console.log('[Chat] Agent initialized:', msg.content)
      } else if (msg.type === 'done') {
        console.log('[Chat] Agent completed:', msg.content)
        // Capture usage data from completion message
        if (msg.metadata?.tokens) {
          usageRef.current.outputTokens += msg.metadata.tokens as number
        }
      }
    },
    onError: (err) => {
      console.error('[Chat] Local agent error:', err)

      // Detect poisoned conversation history (empty screenshot base64).
      // Once this enters the history, every subsequent API call fails because
      // the full history is resent. Recover by terminating the session.
      if (
        err.includes('image cannot be empty') ||
        err.includes('image.source.base64')
      ) {
        console.warn('[Chat] Detected poisoned conversation history — terminating session')
        toast.error('Screenshot data corrupted the conversation. Starting a fresh session.', { id: 'agent-error' })
        localAgent.terminate()
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: 'The previous session had a corrupted screenshot in its history. I\'ve started a fresh session — please resend your message.',
            parts: [{ type: 'text', text: 'The previous session had a corrupted screenshot in its history. I\'ve started a fresh session — please resend your message.' }],
            createdAt: new Date().toISOString(),
          },
        ])
        setAgentSessionId(null)
        setIsStreaming(false)
        return
      }

      setError(err)
      setIsStreaming(false)
      toast.error(err, { id: 'agent-error' })

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
    onComplete: () => {
      console.log('[Chat] Local agent completed')
      setIsStreaming(false)
      // Session is automatically persisted by the CLI tools (Claude/Codex)
      // No need to manually persist to database
    },
  })

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
        setIsStreaming(true)

        let fullPrompt = messageContent

        // If there are initial images, save them and append paths to prompt
        if (initialImages && initialImages.length > 0) {
          console.log('[Chat] Processing', initialImages.length, 'initial images')
          const attachmentPaths: string[] = []

          // Build image parts for display in the message
          const imageParts: MessagePart[] = []

          for (let i = 0; i < initialImages.length; i++) {
            const imageData = initialImages[i]
            console.log('[Chat] Saving initial image', i, ':', imageData.filename)

            // Add image part for display
            imageParts.push({
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
          if (imageParts.length > 0) {
            setMessages((prev) => {
              if (prev.length === 0) return prev
              const updated = [...prev]
              const firstMsg = { ...updated[0] }
              firstMsg.parts = [...(firstMsg.parts || []), ...imageParts]
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
          await localAgent.sendPrompt(promptToSend)
        } catch (err) {
          console.error('[Chat] Failed to start initial stream:', err)
          const errorMsg = err instanceof Error ? err.message : 'Failed to start stream'
          setError(errorMsg)
          setIsStreaming(false)
          toast.error(errorMsg, { id: 'stream-error' })
        }
      }
      startInitialStream()
    }
  }, [
    autoStart,
    messages.length,
    usableProjectPath,
    initialImages,
    localAgent.sendPrompt,
    shouldForceFrontendDesignForCurrentSession,
  ]) // Include sendPrompt to avoid stale closure

  // Sync isStreaming with localAgent.isRunning (for background session reconnection)
  useEffect(() => {
    if (localAgent.isRunning && !isStreaming) {
      console.log('[Chat] Agent is running (background reconnect) - setting isStreaming=true')
      setIsStreaming(true)
    } else if (!localAgent.isRunning && isStreaming) {
      // Only sync from agent→chat when the agent explicitly stops
      // (not when isStreaming is set by user actions like handleSubmit)
    }
  }, [localAgent.isRunning])

  // Update workbench store streaming status
  useEffect(() => {
    workbenchStore.setChatStreaming(isStreaming)
  }, [isStreaming])

  const handleSubmit = useCallback(
    async (text: string, attachments: ImageAttachment[] = [], options?: { hideUserMessage?: boolean }) => {
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
          !/\/firebase-setup\b/i.test(text)
        ) {
          const guidanceMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            parts: [{ type: 'firebase-setup-prompt' } as MessagePart],
            createdAt: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, userMessage, guidanceMessage])
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
        if (
          /\bconvex\b/i.test(text) &&
          convexStage === 'disconnected' &&
          !/\/convex-auth\b/i.test(text)
        ) {
          const guidanceMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            parts: [{ type: 'convex-setup-prompt' } as MessagePart],
            createdAt: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, userMessage, guidanceMessage])
          setInput('')
          return
        }

        // Intercept Stripe-related prompts when Stripe is not provisioned and secrets are not configured
        if (/\bstripe\b/i.test(text) && !projectHasStripe && !hasIntegrationSecrets.stripe && !/\/add-stripe\b/i.test(text)) {
          const guidanceMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            parts: [{ type: 'stripe-setup-prompt' } as MessagePart],
            createdAt: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, userMessage, guidanceMessage])
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
          const guidanceMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            parts: [{ type: 'revenuecat-setup-prompt' } as MessagePart],
            createdAt: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, userMessage, guidanceMessage])
          setInput('')
          return
        }

        setMessages((prev) => [...prev, userMessage])
      }
      setIsStreaming(true)

      try {
        console.log('[Chat] About to call localAgent.sendPrompt')
        const promptToSend = shouldForceFrontendDesignForCurrentSession()
          ? withFrontendDesignSkillPrompt(fullPrompt)
          : fullPrompt
        await localAgent.sendPrompt(promptToSend)
        console.log('[Chat] localAgent.sendPrompt completed')
      } catch (err) {
        console.error('[Chat] Local agent error:', err)
        const errorMsg = err instanceof Error ? err.message : 'Local agent error'
        setError(errorMsg)
        setIsStreaming(false)
        setIsRevenueCatSettingUp(false)
        toast.error(errorMsg, { id: 'agent-error' })
      }

      setInput('')
    },
    [
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
    ]
  )

  // Keep submitRef in sync so handleIntegrationUse can auto-submit
  submitRef.current = handleSubmit

  const handleStop = useCallback(async () => {
    console.log('[Chat] Stopping agent')
    await localAgent.stop()
    setIsStreaming(false)
  }, [localAgent])

  // Handle session switching - load a different session from CLI storage
  const handleSelectSession = useCallback(
    async (session: { sessionId: string; lastModified: number; name?: string; provider?: 'claude' | 'codex' }) => {
      if (!usableProjectPath || session.sessionId === agentSessionId) return

      console.log('[Chat] Switching to session:', session.sessionId)

      // Detach from current session (keeps it running in background)
      await localAgent.detach()

      // Prevent session restoration effects from undoing this action
      didStartNewSession.current = true

      // Update session ID
      setAgentSessionId(session.sessionId)
      setError(null)
      setIsStreaming(false)

      // Restore provider from session (if available)
      if (session.provider) {
        setProvider(session.provider)
      }

      // Update lastUsedAt in projects.json (using mutation)
      updateSessionMutation.mutate(session.sessionId, {
        lastUsedAt: new Date().toISOString(),
      })

      // Load messages from CLI storage
      setIsLoadingSession(true)
      try {
        const sessionProvider = session.provider || provider
        const result = await aiAgent.readSession(session.sessionId, sessionProvider, usableProjectPath)
        if (result.success && result.session?.messages) {
          console.log('[Chat] Loaded session messages:', result.session.messages.length)
          const loadedMessages = result.session.messages.map(convertSessionMessage)
          setMessages(loadedMessages)
        } else {
          console.error('[Chat] Failed to load session:', result.error)
          setMessages([])
        }
      } catch (err) {
        console.error('[Chat] Error loading session:', err)
        setMessages([])
      } finally {
        setIsLoadingSession(false)
      }

      // Try to reconnect to background session if still running
      const reconnected = await localAgent.reconnectToSession(session.sessionId)
      if (reconnected) {
        console.log('[Chat] Reconnected to running background session')
        setIsStreaming(true)
      }
    },
    [usableProjectPath, agentSessionId, provider, localAgent, convertSessionMessage, updateSessionMutation]
  )

  // Handle session deletion - remove from projects.json
  const handleDeleteSession = useCallback(
    async (session: { sessionId: string; lastModified: number; name?: string }) => {
      console.log('[Chat] Deleting session:', session.sessionId)

      // Delete session using mutation (handles refresh automatically)
      deleteSessionMutation.mutate(session.sessionId)

      // If we deleted the active session, switch to adjacent or clear
      if (session.sessionId === agentSessionId) {
        // Find adjacent session to switch to
        const currentIndex = allSessions.findIndex((s) => s.sessionId === session.sessionId)
        const adjacentSession = allSessions[currentIndex + 1] || allSessions[currentIndex - 1]

        if (adjacentSession) {
          // Switch to adjacent session
          handleSelectSession(adjacentSession)
        } else {
          // No other sessions, start fresh
          setAgentSessionId(null)
          setMessages([])
        }
      }
    },
    [deleteSessionMutation, agentSessionId, allSessions, handleSelectSession]
  )

  // Handle creating a new session (with optional provider/model selection)
  const handleNewSession = useCallback(async (
    providerId?: 'claude' | 'codex',
    modelId?: string
  ) => {
    console.log('[Chat] Creating new session', { providerId: providerId || provider })

    // Detach from the current session - agent continues running in background
    // Do NOT call stop() here: that would kill the CLI process, preventing reconnect
    await localAgent.detach()

    // Prevent session restoration effects from undoing this action
    didStartNewSession.current = true

    // Starting from tab "+" optionally sets provider/model for the next session
    if (providerId) {
      setProvider(providerId)
    }
    if (modelId) {
      setSelectedModel(modelId)
    }

    // Clear messages completely - each session tab is its own context
    setMessages([])

    // Reset session and error state
    setError(null)
    setIsStreaming(false)
    setAgentSessionId(null)

    // Reset refs so we don't try to load the old session
    hasLoadedSession.current = false
    initialSessionIdAtMount.current = null
    hasStartedInitialStream.current = false
  }, [localAgent, agentSessionId, isStreaming])

  // Handle fix error - submit error to AI for fixing
  const handleFixError = useCallback(() => {
    if (!promptError) return
    const errorPrompt = `Please fix the following error:\n\n\`\`\`\n${promptError}\n\`\`\``
    handleSubmit(errorPrompt)
    workbenchStore.clearPromptError()
  }, [promptError, handleSubmit])

  // Handle dismiss error
  const handleDismissError = useCallback(() => {
    workbenchStore.clearPromptError()
  }, [])

  // Watch for pending prompts from external components (e.g., deployment)
  const pendingPromptRequest = useStore(workbenchStore.pendingPrompt)
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
      const isStripePrompt = pendingPromptRequest.integrationId === 'stripe' || /\/add-stripe\b/i.test(pendingPrompt)
      const isRevenueCatPrompt =
        pendingPromptRequest.integrationId === 'revenuecat' || /\/add-revenuecat\b/i.test(pendingPrompt)

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
            toast.error(`Setup paused: required secret(s) not readable in time (${requiredKeysText}).`)
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
        activeSessionId={agentSessionId}
        newSessionAgentOptions={newSessionAgentOptions}
        selectedNewSessionProviderId={provider as 'claude' | 'codex'}
        selectedNewSessionModelId={selectedModel}
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
            onConvexIntentSelect={handleConvexIntentSelect}
            onClaudeReconnect={handleClaudeReconnect}
            onClaudeAuthError={handleClaudeAuthError}
            convexStage={convexStage}
            convexMissingKey={convexSecretStatus.missingKey}
            isFirebaseConnected={integrationStatus.firebase}
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
          placeholder={isWorkspaceReady ? "Describe what you want to build..." : "Waiting for workspace..."}
          showAttachment={true}
          showHint={true}
          providerSelector={{
            provider,
            onProviderChange: (p) => {
              const pid = p as ProviderId
              setProvider(pid)
              // Reset model to the provider's default to avoid passing e.g. a Claude model to Codex
              const defaults: Record<ProviderId, string> = { claude: 'claude-sonnet-4-20250514', codex: 'gpt-5.3-codex' }
              setSelectedModel(defaults[pid] || '')
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
            ].filter((integration) => isIntegrationAvailableForAppType(integration.id as IntegrationId, normalizedAppType)),
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
