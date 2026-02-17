import { useStore } from '@nanostores/react'
import { Globe, Smartphone, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { deployStore, type Deployment, type DeploymentPlatform } from '@/app/stores/deploy'

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

function getPlatformIcon(platform: DeploymentPlatform) {
  switch (platform) {
    case 'web':
      return <Globe size={14} className="text-muted-foreground" />
    case 'android':
    case 'ios':
      return <Smartphone size={14} className="text-muted-foreground" />
    default:
      return null
  }
}

function getStatusIcon(status: Deployment['status']) {
  switch (status) {
    case 'success':
      return <CheckCircle2 size={14} className="text-green-500" />
    case 'error':
      return <XCircle size={14} className="text-red-500" />
    case 'running':
      return <Clock size={14} className="text-yellow-500 animate-pulse" />
    default:
      return null
  }
}

function getPlatformLabel(platform: DeploymentPlatform): string {
  switch (platform) {
    case 'web':
      return 'Web'
    case 'android':
      return 'Android'
    case 'ios':
      return 'iOS'
    default:
      return platform
  }
}

interface DeploymentHistoryProps {
  maxItems?: number
}

export function DeploymentHistory({ maxItems = 5 }: DeploymentHistoryProps) {
  const deployments = useStore(deployStore.deployments)

  const recentDeployments = deployments.slice(0, maxItems)

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Latest Publishes</h3>
        {deployments.length > maxItems && (
          <button className="text-xs text-muted-foreground hover:text-primary transition-colors">
            View All
          </button>
        )}
      </div>

      {recentDeployments.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">No deployments yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your deployment history will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recentDeployments.map((deployment) => (
            <div
              key={deployment.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {getPlatformIcon(deployment.platform)}
                  <span className="text-sm text-foreground">
                    {getPlatformLabel(deployment.platform)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {getStatusIcon(deployment.status)}
                  <span className="text-xs text-muted-foreground">
                    {deployment.status === 'running'
                      ? 'In progress'
                      : formatRelativeTime(deployment.completedAt || deployment.startedAt)}
                  </span>
                </div>
              </div>

              {deployment.url && deployment.status === 'success' && (
                <a
                  href={deployment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  View <ExternalLink size={10} />
                </a>
              )}

              {deployment.error && deployment.status === 'error' && (
                <span className="text-xs text-red-500 truncate max-w-[150px]" title={deployment.error}>
                  {deployment.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
