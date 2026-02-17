import type { LucideIcon } from 'lucide-react'
import { GitBranch, FolderPlus, Dumbbell, CookingPot, Wallet, LayoutDashboard } from 'lucide-react'
import type { AppType, Project } from '@/app/types/project'

// ─── Project Ideas ──────────────────────────────────────────────────────────

const PROJECT_IDEAS = [
  {
    title: 'Fitness Tracker',
    prompt: 'Build a fitness tracking app with workout logging where users can record exercises, sets, reps, and weights. Include progress charts that visualize strength gains and workout frequency over time, a searchable exercise library with muscle group filters, and a personal records dashboard to track PRs.',
    appType: 'mobile' as AppType,
    icon: Dumbbell,
    color: '#10b981',
  },
  {
    title: 'Recipe Manager',
    prompt: 'Create a recipe management app where users can save and organize recipes with ingredient lists, step-by-step cooking instructions with timers, and nutritional information. Include a weekly meal planner with drag-and-drop scheduling, an automatic grocery list generator based on planned meals, and the ability to scale ingredient quantities by serving size.',
    appType: 'mobile' as AppType,
    icon: CookingPot,
    color: '#f59e0b',
  },
  {
    title: 'CRM Dashboard',
    prompt: 'Build a customer relationship management dashboard for sales teams with a pipeline view showing deals across stages, contact profiles with interaction history and notes, revenue forecasting charts, team performance leaderboards, and activity feeds tracking emails, calls, and meetings per account.',
    appType: 'web' as AppType,
    icon: LayoutDashboard,
    color: '#3b82f6',
  },
  {
    title: 'Invoice Manager',
    prompt: 'Create an invoicing and billing management tool for small businesses with customizable invoice templates, client management with payment terms, automated payment reminders for overdue invoices, a dashboard showing outstanding vs. paid amounts, expense categorization, and exportable financial reports.',
    appType: 'web' as AppType,
    icon: Wallet,
    color: '#a855f7',
  },
]

// ─── Activity helpers ───────────────────────────────────────────────────────

interface ActivityItem {
  id: string
  projectTitle: string
  projectId: string
  action: string
  icon: LucideIcon
  color: string
  date: Date
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function buildActivityFeed(projects: Project[]): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const project of projects) {
    // Imported from GitHub
    if (project.sourceUrl && project.importStatus === 'complete') {
      items.push({
        id: `${project.id}-import`,
        projectTitle: project.title,
        projectId: project.id,
        action: 'Imported from GitHub',
        icon: GitBranch,
        color: '#a855f7',
        date: new Date(project.createdAt),
      })
    } else {
      // Created project
      items.push({
        id: `${project.id}-create`,
        projectTitle: project.title,
        projectId: project.id,
        action: 'Created project',
        icon: FolderPlus,
        color: '#3b82f6',
        date: new Date(project.createdAt),
      })
    }
  }

  return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 5)
}

// ─── Component ──────────────────────────────────────────────────────────────

interface HomeRightPanelProps {
  projects: Project[]
  onStartProject: (prompt: string, appType: AppType) => void
  onProjectClick: (project: Project) => void
}

export function HomeRightPanel({ projects, onStartProject, onProjectClick }: HomeRightPanelProps) {
  const activityItems = buildActivityFeed(projects)

  return (
    <div className="home-right-panel">
      {/* Project Ideas */}
      <div style={{ marginBottom: '28px' }}>
        <h3 style={{
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'hsl(var(--muted-foreground) / 0.65)',
          marginBottom: '10px',
        }}>
          Project Ideas
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {PROJECT_IDEAS.map((idea) => {
            const Icon = idea.icon
            return (
              <button
                key={idea.title}
                onClick={() => onStartProject(idea.prompt, idea.appType)}
                className="home-right-panel-card"
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: `${idea.color}15`,
                    flexShrink: 0,
                    marginTop: '1px',
                  }}>
                    <Icon size={14} style={{ color: idea.color }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'hsl(var(--foreground))', marginBottom: '2px' }}>
                      {idea.title}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'hsl(var(--muted-foreground))',
                      lineHeight: '1.4',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}>
                      {idea.prompt}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', backgroundColor: 'hsl(var(--border))', marginBottom: '20px' }} />

      {/* Recent Activity */}
      {activityItems.length > 0 && (
        <div>
          <h3 style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'hsl(var(--muted-foreground) / 0.65)',
            marginBottom: '12px',
          }}>
            Recent Activity
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {activityItems.map((item) => {
              const Icon = item.icon
              const matchingProject = projects.find((p) => p.id === item.projectId)
              return (
                <button
                  key={item.id}
                  onClick={() => matchingProject && onProjectClick(matchingProject)}
                  className="home-activity-item"
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: item.color,
                    flexShrink: 0,
                    marginTop: '6px',
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'hsl(var(--foreground))',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.projectTitle}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      <Icon size={11} style={{ color: 'hsl(var(--muted-foreground))' }} />
                      <span style={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}>
                        {item.action}
                      </span>
                      <span style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground) / 0.5)' }}>
                        {formatRelativeTime(item.date)}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
