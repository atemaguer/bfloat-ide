import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle, ExternalLink, X } from 'lucide-react'
import { useStore } from '@nanostores/react'
import { deployStore } from '@/app/stores/deploy'

export function DeploymentNotification() {
  const notification = useStore(deployStore.deploymentNotification)
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = document.createElement('div')
    el.setAttribute('data-deploy-toast-root', 'true')
    document.body.appendChild(el)
    setPortalEl(el)
    return () => {
      document.body.removeChild(el)
      setPortalEl(null)
    }
  }, [])

  useEffect(() => {
    if (!notification) return

    const timer = setTimeout(() => {
      deployStore.dismissDeploymentNotification()
    }, 6000)

    return () => clearTimeout(timer)
  }, [notification])

  if (!notification || !portalEl) {
    return null
  }

  const isSuccess = notification.status === 'success'

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed bottom-4 right-4 z-[9999] flex items-start gap-2 rounded-md border border-border bg-card/95 px-3 py-2 shadow-md backdrop-blur"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ type: 'spring', damping: 30, stiffness: 380 }}
        role="status"
        aria-live="polite"
      >
        <div
          className={`flex flex-1 items-start gap-2 ${!isSuccess ? 'cursor-pointer rounded -m-1 p-1 transition-colors hover:bg-muted/50' : ''}`}
          onClick={
            !isSuccess
              ? () => {
                  deployStore.openIOSProgressModal()
                  deployStore.dismissDeploymentNotification()
                }
              : undefined
          }
          role={!isSuccess ? 'button' : undefined}
          tabIndex={!isSuccess ? 0 : undefined}
        >
          <div
            className={`flex h-6 w-6 items-center justify-center rounded flex-shrink-0 ${
              isSuccess ? 'bg-green-500/15 text-green-500' : 'bg-destructive/15 text-destructive'
            }`}
          >
            {isSuccess ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-foreground">
              {notification.platform.toUpperCase()} build {isSuccess ? 'succeeded' : 'failed'}
            </span>
            <span className="text-[11px] text-muted-foreground">{notification.message}</span>
            {notification.buildUrl && (
              <a
                href={notification.buildUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={10} />
                View build
              </a>
            )}
            {!isSuccess && (
              <span className="text-[10px] text-muted-foreground/60">Click to view logs</span>
            )}
          </div>
        </div>
        <button
          onClick={() => deployStore.dismissDeploymentNotification()}
          className="ml-2 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss"
        >
          <X size={11} />
        </button>
      </motion.div>
    </AnimatePresence>,
    portalEl
  )
}
