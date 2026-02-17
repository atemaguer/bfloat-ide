/**
 * Deploy Progress Modal
 *
 * Shows a friendly progress UI for iOS deployment instead of raw terminal output.
 * Displays steps, progress bar, and current status with options to view logs or cancel.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Check,
  Circle,
  Loader2,
  AlertCircle,
  ExternalLink,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Minimize2,
  Clock,
  Copy,
  Wrench,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/app/components/ui/dialog'
import { type DeployStep, getDeploySteps, getStepStatus } from '@/app/utils/eas-output-parser'
import { cleanTerminalOutput } from '@/app/utils/clean-logs'

export interface DeployProgressState {
  step: DeployStep
  percent: number
  message: string
  buildUrl?: string
  error?: string
}

interface DeployProgressModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  progress: DeployProgressState
  logs: string
  onCancel: () => void
  onRetry: () => void
  onClose: () => void
  onMinimize?: () => void
  onFixWithAI?: () => void
}

function StepIcon({ status }: { status: 'pending' | 'running' | 'complete' | 'error' }) {
  switch (status) {
    case 'complete':
      return (
        <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
          <Check size={12} className="text-white" />
        </div>
      )
    case 'running':
      return (
        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
          <Loader2 size={12} className="text-white animate-spin" />
        </div>
      )
    case 'error':
      return (
        <div className="w-5 h-5 rounded-full bg-destructive flex items-center justify-center">
          <AlertCircle size={12} className="text-white" />
        </div>
      )
    default:
      return (
        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
          <Circle size={8} className="text-muted-foreground/30" />
        </div>
      )
  }
}

function ProgressBar({ percent }: { percent: number }) {
  const safePercent = Math.max(0, Math.min(100, percent))

  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div
        className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
        style={{ width: `${safePercent}%` }}
      />
    </div>
  )
}

export function DeployProgressModal({
  open,
  onOpenChange,
  progress,
  logs,
  onCancel,
  onRetry,
  onClose,
  onMinimize,
  onFixWithAI,
}: DeployProgressModalProps) {
  const [showLogs, setShowLogs] = useState(false)
  const [copied, setCopied] = useState(false)
  const steps = getDeploySteps()
  const hasError = progress.step === 'error'
  const isComplete = progress.step === 'complete'
  const isQueued = progress.step === 'queued'
  const isRunning = !hasError && !isComplete

  // Auto-expand logs when modal opens in error state
  useEffect(() => {
    if (open && hasError) {
      setShowLogs(true)
    }
  }, [open, hasError])

  const handleClose = useCallback(() => {
    if (!isRunning) {
      onClose()
      onOpenChange(false)
    }
  }, [isRunning, onClose, onOpenChange])

  const handleCopyError = useCallback(() => {
    // Copy the logs which contain the actual error details
    // Fall back to error message if no logs available
    const logTail = logs ? logs.slice(-4000) : '' // Last 4000 chars of logs (before cleaning)

    let textToCopy = ''
    if (logTail) {
      // Strip ANSI escape codes
      const stripped = logTail.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '')
      // Split into lines and filter
      const lines = stripped
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => {
          if (!line) return false
          // Filter out progress/spinner lines
          if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]*$/.test(line)) return false
          if (line.includes('Build in progress')) return false
          if (line.includes('Waiting for build')) return false
          return true
        })
      // Deduplicate consecutive duplicates
      const deduped: string[] = []
      for (const line of lines) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== line) {
          deduped.push(line)
        }
      }
      textToCopy = deduped.join('\n')
    } else if (progress.error) {
      textToCopy = progress.error
    }

    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [logs, progress.error])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[70vw] max-w-3xl px-12">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasError && <AlertCircle size={20} className="text-destructive" />}
            {isComplete && <Check size={20} className="text-green-500" />}
            {isRunning && <Loader2 size={20} className="animate-spin text-primary" />}
            <span>
              {hasError ? 'Publishing Failed' : isComplete ? 'Publishing Complete' : 'Publishing to iOS App Store'}
            </span>
          </DialogTitle>
          <DialogDescription>
            {hasError
              ? 'An error occurred during publishing.'
              : isComplete
                ? 'Your app is now available on TestFlight.'
                : progress.message}
          </DialogDescription>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="mt-4 space-y-3">
          {steps.map((step) => {
            const status = getStepStatus(step.id, progress.step, hasError)
            return (
              <div key={step.id} className="flex items-center gap-3">
                <StepIcon status={status} />
                <span
                  className={`text-sm ${
                    status === 'complete'
                      ? 'text-foreground'
                      : status === 'running'
                        ? 'text-foreground font-medium'
                        : status === 'error'
                          ? 'text-destructive font-medium'
                          : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
                {status === 'running' && !hasError && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {progress.percent > 0 ? `${progress.percent}%` : ''}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Progress Bar */}
        {isRunning && (
          <div className="mt-4">
            <ProgressBar percent={progress.percent} />
          </div>
        )}

        {/* Queue Alert */}
        {isQueued && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <Clock size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Waiting in EAS Build Queue</p>
                <p className="text-xs text-muted-foreground">
                  Free tier builds wait for available slots. This can take several minutes during peak hours.
                </p>
                <a
                  href="https://expo.dev/accounts/ben_afloat/settings/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  <ExternalLink size={10} />
                  Upgrade for priority builds
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {hasError && progress.error && (
          <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-destructive flex-1">{progress.error}</p>
              <button
                onClick={handleCopyError}
                className="p-1 rounded hover:bg-destructive/20 transition-colors flex-shrink-0"
                title="Copy error message"
              >
                {copied ? (
                  <Check size={14} className="text-green-500" />
                ) : (
                  <Copy size={14} className="text-destructive" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Build URL */}
        {progress.buildUrl && (
          <div className="mt-4">
            <a
              href={progress.buildUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink size={14} />
              View build on Expo
            </a>
          </div>
        )}

        {/* Logs Toggle */}
        <div className="mt-4">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showLogs ? 'Hide logs' : 'View logs'}
          </button>

          {showLogs && (
            <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border max-h-80 overflow-y-auto font-mono text-xs">
              <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                {logs ? cleanTerminalOutput(logs) : 'No logs yet...'}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3 justify-end">
          {isRunning && (
            <>
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              {onMinimize && (
                <button
                  onClick={onMinimize}
                  className="px-4 py-2 text-sm font-medium bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors flex items-center gap-1.5"
                  title="Continue in background"
                >
                  <Minimize2 size={14} />
                  Minimize
                </button>
              )}
            </>
          )}

          {hasError && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
              {onFixWithAI && (
                <button
                  onClick={onFixWithAI}
                  className="px-4 py-2 text-sm font-medium bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Wrench size={14} />
                  Fix with AI
                </button>
              )}
              <button
                onClick={onRetry}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw size={14} />
                Retry
              </button>
            </>
          )}

          {isComplete && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          )}
        </div>

        {/* Close button for completed/error states */}
        {!isRunning && (
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </DialogContent>
    </Dialog>
  )
}
