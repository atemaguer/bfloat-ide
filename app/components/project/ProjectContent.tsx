import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { generateId } from 'ai'

import type { Project, ChatMessage, AgentSession } from '@/app/types/project'
import type { BackgroundSessionInfo, ProviderId } from '@/lib/conveyor/schemas/ai-agent-schema'
import { Chat } from '@/app/components/chat/Chat'
import { Workbench, WorkbenchHandle } from '@/app/components/workbench/Workbench'
import { workbenchStore } from '@/app/stores/workbench'
import { deployStore } from '@/app/stores/deploy'
import { providerAuthStore, providerTypeToAgentProviderId } from '@/app/stores/provider-auth'
import { projectSessionsStore } from '@/app/stores/project-sessions'
import { aiAgent, localProjects } from '@/app/api/sidecar'

// Local session info - unified format for SessionTabs
interface LocalSessionInfo {
  sessionId: string
  runtimeSessionId?: string | null
  providerSessionId?: string | null
  createdAt: number
  lastModified: number
  name?: string
  provider?: 'claude' | 'codex'
}

// Image data passed from HomePage via navigation state
export interface InitialImageData {
  filename: string
  base64: string
  type: string
}

// Sync status from projectStore
type SyncStatus = 'idle' | 'opening' | 'ready' | 'error'

interface ProjectContentProps {
  project: Project
  hasConvexIntegration?: boolean
  convexDeploymentKey?: string | null
  convexUrl?: string | null
  convexDeployment?: string | null
  projectPath?: string | null  // Git-cloned project path from agent
  storeProjectId?: string | null
  syncStatus?: SyncStatus  // For progressive loading - components show their own loading states
  initialProvider?: ProviderId  // AI provider selected during project creation
  initialModel?: string  // AI model selected during project creation (for multi-model providers)
  initialImages?: InitialImageData[]  // Images attached during project creation
  // Note: Session saving is handled directly by Chat via useSaveSession hook (Remix-like pattern)
}

export function ProjectContent({
  project,
  hasConvexIntegration,
  convexDeploymentKey,
  convexUrl,
  convexDeployment,
  projectPath,
  storeProjectId,
  syncStatus = 'ready',
  initialProvider,
  initialModel,
  initialImages,
}: ProjectContentProps) {
  // Use workbench store for shared state (tabs are now in titlebar)
  const isChatCollapsed = useStore(workbenchStore.isChatCollapsed)
  const providerSettings = useStore(providerAuthStore.settings)
  const refreshPreviewRef = useRef<(() => void) | null>(null)
  const workbenchRef = useRef<WorkbenchHandle>(null)
  const defaultProvider = providerTypeToAgentProviderId(providerSettings.defaultProvider)
  const selectedSessionStore = useMemo(
    () => projectSessionsStore.getSelectedSessionStore(project.id, initialProvider || defaultProvider),
    [defaultProvider, initialProvider, project.id]
  )
  const selectedSessionId = useStore(selectedSessionStore)

  // Session state - loaded from projects.json with CLI fallback
  const [sessions, setSessions] = useState<LocalSessionInfo[]>([])
  const [discoveredSessionId, setDiscoveredSessionId] = useState<string | null>(null)
  const [projectBackgroundSessions, setProjectBackgroundSessions] = useState<BackgroundSessionInfo[]>([])
  const hasLoadedSessions = useRef(false)
  const hasAlignedProjectPath = !!projectPath && storeProjectId === project.id

  // Load sessions from projects.json, with CLI storage fallback for migration
  const loadSessions = useCallback(async () => {
    try {
      console.log('[ProjectContent] Loading sessions from projects.json for:', project.id)
      const [projectSessions, backgroundSessions] = await Promise.all([
        localProjects.listSessions(project.id),
        aiAgent.listBackgroundSessions(),
      ])

      const matchingBackgroundSessions = backgroundSessions
        .filter((session) => session.projectId === project.id)
        .sort((a, b) => b.startedAt - a.startedAt)
      setProjectBackgroundSessions(matchingBackgroundSessions)

      if (projectSessions && projectSessions.length > 0) {
        let normalizedProjectSessions = projectSessions

        if (hasAlignedProjectPath && projectPath && matchingBackgroundSessions.length > 0) {
          for (const backgroundSession of matchingBackgroundSessions) {
            const persistedSession = normalizedProjectSessions.find(
              (session: AgentSession) => session.sessionId === backgroundSession.sessionId
            )

            if (persistedSession?.provider !== 'claude') {
              continue
            }

            const persistedResult = await aiAgent.readSession(
              backgroundSession.sessionId,
              persistedSession.provider,
              projectPath
            )

            if (!persistedResult.success) {
              normalizedProjectSessions = normalizedProjectSessions.filter(
                (session: AgentSession) => session.sessionId !== backgroundSession.sessionId
              )
              localProjects.deleteSession(project.id, backgroundSession.sessionId).catch((error) => {
                console.warn('[ProjectContent] Failed to delete stale sidecar session alias:', error)
              })
            }
          }
        }

        // Convert AgentSession to LocalSessionInfo format
        const sessionInfos: LocalSessionInfo[] = normalizedProjectSessions.map((s: AgentSession) => ({
          sessionId: s.sessionId,
          runtimeSessionId: s.runtimeSessionId ?? null,
          providerSessionId: s.providerSessionId ?? null,
          createdAt: new Date(s.createdAt).getTime(),
          lastModified: new Date(s.lastUsedAt || s.createdAt).getTime(),
          name: s.name || undefined,
          provider: s.provider,
        }))

        // Keep chat tabs stable by creation order.
        sessionInfos.sort((a, b) => a.createdAt - b.createdAt)

        console.log('[ProjectContent] Loaded sessions from projects.json:', sessionInfos.length)
        console.log('[ProjectContent] Stable session order:', sessionInfos.map((session) => ({
          sessionId: session.sessionId,
          runtimeSessionId: session.runtimeSessionId ?? null,
          providerSessionId: session.providerSessionId ?? null,
          createdAt: session.createdAt,
          lastModified: session.lastModified,
        })))
        setSessions(sessionInfos)

        const initialStableSessionId = sessionInfos[0]?.sessionId || null
        const nextSelectedSessionId =
          selectedSessionId && sessionInfos.some((session) => session.sessionId === selectedSessionId)
            ? selectedSessionId
            : initialStableSessionId
        const nextDiscoveredSessionId =
          discoveredSessionId && sessionInfos.some((session) => session.sessionId === discoveredSessionId)
            ? discoveredSessionId
            : initialStableSessionId
        console.log('[ProjectContent] Persisted session selection reconciliation', {
          initialStableSessionId,
          previousSelectedSessionId: selectedSessionId,
          nextSelectedSessionId,
          previousDiscoveredSessionId: discoveredSessionId,
          nextDiscoveredSessionId,
        })

        if (nextDiscoveredSessionId !== discoveredSessionId) {
          setDiscoveredSessionId(nextDiscoveredSessionId)
          console.log('[ProjectContent] Stable discovered session updated:', nextDiscoveredSessionId)
        }
        if (nextSelectedSessionId !== selectedSessionId) {
          projectSessionsStore.setSelectedSessionId(project.id, nextSelectedSessionId, initialProvider || defaultProvider)
          console.log('[ProjectContent] Active session aligned to persisted session catalog:', nextSelectedSessionId)
        }
      } else {
        console.log('[ProjectContent] No sessions in projects.json, trying CLI storage...')
        // Fallback: Try to discover sessions from CLI storage for migration
        if (hasAlignedProjectPath && projectPath) {
          const provider = initialProvider || defaultProvider
          const result = await aiAgent.listSessions(provider, projectPath)
          if (result.success && result.sessions && result.sessions.length > 0) {
            console.log('[ProjectContent] Found sessions in CLI storage:', result.sessions.length)
            const cliSessions: LocalSessionInfo[] = result.sessions.map((session) => ({
              ...session,
              createdAt: session.lastModified,
            })).sort((a, b) => a.createdAt - b.createdAt)
            console.log('[ProjectContent] Stable CLI session order:', cliSessions.map((session) => ({
              sessionId: session.sessionId,
              runtimeSessionId: session.runtimeSessionId ?? null,
              createdAt: session.createdAt,
              lastModified: session.lastModified,
            })))
            setSessions(cliSessions)
            const initialCliSessionId = cliSessions[0]?.sessionId || null
            const nextSelectedCliSessionId =
              selectedSessionId && cliSessions.some((session) => session.sessionId === selectedSessionId)
                ? selectedSessionId
                : initialCliSessionId
            const nextDiscoveredCliSessionId =
              discoveredSessionId && cliSessions.some((session) => session.sessionId === discoveredSessionId)
                ? discoveredSessionId
                : initialCliSessionId
            console.log('[ProjectContent] CLI session selection reconciliation', {
              initialCliSessionId,
              previousSelectedSessionId: selectedSessionId,
              nextSelectedSessionId: nextSelectedCliSessionId,
              previousDiscoveredSessionId: discoveredSessionId,
              nextDiscoveredSessionId: nextDiscoveredCliSessionId,
            })
            if (nextDiscoveredCliSessionId !== discoveredSessionId) {
              setDiscoveredSessionId(nextDiscoveredCliSessionId)
            }
            if (nextSelectedCliSessionId !== selectedSessionId) {
              projectSessionsStore.setSelectedSessionId(project.id, nextSelectedCliSessionId, initialProvider || defaultProvider)
              console.log('[ProjectContent] Active session aligned to CLI session catalog:', nextSelectedCliSessionId)
            }
          } else {
            console.log('[ProjectContent] No sessions found anywhere')
            setSessions([])
            if (discoveredSessionId !== null) {
              setDiscoveredSessionId(null)
            }
            if (selectedSessionId !== null) {
              projectSessionsStore.setSelectedSessionId(project.id, null, initialProvider || defaultProvider)
              console.log('[ProjectContent] Cleared stale selected session because no sessions remain')
            }
          }
        } else {
          setSessions([])
          if (discoveredSessionId !== null) {
            setDiscoveredSessionId(null)
          }
          if (selectedSessionId !== null) {
            projectSessionsStore.setSelectedSessionId(project.id, null, initialProvider || defaultProvider)
            console.log('[ProjectContent] Cleared stale selected session because no aligned session sources remain')
          }
        }
      }
    } catch (err) {
      console.error('[ProjectContent] Failed to load sessions:', err)
    }
  }, [project.id, projectPath, hasAlignedProjectPath, initialProvider, defaultProvider, discoveredSessionId, selectedSessionId])

  // Initial session + deployment load
  useEffect(() => {
    if (hasLoadedSessions.current) return
    if (syncStatus !== 'ready') return

    hasLoadedSessions.current = true
    loadSessions()
    deployStore.loadDeployments(project.id)
  }, [syncStatus, loadSessions, project.id])

  // Callback for Chat to notify when a session is created/updated
  const handleSessionsChange = useCallback(() => {
    console.log('[ProjectContent] Sessions changed, reloading...')
    loadSessions()
  }, [loadSessions])

  const handleRefreshPreviewReady = useCallback((refreshFn: () => void) => {
    refreshPreviewRef.current = refreshFn
  }, [])

  /**
   * Run a terminal command from anywhere in the project
   * Example: runTerminalCommand('npm install')
   */
  const runTerminalCommand = useCallback(async (command: string) => {
    if (workbenchRef.current) {
      await workbenchRef.current.runCommand(command)
    }
  }, [])

  // Get current provider (prefer active running background session).
  const selectedStableSession = useMemo(() => {
    const preferredSessionId =
      (selectedSessionId && sessions.some((session) => session.sessionId === selectedSessionId) ? selectedSessionId : null) ??
      (discoveredSessionId && sessions.some((session) => session.sessionId === discoveredSessionId) ? discoveredSessionId : null)

    return preferredSessionId
      ? sessions.find((session) => session.sessionId === preferredSessionId) ?? null
      : null
  }, [discoveredSessionId, selectedSessionId, sessions])

  const currentProvider = useMemo(() => {
    return selectedStableSession?.provider || initialProvider || project.latestAgentSession?.provider || defaultProvider
  }, [defaultProvider, initialProvider, project.latestAgentSession?.provider, selectedStableSession?.provider])

  const hasExistingSession = sessions.length > 0 || !!(
    projectBackgroundSessions.length > 0 ||
    project.latestAgentSession?.sessionId ||
    selectedSessionId ||
    discoveredSessionId
  )

  // Create initial messages for new projects that should auto-start
  // When initialProvider is set and project has a description, we create the initial user message
  const initialMessages = useMemo((): ChatMessage[] => {
    // Only create initial message for new projects (initialProvider set, no existing session)
    if (initialProvider && project.description && !hasExistingSession) {
      return [{
        id: generateId(),
        role: 'user',
        content: project.description,
        parts: [{ type: 'text', text: project.description }],
        createdAt: new Date().toISOString(),
      }]
    }
    return []
  }, [initialProvider, project.description, hasExistingSession])

  // Auto-start should remain armed for new Home-created projects even before the
  // workspace path is usable. Chat waits to actually send until the path is ready.
  const shouldAutoStart = !!initialProvider && syncStatus === 'ready' && initialMessages.length > 0

  // Resolve session ID from stable persisted session identity.
  // Background sessions are used for provider/runtime state, not visible tab selection.
  const resolvedSessionId =
    selectedStableSession?.sessionId ?? project.latestAgentSession?.sessionId

  // Debug: Log the auto-start decision factors
  console.log('[ProjectContent] Auto-start decision:', {
    initialProvider,
    hasProjectPath: hasAlignedProjectPath,
    projectPath,
    initialMessagesLength: initialMessages.length,
    latestAgentSession: project.latestAgentSession?.sessionId,
    discoveredSessionId,
    resolvedSessionId,
    sessionsCount: sessions.length,
    shouldAutoStart,
    activeSessionId: selectedSessionId,
    projectDescription: project.description?.substring(0, 50),
  })

  // Note: Session saving is handled directly by Chat via useSaveSession hook

  return (
    <div className="project-content">
      <PanelGroup orientation="horizontal" className="project-panels">
        {/* Chat Panel */}
        {!isChatCollapsed && (
          <Panel
            id="chat-panel"
            defaultSize="30%"
            minSize="30%"
            maxSize="50%"
          >
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              height: '100%', 
              width: '100%',
              minHeight: 0,
              overflow: 'hidden'
            }}>
              <Chat
                key={project.id}
                projectId={project.id}
                initialMessages={initialMessages}
                initialImages={initialImages}
                projectPath={projectPath}
                isWorkspaceReady={syncStatus === 'ready'}
                initialProvider={currentProvider}
                initialModel={initialModel}
                autoStart={shouldAutoStart}
                initialSessionId={resolvedSessionId}
                onSessionIdChange={(sessionId) => {
                  console.log('[ProjectContent] onSessionIdChange:', {
                    previousActiveSessionId: selectedSessionId,
                    nextSessionId: sessionId,
                  })
                  projectSessionsStore.setSelectedSessionId(project.id, sessionId, initialProvider || defaultProvider)
                  setDiscoveredSessionId(sessionId)
                }}
                projectHasConvex={!!convexUrl}
                projectHasFirebase={!!project.firebaseProjectId}
                projectHasRevenuecat={!!project.revenuecatProjectId}
                appType={project.appType}
              />
            </div>
          </Panel>
        )}

        {/* Resize Handle */}
        {!isChatCollapsed && (
          <PanelResizeHandle className="project-resize-handle" />
        )}

        {/* Workbench Panel */}
        <Panel
          id="workbench-panel"
          defaultSize={isChatCollapsed ? "100%" : "70%"}
          minSize="50%"
          className="project-panel-workbench"
        >
          <Workbench
            ref={workbenchRef}
            project={project}
            hasConvexIntegration={hasConvexIntegration}
            convexDeploymentKey={convexDeploymentKey}
            convexUrl={convexUrl}
            convexDeployment={convexDeployment}
            onRefreshPreviewReady={handleRefreshPreviewReady}
            gitProjectPath={projectPath}
            syncStatus={syncStatus}
          />
        </Panel>
      </PanelGroup>
    </div>
  )
}
