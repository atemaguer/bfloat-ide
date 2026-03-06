import { useState } from 'react'
import { ExternalLink, Loader2, CheckCircle, XCircle, Clock, RefreshCw, Wrench } from 'lucide-react'
import { workbenchStore } from '@/app/stores/workbench'
import { buildDeployErrorPrompt } from '@/app/utils/build-error-prompt'

// Local-first stubs: web deployment via backend API is no longer supported.
type DeploymentStatusType = 'pending' | 'building' | 'deploying' | 'live' | 'failed'

interface DeploymentStatus {
  status: DeploymentStatusType
  url?: string
  statusMessage?: string
}

interface DeployWebSectionProps {
  disabled?: boolean
}

const STATUS_CONFIG: Record<DeploymentStatusType, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Clock size={14} />, label: 'Pending', color: 'text-yellow-500' },
  building: { icon: <Loader2 size={14} className="animate-spin" />, label: 'Building', color: 'text-blue-500' },
  deploying: { icon: <Loader2 size={14} className="animate-spin" />, label: 'Deploying', color: 'text-blue-500' },
  live: { icon: <CheckCircle size={14} />, label: 'Live', color: 'text-green-500' },
  failed: { icon: <XCircle size={14} />, label: 'Failed', color: 'text-red-500' },
}

export function DeployWebSection({ disabled = false }: DeployWebSectionProps) {
  const [isDeploying, setIsDeploying] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isFixing, setIsFixing] = useState(false)
  const [deployment, setDeployment] = useState<DeploymentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Handle deploy - web deployment via backend is not supported in local-first mode
  const handleDeploy = async () => {
    if (isDeploying || disabled) return
    setError('Web deployment is not available in local-first mode.')
  }

  // Handle cancel deployment
  const handleCancel = async () => {
    if (isCancelling) return
    setIsCancelling(false)
    setDeployment(null)
  }

  const handleFixWithAI = async () => {
    setIsFixing(true)
    try {
      const prompt = buildDeployErrorPrompt({
        platform: 'web',
        errorMessage: deployment?.statusMessage || error || 'Build failed',
        logs: '',
      })
      workbenchStore.triggerChatPrompt(prompt)
    } finally {
      setIsFixing(false)
    }
  }

  const isInProgress = deployment?.status === 'building' || deployment?.status === 'deploying' || deployment?.status === 'pending'
  const isWorking = isDeploying || isInProgress || isCancelling
  const statusConfig = deployment ? STATUS_CONFIG[deployment.status] : null

  // Determine button text
  const getButtonContent = () => {
    if (isDeploying && !isInProgress) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>Starting...</span>
        </>
      )
    }
    if (isInProgress) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>{deployment?.status === 'building' ? 'Building...' : 'Deploying...'}</span>
        </>
      )
    }
    if (deployment?.status === 'live') {
      return (
        <>
          <RefreshCw size={14} />
          <span>Republish</span>
        </>
      )
    }
    return <span>Publish</span>
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Publish button row */}
      <div className="flex items-center justify-between ps-4 pe-3 py-3 border-0 bg-background rounded-[10px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">Publish to Web</span>
          {deployment ? (
            <div className="flex items-center gap-2 text-xs">
              <span className={`flex items-center gap-1 ${statusConfig?.color}`}>
                {statusConfig?.icon}
                {statusConfig?.label}
              </span>
              {deployment.url && deployment.status === 'live' && (
                <a
                  href={deployment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  View <ExternalLink size={10} />
                </a>
              )}
              {deployment.status === 'failed' && (
                <button
                  onClick={handleFixWithAI}
                  disabled={isFixing}
                  className="text-primary hover:underline flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isFixing ? <Loader2 size={10} className="animate-spin" /> : <Wrench size={10} />}
                  <span>{isFixing ? 'Loading...' : 'Fix with AI'}</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
        {isInProgress ? (
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-destructive border border-destructive/30 rounded-[10px] transition-all hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer gap-2"
          >
            {isCancelling ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Cancelling...</span>
              </>
            ) : (
              <>
                <XCircle size={14} />
                <span>Cancel</span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleDeploy}
            disabled={disabled || isWorking}
            className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium bg-foreground text-background rounded-[10px] transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer gap-2"
          >
            {getButtonContent()}
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-[10px] text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Deployed URL */}
      {deployment?.url && deployment.status === 'live' && (
        <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-[10px]">
          <div className="text-xs text-green-600 flex items-center gap-2">
            <CheckCircle size={12} />
            <span>Live at:</span>
            <a
              href={deployment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              {deployment.url}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
