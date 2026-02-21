/**
 * AppleAuthStep - Apple ID and Password input form
 *
 * Collects Apple ID credentials for interactive authentication flow.
 * Shows session status if available and provides clear session option.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
  Shield,
  Key,
  Trash2,
} from 'lucide-react'
import type { AppleSessionInfo } from '@/lib/conveyor/schemas/deploy-schema'
import { deploy } from '@/app/api/sidecar'

interface AppleAuthStepProps {
  onSubmit: (appleId: string, password: string) => void
  onBack: () => void
  onUseApiKey: () => void
  isSubmitting?: boolean
  error?: string | null
  projectPath: string
}

const APPLE_ID_STORAGE_KEY = 'bfloat_apple_id'

export function AppleAuthStep({
  onSubmit,
  onBack,
  onUseApiKey,
  isSubmitting = false,
  error,
  projectPath,
}: AppleAuthStepProps) {
  const [appleId, setAppleId] = useState('')
  const [password, setPassword] = useState('')
  const [sessionInfo, setSessionInfo] = useState<AppleSessionInfo | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(false)
  const [isClearingSession, setIsClearingSession] = useState(false)
  const appleIdInputRef = useRef<HTMLInputElement>(null)

  // Load cached Apple ID on mount and focus appropriate field
  useEffect(() => {
    let cachedAppleId: string | null = null
    try {
      cachedAppleId = localStorage.getItem(APPLE_ID_STORAGE_KEY)
      if (cachedAppleId) {
        setAppleId(cachedAppleId)
      }
    } catch {
      // Ignore localStorage errors
    }

    // Focus the appropriate field after a brief delay to ensure DOM is ready
    requestAnimationFrame(() => {
      if (cachedAppleId) {
        // Apple ID is pre-filled, focus password field
        const passwordInput = document.getElementById('password-input') as HTMLInputElement
        passwordInput?.focus()
      } else {
        appleIdInputRef.current?.focus()
      }
    })
  }, [])

  // Check for existing session when Apple ID is entered
  useEffect(() => {
    if (!appleId || appleId.length < 5) {
      setSessionInfo(null)
      return
    }

    const checkSession = async () => {
      setIsCheckingSession(true)
      try {
        const info = await deploy.checkAppleSession(appleId)
        setSessionInfo(info)
      } catch {
        setSessionInfo(null)
      } finally {
        setIsCheckingSession(false)
      }
    }

    // Debounce the check
    const timeout = setTimeout(checkSession, 500)
    return () => clearTimeout(timeout)
  }, [appleId])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (appleId && password && !isSubmitting) {
      // Cache Apple ID for future use (not password for security)
      try {
        localStorage.setItem(APPLE_ID_STORAGE_KEY, appleId)
      } catch {
        // Ignore localStorage errors
      }
      onSubmit(appleId, password)
    }
  }, [appleId, password, isSubmitting, onSubmit])

  const handleClearSession = useCallback(async () => {
    if (!appleId) return
    setIsClearingSession(true)
    try {
      await deploy.clearAppleSession(appleId)
      setSessionInfo({ exists: false })
    } catch {
      // Ignore errors
    } finally {
      setIsClearingSession(false)
    }
  }, [appleId])

  // Unused variable removed to fix lint warning
  void projectPath

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Sign in with Apple ID</h3>
        <p className="text-sm text-muted-foreground">
          Enter your Apple ID credentials to authenticate with App Store Connect.
        </p>
      </div>

      {/* Security notice */}
      <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <div className="flex items-start gap-2">
          <Shield size={16} className="text-blue-500 mt-0.5" />
          <div>
            <p className="text-sm text-blue-400">Your credentials are secure</p>
            <p className="text-xs text-muted-foreground mt-1">
              Credentials are sent directly to Apple's servers and are not stored.
              Sessions are cached locally to reduce 2FA prompts.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="apple-id-input" className="block text-sm font-medium mb-1.5">
            Apple ID
          </label>
          <input
            ref={appleIdInputRef}
            id="apple-id-input"
            type="email"
            value={appleId}
            onChange={(e) => setAppleId(e.target.value)}
            placeholder="your@email.com"
            className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            disabled={isSubmitting}
            autoComplete="email"
          />
        </div>

        {/* Session status */}
        {appleId && !isCheckingSession && sessionInfo?.exists && (
          <div className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Key size={14} className="text-muted-foreground" />
              <span className="text-muted-foreground">{sessionInfo.statusMessage}</span>
            </div>
            <button
              type="button"
              onClick={handleClearSession}
              disabled={isClearingSession}
              className="text-xs text-destructive hover:underline flex items-center gap-1"
            >
              {isClearingSession ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              Clear
            </button>
          </div>
        )}

        <div>
          <label htmlFor="password-input" className="block text-sm font-medium mb-1.5">
            Password
          </label>
          <input
            id="password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your Apple ID password"
            className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            disabled={isSubmitting}
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-destructive mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5"
          >
            <ChevronLeft size={14} />
            Back
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !appleId || !password}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Authenticating...
              </>
            ) : (
              <>
                Continue
                <ChevronRight size={14} />
              </>
            )}
          </button>
        </div>
      </form>

      {/* API Key alternative */}
      <div className="pt-4 border-t border-border">
        <button
          type="button"
          onClick={onUseApiKey}
          className="w-full text-sm text-muted-foreground hover:text-foreground text-center"
        >
          Use App Store Connect API Key instead
        </button>
      </div>
    </div>
  )
}
