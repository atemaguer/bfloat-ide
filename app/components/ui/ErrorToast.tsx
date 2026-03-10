import { useEffect, type MouseEvent } from 'react'
import toast, { type Toast } from 'react-hot-toast'
import { AlertCircle, X } from 'lucide-react'

const DEFAULT_MAX_LENGTH = 120
const DEFAULT_ERROR_DURATION = 6000

interface ErrorToastAction {
  label: string
  onClick: () => void
  className?: string
}

interface ErrorToastViewProps {
  toastId: string
  displayMessage: string
  fullMessage: string
  actions?: ErrorToastAction[]
  allowCopy: boolean
}

interface ShowErrorToastOptions {
  id?: string
  duration?: number
  maxLength?: number
  actions?: ErrorToastAction[]
  allowCopy?: boolean
  width?: string
}

function normalizeErrorMessage(message: unknown): string {
  if (typeof message === 'string') return message
  if (message instanceof Error) return message.message
  if (message === null || message === undefined) return 'Unexpected error'

  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

function truncateMessage(message: string, maxLength: number): { text: string; truncated: boolean } {
  if (message.length <= maxLength) {
    return { text: message, truncated: false }
  }

  const trimmed = message.slice(0, Math.max(1, maxLength - 1)).trimEnd()
  return { text: `${trimmed}...`, truncated: true }
}

function ErrorToastView({ toastId, displayMessage, fullMessage, actions, allowCopy }: ErrorToastViewProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toast.dismiss(toastId)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [toastId])

  const closeToast = () => {
    toast.dismiss(toastId)
  }

  const handleActionClick = (event: MouseEvent<HTMLButtonElement>, action: ErrorToastAction) => {
    event.stopPropagation()
    action.onClick()
  }

  const handleCopy = () => {
    navigator.clipboard
      .writeText(fullMessage)
      .then(() => toast.success('Copied error'))
      .catch(() => toast.error('Failed to copy'))
  }

  return (
    <div
      className="flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 shadow-lg"
      role="alert"
      aria-live="assertive"
      style={{
        width: '100%',
        maxWidth: '420px',
        background: 'color-mix(in srgb, hsl(var(--destructive)) 12%, hsl(var(--card)))',
        color: 'hsl(var(--foreground))',
        borderColor: 'color-mix(in srgb, hsl(var(--destructive)) 45%, hsl(var(--border)))',
      }}
    >
      <div className="shrink-0 pt-0.5 text-destructive" aria-hidden="true">
        <AlertCircle size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{displayMessage}</p>
        {(allowCopy || (actions && actions.length > 0)) && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            {allowCopy && (
              <button
                type="button"
                className="cursor-pointer rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/8"
                onClick={handleCopy}
              >
                COPY
              </button>
            )}
            {actions?.map((action) => (
              <button
                key={action.label}
                type="button"
                className={
                  action.className ??
                  'cursor-pointer rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/8'
                }
                onClick={(event) => handleActionClick(event, action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss error notification"
        className="shrink-0 self-start cursor-pointer rounded p-1 leading-none text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8"
        onClick={closeToast}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function showErrorToast(message: unknown, options: ShowErrorToastOptions = {}) {
  const fullMessage = normalizeErrorMessage(message)
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  const { text, truncated } = truncateMessage(fullMessage, maxLength)
  const toastId = options.id ?? `error-${Date.now()}`

  return toast.custom(
    (t: Toast) => (
      <ErrorToastView
        toastId={t.id}
        displayMessage={text}
        fullMessage={fullMessage}
        allowCopy={options.allowCopy ?? truncated}
        actions={options.actions}
      />
    ),
    {
      id: toastId,
      duration: options.duration ?? DEFAULT_ERROR_DURATION,
      style: {
        width: options.width ?? 'min(420px, calc(100vw - 2rem))',
        maxWidth: options.width ?? 'min(420px, calc(100vw - 2rem))',
        padding: 0,
        background: 'transparent',
        boxShadow: 'none',
        border: 'none',
      },
    },
  )
}

export type { ErrorToastAction, ShowErrorToastOptions }
