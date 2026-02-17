import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

export interface ConvexDashboardProps {
  deploymentUrl: string
  deploymentName: string
  deployKey: string
  visiblePages?: string[]
  isVisible?: boolean
}

export function ConvexDashboard({
  deploymentUrl,
  deploymentName,
  deployKey,
  visiblePages,
  isVisible = true,
}: ConvexDashboardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showIframe, setShowIframe] = useState(false)

  // Reset showIframe when visibility changes
  useEffect(() => {
    if (isVisible) {
      setShowIframe(false)
    }
  }, [isVisible])

  // Create a unique key that changes when config changes to force iframe reload
  const iframeKey = useMemo(
    () => `${deploymentUrl}-${deploymentName}-${deployKey}-${JSON.stringify(visiblePages)}`,
    [deploymentUrl, deploymentName, deployKey, visiblePages]
  )

  // Reset showIframe and start timer when visibility or config changes
  useEffect(() => {
    if (!isVisible) {
      return
    }

    // Always reset to show loading screen
    setShowIframe(false)

    // Start timer to show iframe after 5 seconds
    const timer = setTimeout(() => {
      setShowIframe(true)
    }, 5000) // 5 second delay

    return () => clearTimeout(timer)
  }, [isVisible, iframeKey])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // We first wait for the iframe to send a dashboard-credentials-request message.
      // This makes sure that we don't send the credentials until the iframe is ready.
      if (event.data?.type !== 'dashboard-credentials-request') {
        return
      }
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: 'dashboard-credentials',
          adminKey: deployKey,
          deploymentUrl,
          deploymentName,
          // Optional: specify which pages to show
          visiblePages,
        },
        '*'
      )
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [deploymentUrl, deployKey, deploymentName, visiblePages])

  if (!isVisible) {
    return null
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        {/* Render iframe immediately but hidden so it can load and request credentials */}
        <iframe
          key={iframeKey}
          title="convex dashboard"
          ref={iframeRef}
          // You can also default on other pages, for instance /functions, /files or /logs
          src="https://dashboard-embedded.convex.dev/data"
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
      </div>
    </div>
  )
}
