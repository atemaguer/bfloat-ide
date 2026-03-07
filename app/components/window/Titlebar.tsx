import { useEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, RefreshCw, Code, Eye, Database, CreditCard, Settings, PanelLeft, Rocket, Check, Search, Loader2 } from 'lucide-react'
import { workbenchStore, type WorkbenchTabType } from '@/app/stores/workbench'
import { projectStore } from '@/app/stores/project-store'
import { useWindowContext } from './WindowContext'
import { useTitlebarContext } from './TitlebarContext'
import { TitlebarMenu } from './TitlebarMenu'
import { DeployModal } from '@/app/components/deploy/DeployModal'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { Textarea } from '@/app/components/ui/input'
import { Button } from '@/app/components/ui/button'
import { deployStore } from '@/app/stores/deploy'
import { window as windowApi } from '@/app/api/sidecar'
import toast from 'react-hot-toast'
import './titlebar.css'

// Removed unused isDeployModalOpen - DeployModal manages its own visibility

const SVG_PATHS = {
  close: 'M 0,0 0,0.7 4.3,5 0,9.3 0,10 0.7,10 5,5.7 9.3,10 10,10 10,9.3 5.7,5 10,0.7 10,0 9.3,0 5,4.3 0.7,0 Z',
  maximize: 'M 0,0 0,10 10,10 10,0 Z M 1,1 9,1 9,9 1,9 Z',
  minimize: 'M 0,5 10,5 10,6 0,6 Z',
} as const

// Tab configuration
const WORKBENCH_TABS: Array<{ id: WorkbenchTabType; label: string; icon: typeof Code }> = [
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const AGENT_COMMIT_MESSAGE_PROMPT =
  'Draft a single git commit subject line for the current local changes. Return only one line, imperative mood, no quotes, max 72 chars.'

// Project-specific titlebar content
const ProjectTitlebarContent = ({
  titlebarRef,
}: {
  titlebarRef: RefObject<HTMLDivElement | null>
}) => {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const deployButtonRef = useRef<HTMLButtonElement>(null)
  const [tabRailLeft, setTabRailLeft] = useState(0)
  const [tabRailWidth, setTabRailWidth] = useState<number | undefined>(undefined)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle')
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [syncCommitMessage, setSyncCommitMessage] = useState('')
  const [syncCommitError, setSyncCommitError] = useState<string | null>(null)

  // Subscribe to current project from workbench store (already loaded by ProjectPage)
  const currentProject = useStore(workbenchStore.currentProject)
  const pendingCommitMessageDraft = useStore(workbenchStore.pendingCommitMessageDraft)
  const activeTab = useStore(workbenchStore.activeTab)
  const isChatCollapsed = useStore(workbenchStore.isChatCollapsed)
  const activeDeployment = useStore(deployStore.activeDeployment)
  const projectTitle = currentProject?.title || 'Loading...'
  const isGitConnected = Boolean(currentProject?.sourceUrl)
  const isLoading = !currentProject
  const isDeploying = activeDeployment?.status === 'running' && activeDeployment?.projectId === id

  useEffect(() => {
    const recalc = () => {
      const titlebarEl = titlebarRef.current
      if (!titlebarEl) return

      const titlebarRect = titlebarEl.getBoundingClientRect()
      const controlsEl = titlebarEl.querySelector('.window-titlebar-controls-container') as HTMLElement | null
      const controlsRect = controlsEl?.getBoundingClientRect()
      const maxRightByControls = controlsRect
        ? controlsRect.left - titlebarRect.left - 6
        : Number.POSITIVE_INFINITY
      const maxAllowedRight = maxRightByControls

      if (!isChatCollapsed) {
        const dividerEl = document.querySelector('.project-resize-handle') as HTMLElement | null
        const dividerRect = dividerEl?.getBoundingClientRect()
        if (dividerRect) {
          const nextLeft = Math.max(0, dividerRect.left - titlebarRect.left)
          const fallbackRight = Number.isFinite(maxAllowedRight)
            ? maxAllowedRight
            : titlebarRect.width - 12
          const nextRight = Math.max(nextLeft, fallbackRight)
          setTabRailLeft(nextLeft)
          setTabRailWidth(Math.max(0, nextRight - nextLeft))
          return
        }
      }

      const leftEl = titlebarEl.querySelector('.window-titlebar-project-left') as HTMLElement | null
      if (!leftEl) return
      const leftRect = leftEl.getBoundingClientRect()
      const fallbackLeft = Math.max(0, leftRect.right - titlebarRect.left + 12)
      const fallbackRight = Number.isFinite(maxAllowedRight)
        ? maxAllowedRight
        : titlebarRect.width - 12
      setTabRailLeft(fallbackLeft)
      setTabRailWidth(Math.max(0, fallbackRight - fallbackLeft))
    }

    recalc()
    window.addEventListener('resize', recalc)

    const observer = new ResizeObserver(() => recalc())
    if (titlebarRef.current) observer.observe(titlebarRef.current)
    const controlsEl = titlebarRef.current?.querySelector('.window-titlebar-controls-container') as HTMLElement | null
    if (controlsEl) observer.observe(controlsEl)
    const actionsEl = titlebarRef.current?.querySelector('.window-titlebar-project-actions') as HTMLElement | null
    if (actionsEl) observer.observe(actionsEl)
    const workbenchPanelEl = document.querySelector('.project-panel-workbench') as HTMLElement | null
    if (workbenchPanelEl) observer.observe(workbenchPanelEl)

    return () => {
      window.removeEventListener('resize', recalc)
      observer.disconnect()
    }
  }, [isChatCollapsed, projectTitle, titlebarRef])

  const handleDeployClick = () => {
    deployStore.toggleModal()
  }

  const createDefaultSyncMessage = (): string => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    return `Sync changes - ${timestamp}`
  }

  const handleSync = async () => {
    if (syncStatus === 'syncing') return

    console.log('[Titlebar] Sync requested', { syncStatus, isGitConnected })
    setSyncStatus('syncing')
    try {
      // Check if there are changes to commit
      const hasChanges = await projectStore.hasGitChanges()
      console.log('[Titlebar] hasGitChanges result', { hasChanges })
      if (!hasChanges) {
        const syncState = await projectStore.getGitSyncStatus()
        console.log('[Titlebar] getGitSyncStatus result', syncState)

        if (syncState.success === false || syncState.error) {
          throw new Error(syncState.error || 'Failed to compare local and remote heads')
        }

        const ahead = syncState.ahead ?? 0
        const behind = syncState.behind ?? 0
        const diverged = Boolean(syncState.diverged)

        if (diverged || (ahead > 0 && behind > 0)) {
          toast.error('Local and remote branches have diverged. Please pull/rebase manually.')
          setSyncStatus('error')
          setTimeout(() => setSyncStatus('idle'), 3000)
          return
        }

        if (ahead > 0) {
          console.log('[Titlebar] No working tree changes, pushing existing local commits', { ahead })
          await projectStore.syncToRemote('')
          toast.success(`Pushed ${ahead} local commit${ahead === 1 ? '' : 's'} to remote`)
          setSyncStatus('success')
          setTimeout(() => setSyncStatus('idle'), 2000)
          return
        }

        if (behind > 0) {
          console.log('[Titlebar] No working tree changes, pulling remote commits', { behind })
          await projectStore.pull()
          toast.success(`Pulled ${behind} remote commit${behind === 1 ? '' : 's'}`)
          setSyncStatus('success')
          setTimeout(() => setSyncStatus('idle'), 2000)
          return
        }

        toast('No local changes to sync')
        setSyncStatus('idle')
        return
      }

      const nextMessage = createDefaultSyncMessage()
      setSyncCommitMessage(nextMessage)
      setSyncCommitError(null)
      setIsSyncModalOpen(true)
      setSyncStatus('idle')
    } catch (error) {
      console.error('[Titlebar] Failed to sync:', error)
      setSyncStatus('error')
      setTimeout(() => setSyncStatus('idle'), 3000)
      toast.error(error instanceof Error ? error.message : 'Sync failed')
    }
  }

  const handleConfirmSync = async () => {
    const message = syncCommitMessage.trim()
    if (!message) {
      setSyncCommitError('Commit message is required.')
      return
    }

    setSyncCommitError(null)
    setSyncStatus('syncing')
    try {
      console.log('[Titlebar] Starting commitAndPush', { message })
      await projectStore.commitAndPush(message)
      console.log('[Titlebar] Changes synced successfully')
      setIsSyncModalOpen(false)
      toast.success('Synced changes to remote')
      setSyncStatus('success')
      setTimeout(() => setSyncStatus('idle'), 2000)
    } catch (error) {
      console.error('[Titlebar] Failed to sync:', error)
      setSyncStatus('error')
      setTimeout(() => setSyncStatus('idle'), 3000)
      toast.error(error instanceof Error ? error.message : 'Failed to sync changes')
    }
  }

  const handleDraftMessageWithAgent = () => {
    workbenchStore.requestCommitMessageDraft('workbench')
    workbenchStore.triggerChatPrompt(AGENT_COMMIT_MESSAGE_PROMPT, { source: 'workbench' })
    toast.success('Asked agent to draft a commit message')
  }

  useEffect(() => {
    if (!isSyncModalOpen || !pendingCommitMessageDraft) return
    setSyncCommitMessage(pendingCommitMessageDraft)
    setSyncCommitError(null)
    workbenchStore.clearPendingCommitMessageDraft()
  }, [isSyncModalOpen, pendingCommitMessageDraft])

  return (
    <>
      <div className="window-titlebar-project-left" data-tauri-drag-region>
        {isChatCollapsed && (
          <button
            className="window-titlebar-expand-btn"
            onClick={() => workbenchStore.setIsChatCollapsed(false)}
            title="Show chat"
          >
            <PanelLeft size={14} />
          </button>
        )}
        <button
          className="window-titlebar-back-btn"
          onClick={() => navigate(-1)}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <FileText size={13} className="window-titlebar-project-icon" />
        <h1 className="window-titlebar-project-title" style={{ opacity: isLoading ? 0.6 : 1 }} data-tauri-drag-region>
          {projectTitle}
        </h1>
      </div>

      <div
        className="window-titlebar-tabs-rail"
        style={{
          left: `${tabRailLeft}px`,
          width: tabRailWidth ? `${tabRailWidth}px` : undefined,
        }}
      >
        <div className="window-titlebar-tabs-primary">
          {WORKBENCH_TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={`window-titlebar-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => workbenchStore.setActiveTab(tab.id)}
              >
                <Icon size={11} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
        <div className="window-titlebar-tabs-secondary">
          <div className={`window-titlebar-project-actions ${isGitConnected ? 'connected' : 'disconnected'}`}>
            <button
              className={`window-titlebar-icon-btn ${syncStatus === 'syncing' ? 'syncing' : ''} ${syncStatus === 'success' ? 'success' : ''} ${syncStatus === 'error' ? 'error' : ''}`}
              title={
                !isGitConnected
                  ? 'Connect a Git remote to enable sync'
                  : syncStatus === 'syncing'
                    ? 'Syncing...'
                    : syncStatus === 'success'
                      ? 'Synced!'
                      : syncStatus === 'error'
                        ? 'Sync failed'
                        : 'Sync to remote'
              }
              onClick={handleSync}
              disabled={!isGitConnected || syncStatus === 'syncing'}
            >
              {syncStatus === 'success' ? <Check size={13} /> : <RefreshCw size={13} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />}
            </button>
          </div>
          <button
            ref={deployButtonRef}
            className="window-titlebar-tab deploy"
            onClick={handleDeployClick}
            title="Publish app"
          >
            {isDeploying ? <Loader2 size={11} className="animate-spin" /> : <Rocket size={11} />}
            <span>{isDeploying ? 'Publishing...' : 'Publish'}</span>
          </button>
        </div>
      </div>
      {/* Publish modal - rendered unconditionally, manages its own visibility */}
      <DeployModal anchorRef={deployButtonRef} />
      <Dialog open={isSyncModalOpen} onOpenChange={setIsSyncModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sync Changes</DialogTitle>
            <DialogDescription>Review and edit the commit message before pushing to remote.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-2">
            <div className="text-xs text-[hsl(var(--muted-foreground))]">Commit message</div>
            <Textarea
              value={syncCommitMessage}
              onChange={(e) => {
                setSyncCommitMessage(e.target.value)
                if (syncCommitError) setSyncCommitError(null)
              }}
              placeholder="Describe your changes..."
              className="min-h-[96px]"
              error={syncCommitError || undefined}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleDraftMessageWithAgent} disabled={syncStatus === 'syncing'}>
              Draft with Agent
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsSyncModalOpen(false)} disabled={syncStatus === 'syncing'}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleConfirmSync} disabled={syncStatus === 'syncing'}>
              {syncStatus === 'syncing' ? <Loader2 size={14} className="animate-spin" /> : null}
              Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const Titlebar = () => {
  const { title, icon, titleCentered, menuItems } = useWindowContext().titlebar
  const { menusVisible, setMenusVisible, closeActiveMenu } = useTitlebarContext()
  const { window: wcontext } = useWindowContext()
  const location = useLocation()
  const navigate = useNavigate()
  const titlebarRef = useRef<HTMLDivElement>(null)

  // Check if we're on a project page
  const isProjectPage = location.pathname.startsWith('/projects/')
  const isAuthPage = location.pathname === '/auth'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && menuItems?.length && !e.repeat) {
        if (menusVisible) closeActiveMenu()
        setMenusVisible(!menusVisible)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menusVisible, closeActiveMenu, setMenusVisible, menuItems])

  if (isAuthPage) return null

  return (
    <div ref={titlebarRef} className={`window-titlebar ${wcontext?.platform ? `platform-${wcontext.platform}` : ''}`} data-tauri-drag-region>
      {wcontext?.platform === 'win32' && !isProjectPage && (
        <div className="window-titlebar-icon">
          <img src={icon} alt="App icon" />
        </div>
      )}

      {isProjectPage ? (
        <ProjectTitlebarContent titlebarRef={titlebarRef} />
      ) : (
        <>
          <div
            className="window-titlebar-title"
            {...(titleCentered && { 'data-centered': true })}
            style={{ visibility: menusVisible ? 'hidden' : 'visible' }}
          >
            {title}
          </div>
          {/* Search bar for home page */}
          <button
            className="window-titlebar-search"
            onClick={() => {
              const event = new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                bubbles: true,
              })
              document.dispatchEvent(event)
            }}
          >
            <Search size={12} />
            <span>Search</span>
            <span className="window-titlebar-search-shortcut">⌘K</span>
          </button>
        </>
      )}
      {menusVisible && <TitlebarMenu />}
      <div className="window-titlebar-controls-container">
        <button
          className="window-titlebar-settings-btn"
          onClick={() => navigate('/settings')}
          title="Settings"
        >
          <Settings size={15} />
        </button>
        {wcontext?.platform === 'win32' && <TitlebarControls />}
      </div>
    </div>
  )
}

const TitlebarControls = () => {
  const { window: wcontext } = useWindowContext()

  return (
    <div className="window-titlebar-controls">
      {wcontext?.minimizable && <TitlebarControlButton label="minimize" svgPath={SVG_PATHS.minimize} />}
      {wcontext?.maximizable && <TitlebarControlButton label="maximize" svgPath={SVG_PATHS.maximize} />}
      <TitlebarControlButton label="close" svgPath={SVG_PATHS.close} />
    </div>
  )
}

const TitlebarControlButton = ({ svgPath, label }: { svgPath: string; label: string }) => {
  const handleAction = () => {
    const actions = {
      minimize: windowApi.windowMinimize,
      maximize: windowApi.windowMaximizeToggle,
      close: windowApi.windowClose,
    }
    actions[label as keyof typeof actions]?.()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className="titlebar-controlButton"
      onClick={handleAction}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleAction()
        }
      }}
    >
      <svg width="10" height="10">
        <path fill="currentColor" d={svgPath} />
      </svg>
    </div>
  )
}

export interface TitlebarProps {
  title: string
  titleCentered?: boolean
  icon?: string
  menuItems?: TitlebarMenu[]
}
