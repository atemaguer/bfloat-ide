import { useEffect, useRef, useState } from 'react'
import { Loader2, Download, ExternalLink } from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { providerAuthStore } from '@/app/stores/provider-auth'

type AuthProvider = 'anthropic' | 'openai'

interface ProviderAuthModalProps {
  open: boolean
  provider: AuthProvider
  onOpenChange: (open: boolean) => void
  onComplete?: () => void | Promise<void>
}

// Check if running on Windows
const isWindows = typeof window !== 'undefined' && navigator.platform.toLowerCase().includes('win')

const PROVIDER_COPY: Record<AuthProvider, { title: string; description: string }> = {
  anthropic: {
    title: 'Connect Claude',
    description: 'We will launch the Claude Code CLI. A browser window should open for you to sign in.',
  },
  openai: {
    title: 'Connect ChatGPT',
    description: 'We will launch the Codex CLI. A browser window should open for you to sign in.',
  },
}

type AuthStage =
  | 'checking-cli'
  | 'launching-cli'
  | 'waiting-browser'
  | 'extracting-token'
  | 'saving-credentials'
  | 'success'
  | 'error'

const STAGE_MESSAGES: Record<AuthStage, string> = {
  'checking-cli': 'Checking CLI installation...',
  'launching-cli': 'Launching authentication flow...',
  'waiting-browser': 'Waiting for you to sign in via browser...',
  'extracting-token': 'Extracting credentials...',
  'saving-credentials': 'Saving credentials...',
  'success': 'Connected successfully!',
  'error': 'Authentication failed',
}

export function ProviderAuthModal({ open, provider, onOpenChange, onComplete }: ProviderAuthModalProps) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle')
  const [stage, setStage] = useState<AuthStage | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [isSelectingGitBash, setIsSelectingGitBash] = useState(false)
  const [claudeCliMissing, setClaudeCliMissing] = useState(false)
  const pendingErrorRef = useRef<string | null>(null)
  const openedUrlRef = useRef<string | null>(null)
  const authInProgressRef = useRef(false) // Prevent duplicate auth attempts (React StrictMode)

  useEffect(() => {
    if (!open) {
      setStatus('idle')
      setStage(null)
      setErrorMessage(null)
      setClaudeCliMissing(false)
      pendingErrorRef.current = null
      openedUrlRef.current = null
      authInProgressRef.current = false
      return
    }

    // Prevent duplicate auth attempts (React StrictMode runs effects twice)
    if (authInProgressRef.current) {
      return
    }
    authInProgressRef.current = true

    // Use ref instead of local variable for isActive so it survives React StrictMode
    // unmount/remount cycles. The IPC call started in the first mount will still
    // complete and we need to process its result.
    let resolved = false
    let timeoutTimer: number | null = null

    const clearTimers = () => {
      if (timeoutTimer) window.clearTimeout(timeoutTimer)
    }

    const finishSuccess = () => {
      if (resolved) return
      resolved = true
      clearTimers()
      authInProgressRef.current = false
      setStatus('success')
      setStage('success')
      setErrorMessage(null)
    }

    const finishError = (message: string) => {
      if (resolved) return
      resolved = true
      clearTimers()
      authInProgressRef.current = false
      setStatus('error')
      setStage('error')
      setErrorMessage(message)
    }

    const formatOutput = (output?: string | null) => {
      if (!output) return null
      const trimmed = output.trim()
      if (!trimmed) return null
      return trimmed
    }

    const startAuth = async () => {
      setStatus('connecting')
      setStage('checking-cli')
      setErrorMessage(null)
      pendingErrorRef.current = null

      if (!window.conveyor?.provider) {
        finishError('Provider API unavailable. Please restart the app.')
        return
      }

      // On Windows, check if Claude Code CLI is installed before proceeding
      if (isWindows && provider === 'anthropic') {
        try {
          const cliCheck = await window.conveyor.provider.checkClaudeCliInstalled()
          if (!cliCheck.installed) {
            setClaudeCliMissing(true)
            setStatus('idle')
            setStage(null)
            return
          }
        } catch {
          // Continue anyway - the auth might still work
        }
      }

      setStage('launching-cli')

      // Don't check if already connected - user explicitly wants to (re)connect
      // Don't poll for tokens - wait for the actual connection result
      // The handler will return success only if a NEW token was saved

      timeoutTimer = window.setTimeout(() => {
        finishError(pendingErrorRef.current || 'Authentication timed out. Please try again.')
      }, 3 * 60 * 1000) // 3 minutes for browser OAuth flow

      try {
        const result =
          provider === 'anthropic'
            ? await window.conveyor.provider.connectAnthropic()
            : await window.conveyor.provider.connectOpenAI()

        if (resolved) return

        const outputMessage = formatOutput(result.output)
        if (!result.success && outputMessage) {
          pendingErrorRef.current = outputMessage
        }

        // Only succeed if the handler confirms a NEW token was saved
        if (result.success) {
          await providerAuthStore.loadFromStorage()
          finishSuccess()
          return
        }

        // If not successful, show error
        finishError(outputMessage || 'Authentication failed. Please try again.')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authentication failed. Please try again.'
        finishError(message)
      }
    }

    startAuth()

    return () => {
      clearTimers()
      // Note: Don't reset authInProgressRef here - let the auth complete
      // It will be reset when finishSuccess/finishError is called or when modal closes
    }
  }, [open, provider, attempt])

  useEffect(() => {
    if (!open || !window.conveyor?.provider?.on) return

    const unsubscribe = window.conveyor.provider.on<{ provider: AuthProvider; data: string }>(
      'provider:auth-output',
      ({ provider: outputProvider, data }) => {
        if (outputProvider !== provider || !data) return

        // Detect stage from output
        const lowerData = data.toLowerCase()
        if (lowerData.includes('opening') || lowerData.includes('browser') || lowerData.includes('https://')) {
          setStage('waiting-browser')
        } else if (lowerData.includes('parsing') || lowerData.includes('extracting')) {
          setStage('extracting-token')
        } else if (lowerData.includes('saving') || lowerData.includes('saved')) {
          setStage('saving-credentials')
        }

        // Auto-open the first URL found in CLI output - only on Windows.
        // On Windows, the CLI runs in CI mode (no TTY) and won't open the
        // browser itself. On macOS/Linux, the CLI opens the browser automatically,
        // so we don't need to open it again (which would create duplicate tabs).
        if (isWindows && !openedUrlRef.current) {
          const urlMatch = data.match(/https?:\/\/[^\s]+/i)
          if (urlMatch && urlMatch[0]) {
            openedUrlRef.current = urlMatch[0]
            window.conveyor?.window?.webOpenUrl(urlMatch[0])
          }
        }
      }
    )

    return () => {
      unsubscribe?.()
    }
  }, [open, provider])

  const handleDone = async () => {
    await onComplete?.()
    onOpenChange(false)
  }

  const handleRetry = () => {
    setAttempt((value) => value + 1)
  }

  const needsGitBash =
    status === 'error' &&
    typeof errorMessage === 'string' &&
    errorMessage.toLowerCase().includes('git bash')

  const handleSelectGitBash = async () => {
    if (!window.conveyor?.provider?.selectGitBashPath) return
    setIsSelectingGitBash(true)

    try {
      const result = await window.conveyor.provider.selectGitBashPath()
      if (result.success && result.path) {
        setErrorMessage(null)
        setStatus('connecting')
        setAttempt((value) => value + 1)
      } else if (result.error) {
        setErrorMessage(result.error)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to select Git Bash.')
    } finally {
      setIsSelectingGitBash(false)
    }
  }

  const handleInstallGitBash = () => {
    window.conveyor?.window?.webOpenUrl('https://git-scm.com/download/win')
  }

  const handleDownloadClaude = () => {
    window.conveyor?.window?.webOpenUrl('https://claude.ai/download')
  }

  const handleRetryAfterInstall = () => {
    setClaudeCliMissing(false)
    setAttempt((value) => value + 1)
  }

  const copy = PROVIDER_COPY[provider]

  // Show Claude CLI download prompt for Windows users
  if (claudeCliMissing && provider === 'anthropic') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[70vw] max-w-3xl px-6 py-5">
          <DialogClose />
          <DialogHeader>
            <DialogTitle>Install Claude Code</DialogTitle>
            <DialogDescription>
              Claude Code CLI is required to use Claude as your AI provider on Windows.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-4">
              <div className="flex items-start gap-3">
                <Download className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-foreground font-medium">
                    Claude Code CLI not found
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Please download and install Claude Code from the official website.
                    After installation, click &quot;I&apos;ve Installed It&quot; to continue.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                <strong>Installation steps:</strong>
              </p>
              <ol className="list-decimal space-y-1 pl-5 mt-2 text-sm text-muted-foreground">
                <li>Click &quot;Download Claude Code&quot; below</li>
                <li>Run the installer and follow the prompts</li>
                <li>Restart this app if needed</li>
                <li>Click &quot;I&apos;ve Installed It&quot; to retry</li>
              </ol>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handleDownloadClaude} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Download Claude Code
            </Button>
            <Button variant="primary" onClick={handleRetryAfterInstall}>
              I&apos;ve Installed It
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[70vw] max-w-3xl px-6 py-5">
        <DialogClose />
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-4">
              <li>We will start the provider CLI sign-in flow.</li>
              <li>Complete authentication in your browser.</li>
              <li>We&apos;ll detect the saved credentials and finish.</li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              Keep this window open while you finish signing in. If no browser window appears, click Retry.
            </p>
          </div>

          {stage && stage !== 'success' && stage !== 'error' && (
            <div className="w-full p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {STAGE_MESSAGES[stage]}
              </p>
            </div>
          )}

          {status === 'success' && (
            <div className="w-full p-3 rounded-md bg-green-500/10 border border-green-500/20">
              <p className="text-sm text-green-700 dark:text-green-300">
                Connected successfully. You can close this window.
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="w-full p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive whitespace-pre-wrap">
                {errorMessage || 'Authentication failed. Please try again.'}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {needsGitBash && (
            <Button variant="outline" onClick={handleInstallGitBash}>
              Install Git Bash
            </Button>
          )}
          {needsGitBash && (
            <Button variant="outline" onClick={handleSelectGitBash} disabled={isSelectingGitBash}>
              {isSelectingGitBash ? 'Selecting...' : 'Select Git Bash'}
            </Button>
          )}
          {status === 'error' && (
            <Button variant="outline" onClick={handleRetry}>
              Retry
            </Button>
          )}
          <Button variant="primary" onClick={handleDone} disabled={status !== 'success'}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
