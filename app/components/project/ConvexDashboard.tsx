import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { window as sidecarWindow } from '@/app/api/sidecar'

type DashboardHostStatus = 'loading' | 'ready' | 'error'
type DashboardHostErrorCode = 'handshake_timeout' | 'iframe_load_error' | 'handshake_failed'

export interface ConvexDashboardProps {
  deploymentUrl: string
  deploymentName: string
  deployKey: string
  visiblePages?: string[]
  isVisible?: boolean
  onStatusChange?: (status: DashboardHostStatus) => void
  onError?: (reason: string) => void
  onOpenSettings?: () => void
  onOpenExternal?: () => void
}

export function ConvexDashboard({
  deploymentUrl,
  deploymentName,
  deployKey,
  visiblePages,
  isVisible = true,
  onStatusChange,
  onError,
  onOpenSettings,
  onOpenExternal,
}: ConvexDashboardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const handshakeReceivedRef = useRef(false)
  const [showIframe, setShowIframe] = useState(false)
  const [hostStatus, setHostStatus] = useState<DashboardHostStatus>('loading')
  const [hostErrorCode, setHostErrorCode] = useState<DashboardHostErrorCode | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const embeddedOrigin = 'https://dashboard-embedded.convex.dev'
  const externalDashboardUrl = `https://dashboard.convex.dev/d/${deploymentName}`

  // Reset local dashboard state whenever visibility/config changes.
  useEffect(() => {
    if (isVisible) {
      handshakeReceivedRef.current = false
      setShowIframe(false)
      setHostStatus('loading')
      setHostErrorCode(null)
    }
  }, [isVisible, deploymentUrl, deploymentName, deployKey, retryNonce])

  // Create a unique key that changes when config changes to force iframe reload
  const iframeKey = useMemo(
    () => `${deploymentUrl}-${deploymentName}-${deployKey}-${JSON.stringify(visiblePages)}-${retryNonce}`,
    [deploymentUrl, deploymentName, deployKey, visiblePages, retryNonce]
  )

  // Reveal iframe after a short delay so users see progress, then fail gracefully if no handshake arrives.
  useEffect(() => {
    if (!isVisible) {
      return
    }

    const revealTimer = setTimeout(() => {
      setShowIframe(true)
    }, 800)

    const handshakeTimeout = setTimeout(() => {
      if (handshakeReceivedRef.current) {
        return
      }
      setHostStatus('error')
      setHostErrorCode('handshake_timeout')
    }, 8000)

    return () => {
      clearTimeout(revealTimer)
      clearTimeout(handshakeTimeout)
    }
  }, [isVisible, iframeKey])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isVisible) {
        return
      }

      const data = event.data
      if (!data || typeof data !== 'object' || (data as { type?: string }).type !== 'dashboard-credentials-request') {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow) return
      if (event.origin !== embeddedOrigin || event.source !== iframeWindow) {
        console.warn('[ConvexDashboard] Ignoring credential request from unexpected origin/source:', {
          origin: event.origin,
          expectedOrigin: embeddedOrigin,
        })
        return
      }

      try {
        iframeWindow.postMessage(
          {
            type: 'dashboard-credentials',
            adminKey: deployKey,
            deploymentUrl,
            deploymentName,
            visiblePages,
          },
          embeddedOrigin
        )
        handshakeReceivedRef.current = true
        setHostStatus('ready')
        setShowIframe(true)
      } catch (error) {
        console.error('[ConvexDashboard] Failed to send dashboard credentials:', error)
        setHostStatus('error')
        setHostErrorCode('handshake_failed')
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [deploymentUrl, deployKey, deploymentName, visiblePages, isVisible])

  useEffect(() => {
    onStatusChange?.(hostStatus)
  }, [hostStatus, onStatusChange])

  useEffect(() => {
    if (hostStatus !== 'error' || !hostErrorCode) {
      return
    }

    const reason = `Convex dashboard failed: ${hostErrorCode}`
    console.warn('[ConvexDashboard]', reason)
    onError?.(reason)
  }, [hostStatus, hostErrorCode, onError])

  if (!isVisible) {
    return null
  }

  const handleOpenExternal = () => {
    if (onOpenExternal) {
      onOpenExternal()
      return
    }
    sidecarWindow.webOpenUrl(externalDashboardUrl).catch((error) => {
      console.error('Failed to open Convex dashboard URL:', error)
    })
  }

  const errorMessage =
    hostErrorCode === 'handshake_timeout'
      ? 'Timed out waiting for Convex dashboard to initialize.'
      : hostErrorCode === 'iframe_load_error'
        ? 'Failed to load Convex dashboard iframe.'
        : 'Failed to send credentials to Convex dashboard.'

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ contain: 'strict' }}>
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        {hostStatus === 'error' ? (
          <div className="h-full w-full flex items-center justify-center p-6 bg-background">
            <div className="max-w-lg w-full rounded-xl border border-border/60 bg-card/50 p-5 space-y-4">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">Couldn’t load Convex dashboard</h3>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  onClick={() => setRetryNonce((prev) => prev + 1)}
                >
                  Retry
                </button>
                <button
                  className="px-3 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent transition-colors"
                  onClick={onOpenSettings}
                >
                  Open Settings
                </button>
                <button
                  className="px-3 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent transition-colors"
                  onClick={handleOpenExternal}
                >
                  Open Convex Dashboard
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Render iframe immediately but hidden so it can load and request credentials */}
        <iframe
          key={iframeKey}
          title="convex dashboard"
          ref={iframeRef}
          // You can also default on other pages, for instance /functions, /files or /logs
          src="https://dashboard-embedded.convex.dev/data"
          onError={() => {
            setHostStatus('error')
            setHostErrorCode('iframe_load_error')
          }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          allow="clipboard-write"
          className={`w-full h-full border-0 absolute inset-0 ${
            showIframe ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />
        {/* Show spinner until iframe is ready to be displayed */}
        {!showIframe && (
          <div className="h-full w-full flex items-center justify-center absolute inset-0 bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
          </>
        )}
      </div>
    </div>
  )
}
