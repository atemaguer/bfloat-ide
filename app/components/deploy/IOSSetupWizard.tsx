/**
 * iOS Setup Wizard
 *
 * A GUI-first wizard for iOS deployment setup with two authentication paths:
 * 1. Apple ID + Password + 2FA (interactive, with terminal fallback)
 * 2. App Store Connect API Key (non-interactive, requires manual setup)
 *
 * Flow:
 * 1. Welcome - Choose auth method
 * 2. Expo Check - Verify Expo connection (if needed)
 * 3a. Apple Credentials - Apple ID + password form (if Apple ID flow)
 * 3b. API Key Setup - Form to configure App Store Connect API Key (if API key flow)
 * 4. 2FA - Enter verification code (if Apple ID flow and 2FA required)
 * 5. Terminal Fallback - Manual input for unknown prompts (if needed)
 * 6. Build Progress - Progress UI with logs
 * 7. Complete - Success screen
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useStore } from '@/app/hooks/useStore'
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
  ExternalLink,
  Smartphone,
  Key,
  Upload,
  ChevronDown,
  ChevronUp,
  FileKey,
  CheckCircle2,
  User,
  Copy,
  Bot,
} from 'lucide-react'
import { Dialog, DialogContent } from '@/app/components/ui/dialog'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { deployStore } from '@/app/stores/deploy'
import { workbenchStore } from '@/app/stores/workbench'
import { LogTerminal } from './LogTerminal'
import { AppleAuthStep } from './AppleAuthStep'
import { TwoFactorStep } from './TwoFactorStep'
import { TerminalFallbackStep } from './TerminalFallbackStep'
import type { iOSCredentialStatus } from '@/app/utils/ios-credentials'
import type { IOSBuildProgress, CheckASCApiKeyResult } from '@/lib/conveyor/schemas/deploy-schema'
import { getDefaultEasConfig } from '@/app/utils/eas-config'
import { deploy, filesystem } from '@/app/api/sidecar'

type WizardStep =
  | 'welcome'
  | 'expo'
  | 'apple-credentials'
  | 'apple-2fa'
  | 'terminal-fallback'
  | 'api-key-setup'
  | 'build-progress'
  | 'complete'

type AuthMethod = 'apple-id' | 'api-key' | null

/**
 * Ensure project is properly configured for iOS credentials
 */
async function ensureProjectConfiguration(
  projectPath: string,
  expoUsername: string | undefined,
  projectTitle: string
): Promise<void> {
  if (!filesystem) return

  // Extract project ID from path (format: ~/.bfloat-ide/projects/{projectId})
  const pathParts = projectPath.split('/')
  const projectId = pathParts[pathParts.length - 1]

  // 1. Ensure eas.json exists
  const easJsonPath = `${projectPath}/eas.json`
  const easResult = await filesystem.readFile(easJsonPath)

  if (!easResult.success) {
    const easConfig = getDefaultEasConfig()
    await filesystem.writeFile(easJsonPath, JSON.stringify(easConfig, null, 2))
  }

  // 2. Ensure bundle identifier is set in app.json
  const appJsonPath = `${projectPath}/app.json`
  const appResult = await filesystem.readFile(appJsonPath)

  if (appResult.success && appResult.content) {
    try {
      const appConfig = JSON.parse(appResult.content)
      let needsUpdate = false

      if (!appConfig.expo) appConfig.expo = {}
      if (!appConfig.expo.ios) appConfig.expo.ios = {}

      // Set bundle identifier if not present
      if (!appConfig.expo.ios.bundleIdentifier) {
        const owner = expoUsername?.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'app'
        const projectSlug = projectTitle.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'myapp'

        // Add unique suffix from project ID to prevent bundle identifier collisions
        // Use first 4 characters of the project ID (UUID) for uniqueness
        const uniqueSuffix = projectId?.replace(/-/g, '').slice(0, 4) || Math.random().toString(36).slice(2, 6)
        appConfig.expo.ios.bundleIdentifier = `com.${owner}.${projectSlug}${uniqueSuffix}`
        needsUpdate = true
      }

      // Set encryption compliance flag
      if (!appConfig.expo.ios.infoPlist) {
        appConfig.expo.ios.infoPlist = {}
      }
      if (appConfig.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption === undefined) {
        appConfig.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption = false
        needsUpdate = true
      }

      if (needsUpdate) {
        await filesystem.writeFile(appJsonPath, JSON.stringify(appConfig, null, 2))
      }
    } catch {
      // If JSON parsing fails, skip the update
    }
  }
}

interface IOSSetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  projectTitle: string
  credentialStatus: iOSCredentialStatus | null
  onComplete: () => void
  onSkipToTerminal: () => void
}

interface StepIndicatorProps {
  steps: Array<{ id: WizardStep; label: string }>
  currentStep: WizardStep
}

function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex
        const isCurrent = index === currentIndex

        return (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                isComplete
                  ? 'bg-green-500 text-white'
                  : isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {isComplete ? <Check size={14} /> : index + 1}
            </div>
            {index < steps.length - 1 && <div className={`w-8 h-0.5 ${isComplete ? 'bg-green-500' : 'bg-muted'}`} />}
          </div>
        )
      })}
    </div>
  )
}

// Build progress step labels
const BUILD_STEPS: Record<string, { label: string; percent: number }> = {
  init: { label: 'Initializing EAS project...', percent: 10 },
  credentials: { label: 'Setting up credentials...', percent: 30 },
  build: { label: 'Building iOS app...', percent: 50 },
  submit: { label: 'Submitting to TestFlight...', percent: 80 },
  complete: { label: 'Complete!', percent: 100 },
  error: { label: 'Error', percent: 0 },
}

export function IOSSetupWizard({
  open,
  onOpenChange,
  projectPath,
  projectTitle,
  credentialStatus,
  onComplete,
  onSkipToTerminal,
}: IOSSetupWizardProps) {
  const tokens = useStore(providerAuthStore.tokens)
  const buildLogs = useStore(deployStore.buildLogs)
  const interactiveAuthState = useStore(deployStore.interactiveAuthState)

  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome')
  const [authMethod, setAuthMethod] = useState<AuthMethod>(null)
  const [error, setError] = useState<string | null>(null)

  // API Key form state
  const [keyId, setKeyId] = useState('')
  const [issuerId, setIssuerId] = useState('')
  const [keyContent, setKeyContent] = useState('')
  const [keyFileName, setKeyFileName] = useState('')
  const [isSavingKey, setIsSavingKey] = useState(false)
  const [existingKeyConfig, setExistingKeyConfig] = useState<CheckASCApiKeyResult | null>(null)
  const [isCheckingKey, setIsCheckingKey] = useState(false)

  // Apple credential state
  const [hasExistingAppleSession, setHasExistingAppleSession] = useState(false)
  const [existingAppleId, setExistingAppleId] = useState<string | null>(null)
  const [checkedExistingSession, setCheckedExistingSession] = useState(false)

  // Build progress state
  const [buildProgress, setBuildProgress] = useState<IOSBuildProgress | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [isBuilding, setIsBuilding] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [errorCopied, setErrorCopied] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const openRef = useRef(open)
  const expoConnected = tokens.expo !== null

  // Default credential status if null
  const status = credentialStatus ?? {
    hasExpoToken: false,
    hasEasProject: false,
    hasDistributionCert: false,
    hasAscApiKey: false,
    isFullyConfigured: false,
    isFirstBuild: true,
  }

  // Check for existing API key when entering api-key-setup step
  useEffect(() => {
    if (currentStep === 'api-key-setup' && !existingKeyConfig && !isCheckingKey) {
      setIsCheckingKey(true)
      deploy
        .checkASCApiKey(projectPath)
        .then((config) => {
          setExistingKeyConfig(config)
          setIsCheckingKey(false)
        })
        .catch(() => {
          setIsCheckingKey(false)
        })
    }
  }, [currentStep, projectPath, existingKeyConfig, isCheckingKey])

  // When interactive auth state resets to 'none', go back to build-progress
  useEffect(() => {
    if (interactiveAuthState.mode === 'none' && (currentStep === 'apple-2fa' || currentStep === 'terminal-fallback')) {
      setCurrentStep('build-progress')
    }
  }, [interactiveAuthState.mode, currentStep])

  // Determine which steps to show based on auth method
  const steps = useMemo(() => {
    const stepList: Array<{ id: WizardStep; label: string }> = [{ id: 'welcome', label: 'Welcome' }]

    if (!expoConnected) {
      stepList.push({ id: 'expo', label: 'Expo' })
    }

    if (authMethod === 'apple-id') {
      stepList.push({ id: 'apple-credentials', label: 'Sign In' })
    } else if (authMethod === 'api-key') {
      if (!status.hasAscApiKey) {
        stepList.push({ id: 'api-key-setup', label: 'API Key' })
      }
    }

    // No build-progress or complete steps - Claude Code handles everything
    return stepList
  }, [expoConnected, authMethod, status.hasAscApiKey])

  // Get next step
  const getNextStep = useCallback((): WizardStep => {
    const currentIndex = steps.findIndex((s) => s.id === currentStep)
    if (currentIndex < steps.length - 1) {
      return steps[currentIndex + 1].id
    }
    return 'complete'
  }, [steps, currentStep])

  // Get previous step
  const getPreviousStep = useCallback((): WizardStep | null => {
    const currentIndex = steps.findIndex((s) => s.id === currentStep)
    if (currentIndex > 0) {
      return steps[currentIndex - 1].id
    }
    return null
  }, [steps, currentStep])

  const handleNext = useCallback(async () => {
    setError(null)
    setCurrentStep(getNextStep())
  }, [getNextStep])

  const handleBack = useCallback(() => {
    setError(null)
    const prev = getPreviousStep()
    if (prev) {
      setCurrentStep(prev)
    }
  }, [getPreviousStep])

  const handleComplete = useCallback(() => {
    onComplete()
    onOpenChange(false)
  }, [onComplete, onOpenChange])

  // Handle auth method selection
  const handleSelectAuthMethod = useCallback(
    async (method: AuthMethod) => {
      setAuthMethod(method)
      if (!expoConnected) {
        setCurrentStep('expo')
      } else if (method === 'apple-id') {
        // If user explicitly chose to use different account, skip session check and go directly to form
        if (!hasExistingAppleSession) {
          // Check for any existing Apple sessions before prompting for credentials
          try {
            const sessionsResult = await deploy.listAppleSessions()
            console.log('[IOSSetupWizard] Apple sessions check:', sessionsResult)

            if (sessionsResult.hasValidSession && sessionsResult.sessions.length > 0) {
              // Use the most recent valid session
              const latestSession = sessionsResult.sessions[0] // Sorted by age, oldest first
              const appleId = latestSession.appleId || ''

              if (appleId && latestSession.isValid) {
                console.log('[IOSSetupWizard] Using existing session for:', appleId, latestSession.statusMessage)

                // Cache the Apple ID for future use
                const APPLE_ID_STORAGE_KEY = 'bfloat_apple_id'
                try {
                  localStorage.setItem(APPLE_ID_STORAGE_KEY, appleId)
                } catch {
                  // Ignore localStorage errors
                }

                // Use empty password - the session will handle authentication
                deployStore.setPendingAppleCredentials(appleId, '')

                // Prepare and proceed directly to deployment
                await ensureProjectConfiguration(projectPath, tokens.expo?.username, projectTitle)
                onComplete()
                return
              }
            }
          } catch (err) {
            console.log('[IOSSetupWizard] Session check failed, showing credentials form:', err)
          }
        }

        // No valid session found or user chose different account - show credentials form
        setCurrentStep('apple-credentials')
      } else if (method === 'api-key') {
        setCurrentStep('api-key-setup')
      }
    },
    [expoConnected, projectPath, tokens.expo?.username, onComplete, hasExistingAppleSession]
  )

  // Handle Apple credentials submission - immediately hand off to Claude Code
  const handleAppleCredentialsSubmit = useCallback(
    async (appleId: string, password: string) => {
      setIsAuthenticating(true)
      setError(null)

      try {
        // Store credentials for Claude Code to use
        deployStore.setPendingAppleCredentials(appleId, password)

        // Ensure project is configured
        await ensureProjectConfiguration(projectPath, tokens.expo?.username, projectTitle)

        // Immediately complete - Claude Code will handle the rest including 2FA if needed
        setIsAuthenticating(false)
        onComplete()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to prepare deployment')
        setIsAuthenticating(false)
      }
    },
    [projectPath, tokens.expo?.username, onComplete]
  )

  // Handle 2FA code submission
  const handleSubmit2FA = useCallback(async (code: string) => {
    setError(null)
    try {
      await deploy.submit2FACode(code)
      // Will return to build-progress via event
      deployStore.resetInteractiveAuth()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit code')
    }
  }, [])

  // Handle file upload for .p8 key
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.p8')) {
      setError('Please upload a .p8 file')
      return
    }

    setKeyFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      // Convert to base64 for transport
      const base64 = btoa(content)
      setKeyContent(base64)
      setError(null)
    }
    reader.onerror = () => {
      setError('Failed to read file')
    }
    reader.readAsText(file)
  }, [])

  // Handle API key save - trigger Claude Code
  const handleSaveApiKey = useCallback(async () => {
    if (!keyId || !issuerId || !keyContent) {
      setError('Please fill in all fields')
      return
    }

    setIsSavingKey(true)
    setError(null)

    try {
      // Ensure project is configured
      await ensureProjectConfiguration(projectPath, tokens.expo?.username, projectTitle)

      const result = await deploy.saveASCApiKey({
        projectPath,
        keyId,
        issuerId,
        keyContent,
      })

      if (result.success) {
        // API key saved - trigger Claude Code deployment
        setIsSavingKey(false)
        onComplete()
      } else {
        setError(result.error || 'Failed to save API key')
        setIsSavingKey(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key')
      setIsSavingKey(false)
    }
  }, [keyId, issuerId, keyContent, projectPath, tokens.expo?.username, onComplete])

  // Handle continuing with existing key - trigger Claude Code
  const handleContinueWithExistingKey = useCallback(async () => {
    await ensureProjectConfiguration(projectPath, tokens.expo?.username, projectTitle)
    // Trigger Claude Code deployment
    onComplete()
  }, [projectPath, tokens.expo?.username, projectTitle, onComplete])

  // Track if build has been started to prevent double-triggers
  const buildStartedRef = useRef(false)

  // Start build when entering build-progress step (for API key flow)
  useEffect(() => {
    if (currentStep === 'build-progress' && !buildStartedRef.current && authMethod === 'api-key') {
      buildStartedRef.current = true
      startBuild()
    } else if (currentStep !== 'build-progress') {
      buildStartedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, authMethod])

  // Subscribe to build events
  useEffect(() => {
    const unsubProgress = deploy.onBuildProgress((progress) => {
      setBuildProgress(progress)
      if (progress.step === 'complete') {
        setIsBuilding(false)
        setCurrentStep('complete')
        if (!openRef.current) {
          deployStore.showDeploymentNotification({
            id: `deploy-toast-${Date.now()}`,
            platform: 'ios',
            status: 'success',
            message: 'iOS build completed successfully.',
            buildUrl: progress.buildUrl,
          })
        }
      } else if (progress.step === 'error') {
        setIsBuilding(false)
        setError(progress.error || 'Build failed')
        if (!openRef.current) {
          deployStore.showDeploymentNotification({
            id: `deploy-toast-${Date.now()}`,
            platform: 'ios',
            status: 'error',
            message: progress.error || 'iOS build failed.',
          })
        }
      }
    })

    const unsubLogs = deploy.onBuildLog(({ data }) => {
      deployStore.appendBuildLog(data)
    })

    // Subscribe to interactive auth events
    const unsubAuth = deploy.onInteractiveAuth((event) => {
      if (event.type === '2fa') {
        deployStore.show2FAInput(event.context, event.suggestion)
        setCurrentStep('apple-2fa')
      } else if (event.confidence > 0.5) {
        deployStore.showTerminalFallback(event.type, event.context, event.suggestion, event.humanized)
        setCurrentStep('terminal-fallback')
      }
    })

    return () => {
      unsubProgress()
      unsubLogs()
      unsubAuth()
    }
  }, [])

  const startBuild = async () => {
    setIsBuilding(true)
    setError(null)
    deployStore.clearBuildLogs()
    setBuildProgress({ step: 'init', message: 'Starting build...', percent: 5 })

    try {
      const result = await deploy.startIOSBuild({
        projectPath,
      })

      if (!result.success) {
        setError(result.error || 'Build failed')
        setIsBuilding(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed')
      setIsBuilding(false)
    }
  }

  const handleCancelBuild = async () => {
    await deploy.cancelBuild()
    setIsBuilding(false)
    setBuildProgress(null)
    deployStore.resetInteractiveAuth()
  }

  const handleRetryBuild = () => {
    setError(null)
    setBuildProgress(null)
    if (authMethod === 'apple-id') {
      const creds = deployStore.getPendingAppleCredentials()
      if (creds) {
        handleAppleCredentialsSubmit(creds.appleId, creds.password)
      } else {
        setCurrentStep('apple-credentials')
      }
    } else {
      startBuild()
    }
  }

  const handleCopyError = useCallback(() => {
    // Copy the last portion of build logs which contains the actual error details
    // Fall back to error message if no logs available
    const logs = deployStore.buildLogs.getState()
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
    } else if (error) {
      textToCopy = error
    }

    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), 2000)
    }
  }, [error])

  // Reset state when modal opens
  useEffect(() => {
    openRef.current = open
    if (open) {
      setCurrentStep('welcome')
      setAuthMethod(null)
      setError(null)
      setKeyId('')
      setIssuerId('')
      setKeyContent('')
      setKeyFileName('')
      setBuildProgress(null)
      setIsBuilding(false)
      setIsAuthenticating(false)
      setExistingKeyConfig(null)
      setIsCheckingKey(false)
      buildStartedRef.current = false
      deployStore.resetAppleLoginState()
      deployStore.resetInteractiveAuth()
      deployStore.clearBuildLogs()

      // Check for existing Apple session
      setCheckedExistingSession(false)
      setHasExistingAppleSession(false)
      setExistingAppleId(null)

      const APPLE_ID_STORAGE_KEY = 'bfloat_apple_id'
      let cachedAppleId: string | null = null
      try {
        cachedAppleId = localStorage.getItem(APPLE_ID_STORAGE_KEY)
      } catch {
        // Ignore localStorage errors
      }

      if (cachedAppleId) {
        deploy.checkAppleSession(cachedAppleId)
          .then((sessionInfo) => {
            if (sessionInfo.exists) {
              setExistingAppleId(cachedAppleId)
              setHasExistingAppleSession(true)
            }
            setCheckedExistingSession(true)
          })
          .catch(() => {
            setCheckedExistingSession(true)
          })
      } else {
        setCheckedExistingSession(true)
      }
    }
  }, [open])

  const renderStepContent = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Smartphone size={32} className="text-white" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">Publish to iOS App Store</h3>
              <p className="text-sm text-muted-foreground">Choose how you'd like to authenticate with Apple.</p>
            </div>

            {/* Show existing session if available */}
            {hasExistingAppleSession && existingAppleId && (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-500">Signed in as {existingAppleId}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your session is active. You can continue without signing in again.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={async () => {
                          // Set pending credentials with empty password (session handles auth)
                          deployStore.setPendingAppleCredentials(existingAppleId || '', '')
                          await ensureProjectConfiguration(projectPath, tokens.expo?.username, projectTitle)
                          onComplete()
                        }}
                        className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-500"
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => {
                          setHasExistingAppleSession(false)
                          setExistingAppleId(null)
                        }}
                        className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                      >
                        Use different account
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Auth method selection */}
            <div className="space-y-3">
              <button
                onClick={() => handleSelectAuthMethod('apple-id')}
                className="w-full p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <User size={20} className="text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Sign in with Apple ID</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use your Apple ID and password. May require 2FA verification.
                    </p>
                    <div className="flex items-center gap-1 mt-2 text-xs text-green-500">
                      <CheckCircle2 size={12} />
                      Recommended for most users
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  onOpenChange(false)
                  workbenchStore.triggerChatPrompt('/deploy-ios')
                }}
                className="w-full p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                    <Bot size={20} className="text-purple-500" />
                  </div>
                  <div>
                    <p className="font-medium">Let Claude deploy for you</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Claude will handle the entire deployment process in the chat.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleSelectAuthMethod('api-key')}
                className="w-full p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Key size={20} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Use API Key</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Set up an App Store Connect API Key for automated, non-interactive builds.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex items-center justify-center pt-2">
              <button onClick={onSkipToTerminal} className="text-sm text-muted-foreground hover:text-foreground">
                Use terminal instead
              </button>
            </div>
          </div>
        )

      case 'expo':
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">Connect Expo Account</h3>
              <p className="text-sm text-muted-foreground">Sign in to your Expo account to access EAS Build.</p>
            </div>

            {expoConnected ? (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                <Check size={24} className="text-green-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-green-500">Connected as {tokens.expo?.username}</p>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={16} className="text-amber-500" />
                  <span className="text-sm font-medium">Expo not connected</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Please connect your Expo account from the Deploy modal first.
                </p>
                <button onClick={() => onOpenChange(false)} className="text-sm text-primary hover:underline">
                  Go back to connect Expo
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <button
                onClick={handleBack}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5"
              >
                <ChevronLeft size={14} />
                Back
              </button>
              <button
                onClick={handleNext}
                disabled={!expoConnected}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                Continue
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )

      case 'apple-credentials':
        return (
          <AppleAuthStep
            onSubmit={handleAppleCredentialsSubmit}
            onBack={handleBack}
            onUseApiKey={() => handleSelectAuthMethod('api-key')}
            isSubmitting={isAuthenticating}
            error={error}
            projectPath={projectPath}
          />
        )

      case 'apple-2fa':
        return <TwoFactorStep onSubmit={handleSubmit2FA} onCancel={handleCancelBuild} error={error} />

      case 'terminal-fallback':
        return (
          <TerminalFallbackStep
            onCancel={handleCancelBuild}
            suggestion={interactiveAuthState.suggestion}
            promptContext={interactiveAuthState.promptContext}
            humanized={interactiveAuthState.humanized}
          />
        )

      case 'api-key-setup':
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">App Store Connect API Key</h3>
              <p className="text-sm text-muted-foreground">
                Create an API key in App Store Connect and enter the details below.
              </p>
            </div>

            {/* Instructions panel */}
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-400 mb-2">How to create an API key:</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Go to App Store Connect &rarr; Users and Access &rarr; Keys</li>
                <li>Click the + button to create a new key</li>
                <li>Set access to "App Manager" or "Admin"</li>
                <li>Download the .p8 file (only available once!)</li>
                <li>Copy the Key ID and Issuer ID shown</li>
              </ol>
              <a
                href="https://appstoreconnect.apple.com/access/api"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-xs text-primary hover:underline flex items-center gap-1 inline-flex"
              >
                Open App Store Connect <ExternalLink size={10} />
              </a>
            </div>

            {/* Existing key detected */}
            {isCheckingKey ? (
              <div className="p-4 rounded-lg bg-muted/50 flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm text-muted-foreground">Checking for existing key...</span>
              </div>
            ) : existingKeyConfig?.configured ? (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={16} className="text-green-500" />
                  <span className="text-sm font-medium text-green-500">API Key Already Configured</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Key ID: {existingKeyConfig.keyId}</p>
                <button
                  onClick={handleContinueWithExistingKey}
                  className="w-full px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-500"
                >
                  Continue with Existing Key
                </button>
              </div>
            ) : null}

            {/* API Key form */}
            <div className="space-y-4">
              <div>
                <label htmlFor="key-id-input" className="block text-sm font-medium mb-1.5">
                  Key ID
                </label>
                <input
                  id="key-id-input"
                  type="text"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value.trim())}
                  placeholder="e.g., ABC123DEF4"
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                  disabled={isSavingKey}
                />
              </div>

              <div>
                <label htmlFor="issuer-id-input" className="block text-sm font-medium mb-1.5">
                  Issuer ID
                </label>
                <input
                  id="issuer-id-input"
                  type="text"
                  value={issuerId}
                  onChange={(e) => setIssuerId(e.target.value.trim())}
                  placeholder="e.g., 12345678-1234-1234-1234-123456789012"
                  className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                  disabled={isSavingKey}
                />
              </div>

              <div>
                <label htmlFor="api-key-file-input" className="block text-sm font-medium mb-1.5">
                  API Key File (.p8)
                </label>
                <input
                  id="api-key-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".p8"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSavingKey}
                  className="w-full px-3 py-4 text-sm bg-muted/50 border-2 border-dashed border-input rounded-lg hover:bg-muted/80 transition-colors flex flex-col items-center gap-2"
                >
                  {keyFileName ? (
                    <>
                      <FileKey size={20} className="text-green-500" />
                      <span className="text-green-500 font-medium">{keyFileName}</span>
                      <span className="text-xs text-muted-foreground">Click to change</span>
                    </>
                  ) : (
                    <>
                      <Upload size={20} className="text-muted-foreground" />
                      <span className="text-muted-foreground">Click to upload .p8 file</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-destructive flex-1">{error}</p>
                  <button
                    onClick={handleCopyError}
                    className="p-1 rounded hover:bg-destructive/20 transition-colors flex-shrink-0"
                    title="Copy error message"
                  >
                    {errorCopied ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} className="text-destructive" />
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <button
                onClick={handleBack}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5"
              >
                <ChevronLeft size={14} />
                Back
              </button>
              <button
                onClick={handleSaveApiKey}
                disabled={isSavingKey || !keyId || !issuerId || !keyContent}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSavingKey ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save & Continue
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
            </div>
          </div>
        )

      case 'build-progress': {
        const progress = buildProgress || { step: 'init', message: 'Starting...', percent: 0 }
        const stepInfo = BUILD_STEPS[progress.step] || BUILD_STEPS.init

        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">Building & Submitting</h3>
              <p className="text-sm text-muted-foreground">Your app is being built and submitted to TestFlight.</p>
            </div>

            {/* Progress indicator */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progress.message || stepInfo.label}</span>
                <span className="font-medium">{Math.round(progress.percent || stepInfo.percent)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${progress.percent || stepInfo.percent}%` }}
                />
              </div>
            </div>

            {/* Build steps visualization */}
            <div className="space-y-2">
              {['init', 'credentials', 'build', 'submit', 'complete'].map((step, idx) => {
                const isComplete = Object.keys(BUILD_STEPS).indexOf(progress.step) > idx
                const isCurrent = progress.step === step
                const stepLabel = BUILD_STEPS[step]?.label || step

                return (
                  <div
                    key={step}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      isCurrent ? 'bg-primary/10' : ''
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        isComplete
                          ? 'bg-green-500 text-white'
                          : isCurrent
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isComplete ? (
                        <Check size={12} />
                      ) : isCurrent ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        idx + 1
                      )}
                    </div>
                    <span
                      className={`text-sm ${isComplete || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      {stepLabel}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Error display */}
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-destructive flex-1">{error}</p>
                  <button
                    onClick={handleCopyError}
                    className="p-1 rounded hover:bg-destructive/20 transition-colors flex-shrink-0"
                    title="Copy error message"
                  >
                    {errorCopied ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} className="text-destructive" />
                    )}
                  </button>
                </div>
                <button onClick={handleRetryBuild} className="mt-2 text-sm text-primary hover:underline">
                  Retry build
                </button>
              </div>
            )}

            {/* Collapsible logs section */}
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full px-4 py-2 flex items-center justify-between text-sm text-muted-foreground hover:bg-muted/50"
              >
                <span>View Logs</span>
                {showLogs ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {showLogs && <LogTerminal logs={buildLogs} height={200} />}
            </div>

            {/* Cancel button */}
            {isBuilding && (
              <div className="flex justify-center">
                <button onClick={handleCancelBuild} className="text-sm text-muted-foreground hover:text-destructive">
                  Cancel build
                </button>
              </div>
            )}
          </div>
        )
      }

      case 'complete':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center">
                <Check size={32} className="text-white" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">Setup Complete!</h3>
              <p className="text-sm text-muted-foreground">
                Your app has been submitted to TestFlight! Future deployments will be faster - just click "Publish to
                iOS App Store" and we'll handle the rest.
              </p>
            </div>

            {buildProgress?.buildUrl && (
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <a
                  href={buildProgress.buildUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
                >
                  View build on Expo <ExternalLink size={12} />
                </a>
              </div>
            )}

            <div className="p-4 rounded-lg bg-muted/50 text-center">
              <p className="text-sm text-muted-foreground">
                {authMethod === 'api-key'
                  ? 'Your API key and certificates are securely stored and will be reused for all future builds.'
                  : 'Your session has been cached and will reduce 2FA prompts for future builds.'}
              </p>
            </div>

            <div className="flex justify-center pt-4">
              <button
                onClick={handleComplete}
                className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  // Handle dialog close - allow closing while build continues in background
  const handleDialogClose = useCallback(
    (openState: boolean) => {
      if (!openState) {
        onOpenChange(false)
      } else {
        onOpenChange(true)
      }
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="w-[70vw] max-w-3xl px-12">
        {/* Only show step indicator for main flow steps */}
        {!['apple-2fa', 'terminal-fallback'].includes(currentStep) && (
          <StepIndicator steps={steps} currentStep={currentStep} />
        )}
        {renderStepContent()}
      </DialogContent>
    </Dialog>
  )
}
