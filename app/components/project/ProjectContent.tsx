import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { generateId } from 'ai'

import type { Project, ChatMessage, AgentSession } from '@/app/types/project'
import type { ProviderId } from '@/lib/conveyor/schemas/ai-agent-schema'
import { Chat } from '@/app/components/chat/Chat'
import { Workbench, WorkbenchHandle } from '@/app/components/workbench/Workbench'
import { workbenchStore } from '@/app/stores/workbench'
import { aiAgent, localProjects } from '@/app/api/sidecar'

// Local session info - unified format for SessionTabs
interface LocalSessionInfo {
  sessionId: string
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
  const refreshPreviewRef = useRef<(() => void) | null>(null)
  const workbenchRef = useRef<WorkbenchHandle>(null)

  // Session state - loaded from projects.json with CLI fallback
  const [sessions, setSessions] = useState<LocalSessionInfo[]>([])
  const [discoveredSessionId, setDiscoveredSessionId] = useState<string | null>(null)
  const hasLoadedSessions = useRef(false)
  const hasAlignedProjectPath = !!projectPath && storeProjectId === project.id

  // Load sessions from projects.json, with CLI storage fallback for migration
  const loadSessions = useCallback(async () => {
    try {
      console.log('[ProjectContent] Loading sessions from projects.json for:', project.id)
      const projectSessions = await localProjects.listSessions(project.id)

      if (projectSessions && projectSessions.length > 0) {
        // Convert AgentSession to LocalSessionInfo format
        const sessionInfos: LocalSessionInfo[] = projectSessions.map((s: AgentSession) => ({
          sessionId: s.sessionId,
          lastModified: new Date(s.lastUsedAt || s.createdAt).getTime(),
          name: s.name || undefined,
          provider: s.provider,
        }))

        // Sort by lastModified descending (newest first)
        sessionInfos.sort((a, b) => b.lastModified - a.lastModified)

        console.log('[ProjectContent] Loaded sessions from projects.json:', sessionInfos.length)
        setSessions(sessionInfos)

        // Set the most recent session if we don't have one yet
        if (!discoveredSessionId && sessionInfos.length > 0) {
          setDiscoveredSessionId(sessionInfos[0].sessionId)
          console.log('[ProjectContent] Most recent session:', sessionInfos[0].sessionId)
        }
      } else {
        console.log('[ProjectContent] No sessions in projects.json, trying CLI storage...')
        // Fallback: Try to discover sessions from CLI storage for migration
        if (hasAlignedProjectPath && projectPath) {
          const provider = initialProvider || 'claude'
          const result = await aiAgent.listSessions(provider, projectPath)
          if (result.success && result.sessions && result.sessions.length > 0) {
            console.log('[ProjectContent] Found sessions in CLI storage:', result.sessions.length)
            setSessions(result.sessions)
            if (!discoveredSessionId) {
              setDiscoveredSessionId(result.sessions[0].sessionId)
            }
          } else {
            console.log('[ProjectContent] No sessions found anywhere')
          }
        }
      }
    } catch (err) {
      console.error('[ProjectContent] Failed to load sessions:', err)
    }
  }, [project.id, projectPath, hasAlignedProjectPath, initialProvider, discoveredSessionId])

  // Initial session load
  useEffect(() => {
    if (hasLoadedSessions.current) return
    if (syncStatus !== 'ready') return

    hasLoadedSessions.current = true
    loadSessions()
  }, [syncStatus, loadSessions])

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

  // Get current provider (from initialProvider or project's latestAgentSession)
  const currentProvider = useMemo(() => {
    return initialProvider || project.latestAgentSession?.provider || 'claude'
  }, [initialProvider, project.latestAgentSession?.provider])

  // Create initial messages for new projects that should auto-start
  // When initialProvider is set and project has a description, we create the initial user message
  const initialMessages = useMemo((): ChatMessage[] => {
    // Only create initial message for new projects (initialProvider set, no existing session)
    if (initialProvider && project.description && !project.latestAgentSession) {
      return [{
        id: generateId(),
        role: 'user',
        content: project.description,
        parts: [{ type: 'text', text: project.description }],
        createdAt: new Date().toISOString(),
      }]
    }
    return []
  }, [initialProvider, project.description, project.latestAgentSession])

  // Calculate autoStart flag
  const shouldAutoStart = !!initialProvider && hasAlignedProjectPath && syncStatus === 'ready' && initialMessages.length > 0

  // Resolve session ID: prefer project metadata, fall back to discovered from CLI storage
  const resolvedSessionId = project.latestAgentSession?.sessionId ?? discoveredSessionId

  // Debug: Log the auto-start decision factors
  console.log('[ProjectContent] Auto-start decision:', {
    initialProvider,
    hasProjectPath: hasAlignedProjectPath,
    initialMessagesLength: initialMessages.length,
    latestAgentSession: project.latestAgentSession?.sessionId,
    discoveredSessionId,
    resolvedSessionId,
    sessionsCount: sessions.length,
    shouldAutoStart,
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
