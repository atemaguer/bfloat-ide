import { useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Copy, Share2, RefreshCw, Code, Eye, Database, CreditCard, Settings, PanelLeft, Rocket, Check, Search, Loader2 } from 'lucide-react'
import { workbenchStore, type WorkbenchTabType } from '@/app/stores/workbench'
import { projectStore } from '@/app/stores/project-store'
import { useWindowContext } from './WindowContext'
import { useTitlebarContext } from './TitlebarContext'
import { TitlebarMenu } from './TitlebarMenu'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { DeployModal } from '@/app/components/deploy/DeployModal'
import { deployStore } from '@/app/stores/deploy'
import './titlebar.css'

// Removed unused isDeployModalOpen - DeployModal manages its own visibility

const SVG_PATHS = {
  close: 'M 0,0 0,0.7 4.3,5 0,9.3 0,10 0.7,10 5,5.7 9.3,10 10,10 10,9.3 5.7,5 10,0.7 10,0 9.3,0 5,4.3 0.7,0 Z',
  maximize: 'M 0,0 0,10 10,10 10,0 Z M 1,1 9,1 9,9 1,9 Z',
  minimize: 'M 0,5 10,5 10,6 0,6 Z',
} as const

// Tab configuration
const WORKBENCH_TABS: Array<{ id: WorkbenchTabType; label: string; icon: typeof Code }> = [
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: Settings },
]

// Project-specific titlebar content
const ProjectTitlebarContent = () => {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const deployButtonRef = useRef<HTMLButtonElement>(null)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle')

  // Subscribe to current project from workbench store (already loaded by ProjectPage)
  const currentProject = useStore(workbenchStore.currentProject)
  const activeTab = useStore(workbenchStore.activeTab)
  const isChatCollapsed = useStore(workbenchStore.isChatCollapsed)
  const activeDeployment = useStore(deployStore.activeDeployment)
  const projectTitle = currentProject?.title || 'Loading...'
  const isLoading = !currentProject
  const isDeploying = activeDeployment?.status === 'running' && activeDeployment?.projectId === id

  const handleCopyProjectId = () => {
    if (id) {
      navigator.clipboard.writeText(id)
    }
  }

  const handleDeployClick = () => {
    deployStore.toggleModal()
  }

  const handleSync = async () => {
    if (syncStatus === 'syncing') return

    setSyncStatus('syncing')
    try {
      // Check if there are changes to commit
      const hasChanges = await projectStore.hasGitChanges()
      if (!hasChanges) {
        console.log('[Titlebar] No changes to sync')
        setSyncStatus('success')
        setTimeout(() => setSyncStatus('idle'), 2000)
        return
      }

      // Commit and push with a timestamp-based message
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
      await projectStore.commitAndPush(`Sync changes - ${timestamp}`)
      console.log('[Titlebar] Changes synced successfully')
      setSyncStatus('success')
      setTimeout(() => setSyncStatus('idle'), 2000)
    } catch (error) {
      console.error('[Titlebar] Failed to sync:', error)
      setSyncStatus('error')
      setTimeout(() => setSyncStatus('idle'), 3000)
    }
  }

  return (
    <>
      <div className="window-titlebar-project-left">
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
        <h1 className="window-titlebar-project-title" style={{ opacity: isLoading ? 0.6 : 1 }}>
          {projectTitle}
        </h1>
      </div>

      {/* Workbench Tabs - centered in titlebar */}
      <div className="window-titlebar-tabs">
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
        {/* Publish button after tabs */}
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

      <div className="window-titlebar-project-actions">
        <button className="window-titlebar-icon-btn" title="Copy Project ID" onClick={handleCopyProjectId}>
          <Copy size={13} />
        </button>
        <button
          className={`window-titlebar-icon-btn ${syncStatus === 'syncing' ? 'syncing' : ''} ${syncStatus === 'success' ? 'success' : ''} ${syncStatus === 'error' ? 'error' : ''}`}
          title={syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'success' ? 'Synced!' : syncStatus === 'error' ? 'Sync failed' : 'Sync to remote'}
          onClick={handleSync}
          disabled={syncStatus === 'syncing'}
        >
          {syncStatus === 'success' ? <Check size={13} /> : <RefreshCw size={13} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />}
        </button>
      </div>
      {/* Publish modal - rendered unconditionally, manages its own visibility */}
      <DeployModal anchorRef={deployButtonRef} />
    </>
  )
}

export const Titlebar = () => {
  const { title, icon, titleCentered, menuItems } = useWindowContext().titlebar
  const { menusVisible, setMenusVisible, closeActiveMenu } = useTitlebarContext()
  const { window: wcontext } = useWindowContext()
  const location = useLocation()
  const navigate = useNavigate()

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
    <div className={`window-titlebar ${wcontext?.platform ? `platform-${wcontext.platform}` : ''}`}>
      {wcontext?.platform === 'win32' && !isProjectPage && (
        <div className="window-titlebar-icon">
          <img src={icon} alt="App icon" />
        </div>
      )}

      {isProjectPage ? (
        <ProjectTitlebarContent />
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
  const { windowMinimize, windowMaximizeToggle, windowClose } = useConveyor('window')

  const handleAction = () => {
    const actions = {
      minimize: windowMinimize,
      maximize: windowMaximizeToggle,
      close: windowClose,
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
