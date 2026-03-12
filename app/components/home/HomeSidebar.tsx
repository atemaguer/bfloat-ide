import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Home,
  FolderKanban,
  Settings,
  ChevronDown,
  ChevronRight,
  Smartphone,
  Globe,
  HelpCircle,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/app/components/ui/collapsible'
import type { Project } from '@/app/types/project'


interface HomeSidebarProps {
  projects: Project[]
  isLoadingProjects: boolean
  onProjectClick: (project: Project) => void
  onNewProject: () => void
  onSearch: () => void
}

// Generate color based on title
function getProjectColor(title: string): string {
  const colors = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function HomeSidebar({
  projects,
  isLoadingProjects,
  onProjectClick,
  onSearch,
}: HomeSidebarProps) {
  const navigate = useNavigate()
  const [projectsExpanded, setProjectsExpanded] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const recentProjects = projects.slice(0, 10)

  const handleSettingsClick = () => {
    navigate('/settings')
  }

  return (
    <>
      {/* Toggle icon always visible in title bar */}
      <div
        className="sidebar-toggle-btn fixed top-[11px] left-[78px] z-50 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {isCollapsed ? <PanelRight size={14} /> : <PanelLeft size={14} />}
      </div>

      {/* Animated sidebar */}
      <div
        className={cn(
          "flex h-full flex-col border-r border-border bg-background transition-all duration-300 ease-in-out overflow-hidden",
          isCollapsed ? "w-0 min-w-0 border-r-0" : "w-52 min-w-52"
        )}
      >
        {/* Workspace Header */}
        <div className="w-52 border-b border-border px-2 py-1.5">
          <div className="flex h-7 w-full items-center gap-2 rounded-md px-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              B
            </span>
            <span className="text-sm font-semibold text-foreground">
              Bfloat IDE
            </span>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex w-52 flex-col gap-0.5 px-2 py-1.5">
          <button
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-foreground bg-muted"
          >
            <Home size={16} className="opacity-70" />
            <span className="text-[13px]">Home</span>
          </button>
          <button
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={handleSettingsClick}
          >
            <Settings size={16} className="opacity-70" />
            <span className="text-[13px]">Settings</span>
          </button>
        </nav>

        {/* Divider */}
        <div className="mx-3 h-px bg-border" />

        {/* Projects Section */}
        <div className="flex w-52 flex-1 flex-col overflow-hidden px-2 pt-2">
          <Collapsible open={projectsExpanded} onOpenChange={setProjectsExpanded}>
            <CollapsibleTrigger asChild>
              <button
                className="flex h-6 w-full items-center gap-1.5 rounded-md px-2.5 text-muted-foreground hover:text-foreground"
              >
                {projectsExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <span className="text-[11px] font-medium uppercase tracking-wide">
                  Your projects
                </span>
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {projects.length}
                </span>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent className="flex flex-1 flex-col gap-0.5 overflow-hidden pt-1">
              {isLoadingProjects ? (
                <div className="flex flex-col gap-2 px-2.5 py-2">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="h-6 animate-pulse rounded bg-muted"
                    />
                  ))}
                </div>
              ) : recentProjects.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                  <FolderKanban size={16} />
                  <span className="text-xs">No projects yet</span>
                </div>
              ) : (
                recentProjects.map((project) => (
                  <button
                    key={project.id}
                    className="flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                    onClick={() => onProjectClick(project)}
                  >
                    <span
                      className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white"
                      style={{ backgroundColor: getProjectColor(project.title) }}
                    >
                      {project.title[0]?.toUpperCase()}
                    </span>
                    <span className="flex-1 truncate text-left text-sm">
                      {project.title}
                    </span>
                    {project.appType === 'mobile' || project.appType === 'expo' ? (
                      <Smartphone size={12} className="flex-shrink-0 text-muted-foreground/50" />
                    ) : (
                      <Globe size={12} className="flex-shrink-0 text-muted-foreground/50" />
                    )}
                  </button>
                ))
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Footer */}
        <div className="flex w-52 flex-col gap-1 border-t border-border px-2 py-1.5">
          <button
            className="flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => window.open('https://discord.gg/s2XFRMWG', '_blank')}
          >
            <HelpCircle size={16} className="opacity-70" />
            <span className="text-sm">Help & Support</span>
          </button>
        </div>
      </div>
    </>
  )
}
