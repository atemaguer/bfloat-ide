/**
 * iOS Deploy Modals
 *
 * Renders the iOS setup wizard and progress modal at a level
 * that doesn't get unmounted when the deploy popover closes.
 */

import { useCallback, useRef, useEffect, useState } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { deployStore } from '@/app/stores/deploy'
import { workbenchStore } from '@/app/stores/workbench'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { runBackgroundDeployment, type DeploymentResult } from '@/app/utils/background-deploy'
import { setProjectOwner } from '@/app/utils/eas-accounts'
import { getDefaultEasConfig } from '@/app/utils/eas-config'
import { buildDeployErrorPrompt } from '@/app/utils/build-error-prompt'
import { DeployProgressModal } from './DeployProgressModal'
import { IOSSetupWizard } from './IOSSetupWizard'
import { TwoFactorStep } from './TwoFactorStep'
import { Dialog, DialogContent } from '@/app/components/ui/dialog'
import { deploy, filesystem } from '@/app/api/sidecar'

/**
 * Mark iOS setup as complete in eas.json
 * This adds iOS-specific config that the credential checker looks for
 */
async function markIOSSetupComplete(projectPath: string): Promise<void> {
  if (!filesystem) return

  const easJsonPath = `${projectPath}/eas.json`
  const readResult = await filesystem.readFile(easJsonPath)

  if (readResult.success && readResult.content) {
    try {
      const easConfig = JSON.parse(readResult.content)
      let needsUpdate = false

      // Add iOS-specific build config to mark setup as complete
      if (!easConfig.build) easConfig.build = {}
      if (!easConfig.build.production) easConfig.build.production = {}
      if (!easConfig.build.production.ios) {
        easConfig.build.production.ios = {
          credentialsSource: 'remote', // Use credentials stored on EAS servers
        }
        needsUpdate = true
      }

      if (needsUpdate) {
        await filesystem.writeFile(easJsonPath, JSON.stringify(easConfig, null, 2))
      }
    } catch {
      // If JSON parsing fails, skip the update
    }
  }
}

/**
 * Check if App Store Connect submission is configured (has ascAppId)
 */
async function hasSubmitConfig(projectPath: string): Promise<boolean> {
  if (!filesystem) return false

  const easJsonPath = `${projectPath}/eas.json`
  const readResult = await filesystem.readFile(easJsonPath)

  if (readResult.success && readResult.content) {
    try {
      const easConfig = JSON.parse(readResult.content)
      const ascAppId = easConfig.submit?.production?.ios?.ascAppId
      return Boolean(ascAppId)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Prepare the project for iOS deployment
 */
async function prepareForDeployment(
  projectPath: string,
  expoUsername: string | undefined,
  projectTitle: string
): Promise<{ success: boolean; error?: string }> {
  if (!filesystem) {
    return { success: false, error: 'Filesystem API not available' }
  }

  try {
    // Ensure app.json exists (EAS needs this to write config, even with app.config.js)
    const appJsonPath = `${projectPath}/app.json`
    const readResult = await filesystem.readFile(appJsonPath)

    let appConfig: Record<string, unknown> = {}

    if (readResult.success && readResult.content) {
      try {
        appConfig = JSON.parse(readResult.content)
      } catch {
        // Invalid JSON, start fresh
        appConfig = {}
      }
    }

    // Ensure structure for EAS
    if (!appConfig.expo) appConfig.expo = {}
    if (!appConfig.expo.ios) appConfig.expo.ios = {}

    if (!appConfig.expo.ios.bundleIdentifier) {
      const owner = expoUsername?.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'app'
      const projectSlug = projectTitle.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'myapp'

      // Add unique suffix from project ID to prevent bundle identifier collisions
      // Use first 4 characters of the project ID (UUID) for uniqueness
      const uniqueSuffix = projectId?.replace(/-/g, '').slice(0, 4) || Math.random().toString(36).slice(2, 6)
      appConfig.expo.ios.bundleIdentifier = `com.${owner}.${projectSlug}${uniqueSuffix}`
    }

    if (!appConfig.expo.ios.infoPlist) {
      appConfig.expo.ios.infoPlist = {}
    }
    if (appConfig.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption === undefined) {
      appConfig.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption = false
    }

    // Always write app.json so EAS can modify it (needed even with app.config.js)
    await filesystem.writeFile(appJsonPath, JSON.stringify(appConfig, null, 2))

    // Ensure eas.json
    const easJsonPath = `${projectPath}/eas.json`
    const easResult = await filesystem.readFile(easJsonPath)

    const defaultConfig = getDefaultEasConfig()
    let easConfig: Record<string, unknown> = defaultConfig
    if (easResult.success && easResult.content) {
      try {
        easConfig = JSON.parse(easResult.content)
      } catch {
        easConfig = defaultConfig
      }
    }

    if (!easConfig.build) easConfig.build = defaultConfig.build
    const build = easConfig.build as Record<string, Record<string, unknown>>
    if (!build.production) build.production = defaultConfig.build.production

    // Clean up empty submit profiles that cause EAS CLI validation errors.
    // EAS rejects fields like ascApiKeyPath or serviceAccountKeyPath when
    // they exist as empty strings or when the sub-object is empty.
    if (easConfig.submit) {
      const submit = easConfig.submit as Record<string, Record<string, unknown>>
      if (submit.production) {
        if (submit.production.ios && Object.keys(submit.production.ios).length === 0) {
          delete submit.production.ios
        }
        if (submit.production.android && Object.keys(submit.production.android).length === 0) {
          delete submit.production.android
        }
        if (Object.keys(submit.production).length === 0) {
          delete submit.production
        }
      }
      if (Object.keys(submit).length === 0) {
        delete easConfig.submit
      }
    }

    await filesystem.writeFile(easJsonPath, JSON.stringify(easConfig, null, 2))

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function IOSDeployModals() {
  const projectPath = useStore(workbenchStore.projectPath)
  const currentProject = useStore(workbenchStore.currentProject)
  const tokens = useStore(providerAuthStore.tokens)
  const selectedEasAccount = useStore(deployStore.selectedEasAccount)

  // iOS-specific state from store
  const iOSProgress = useStore(deployStore.iOSProgress)
  const iOSLogs = useStore(deployStore.iOSLogs)
  const iOSProgressModalOpen = useStore(deployStore.iOSProgressModalOpen)
  const iOSSetupWizardOpen = useStore(deployStore.iOSSetupWizardOpen)
  const credentialStatus = useStore(deployStore.iOSCredentialStatus)
  const shouldStartDeployment = useStore(deployStore.iOSShouldStartDeployment)

  // Local state for interactive deployment
  const [showTwoFactorInput, setShowTwoFactorInput] = useState(false)
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)

  const cancelDeploymentRef = useRef<(() => void) | null>(null)
  const isDeployingRef = useRef(false)
  const buildListenersRef = useRef<(() => void) | null>(null)

  // Clean up event listeners on unmount
  useEffect(() => {
    return () => {
      if (buildListenersRef.current) {
        buildListenersRef.current()
        buildListenersRef.current = null
      }
    }
  }, [])

  // Watch for deployment trigger from DeployiOSSection
  useEffect(() => {
    if (shouldStartDeployment && !isDeployingRef.current && projectPath) {
      isDeployingRef.current = true
      deployStore.clearIOSDeploymentTrigger()

      // Run the deployment
      ;(async () => {
        try {
          // Set project owner based on selected account (for org builds)
          if (selectedEasAccount) {
            await setProjectOwner(projectPath, selectedEasAccount)
          }

          // Prepare the project
          const projectTitle = currentProject?.title || 'myapp'
          const expoUsername = tokens.expo?.username
          await prepareForDeployment(projectPath, expoUsername, projectTitle)

          // Check if App Store Connect submission is configured
          const hasAscConfig = await hasSubmitConfig(projectPath)

          if (!hasAscConfig) {
            // First submission - need interactive terminal
            isDeployingRef.current = false
            deployStore.startDeployment('ios', currentProject?.id)

            // Run interactive deployment with terminal
            // Install dependencies first so EAS can resolve plugins
            const command =
              `cd "${projectPath}" && ` +
              `npm install --legacy-peer-deps && ` +
              `([ -d .git ] || git init) && ` +
              `git add -A && ` +
              `git commit -m "Configure for deployment" --allow-empty || true` +
              ` && npx -y eas-cli build --platform ios --profile production --non-interactive --auto-submit`

            await workbenchStore.runDeployCommand(command)
            return
          }

          // Submit config exists - use background deployment
          deployStore.startIOSDeployment(currentProject?.id)

          // Run background deployment
          const { cancel } = await runBackgroundDeployment(
            projectPath,
            {
              onProgress: (update) => {
                deployStore.updateIOSProgress(update)
              },
              onLog: (data) => {
                deployStore.appendIOSLog(data)
              },
              onComplete: (result: DeploymentResult) => {
                isDeployingRef.current = false
                if (result.success) {
                  deployStore.completeIOSDeployment(result.buildUrl)
                } else {
                  deployStore.failIOSDeployment(result.error || 'Deployment failed')
                }
              },
            },
            {
              isFirstBuild: credentialStatus?.isFirstBuild ?? false,
            }
          )

          cancelDeploymentRef.current = cancel
        } catch (error) {
          isDeployingRef.current = false
          deployStore.failIOSDeployment(error instanceof Error ? error.message : 'Deployment failed')
        }
      })()
    }
  }, [shouldStartDeployment, projectPath, currentProject, tokens.expo?.username, credentialStatus, selectedEasAccount])

  // Run the automated deployment
  const runAutomatedDeployment = useCallback(async () => {
    if (!projectPath) return

    // Set project owner based on selected account (for org builds)
    const selectedAccount = deployStore.selectedEasAccount.getState()
    if (selectedAccount) {
      await setProjectOwner(projectPath, selectedAccount)
    }

    // Prepare the project
    const projectTitle = currentProject?.title || 'myapp'
    const expoUsername = tokens.expo?.username
    await prepareForDeployment(projectPath, expoUsername, projectTitle)

    // Check if App Store Connect submission is configured (ascAppId)
    // If not, we need interactive mode for the first submission
    const hasAscConfig = await hasSubmitConfig(projectPath)

    if (!hasAscConfig) {
      // First submission - need interactive terminal for App Store Connect app selection
      // Fall back to interactive deployment
      deployStore.startDeployment('ios', currentProject?.id)

      // Run interactive deployment with terminal
      // Install dependencies first so EAS can resolve plugins
      const command =
        `cd "${projectPath}" && ` +
        `npm install --legacy-peer-deps && ` +
        `([ -d .git ] || git init) && ` +
        `git add -A && ` +
        `git commit -m "Configure for deployment" --allow-empty || true` +
        ` && npx -y eas-cli build --platform ios --profile production --non-interactive --auto-submit`

      await workbenchStore.runDeployCommand(command)
      return
    }

    // Submit config exists - use background deployment with progress UI
    deployStore.startIOSDeployment(currentProject?.id)

    // Get the latest credential status from the store (not from closure)
    // This ensures we use the updated status after wizard completion
    const latestCredentialStatus = deployStore.iOSCredentialStatus.getState()

    // Run background deployment
    const { cancel } = await runBackgroundDeployment(
      projectPath,
      {
        onProgress: (update) => {
          deployStore.updateIOSProgress(update)
        },
        onLog: (data) => {
          deployStore.appendIOSLog(data)
        },
        onComplete: (result: DeploymentResult) => {
          if (result.success) {
            deployStore.completeIOSDeployment(result.buildUrl)
          } else {
            deployStore.failIOSDeployment(result.error || 'Deployment failed')
          }
        },
      },
      {
        isFirstBuild: latestCredentialStatus?.isFirstBuild ?? false,
      }
    )

    cancelDeploymentRef.current = cancel
  }, [projectPath, currentProject, tokens.expo?.username])

  /**
   * Run interactive deployment using the PTY-based infrastructure
   * This uses the existing deploy:ios-build-interactive handler that:
   * - Auto-confirms routine yes/no prompts
   * - Detects and pauses for 2FA input
   * - Injects user input back into the running process
   */
  const runInteractiveDeployment = useCallback(
    async (credentials?: { appleId: string; password: string }) => {
      console.log('[IOSDeployModals] runInteractiveDeployment called', { projectPath, hasCredentials: !!credentials })

      if (!projectPath) return

      // Set project owner based on selected account (for org builds)
      if (selectedEasAccount) {
        await setProjectOwner(projectPath, selectedEasAccount)
      }

      deployStore.startIOSDeployment(currentProject?.id)
      console.log('[IOSDeployModals] Deployment started, preparing project...')

      const projectTitle = currentProject?.title || 'myapp'
      const expoUsername = tokens.expo?.username
      await prepareForDeployment(projectPath, expoUsername, projectTitle)
      console.log('[IOSDeployModals] Project prepared, starting PTY build...')

      // Clean up any existing listeners
      if (buildListenersRef.current) {
        buildListenersRef.current()
        buildListenersRef.current = null
      }

      // Clear 2FA state
      setShowTwoFactorInput(false)
      setTwoFactorError(null)

      // Set up event listeners for the PTY build
      const unsubProgress = deploy.onBuildProgress((progress) => {
        console.log('[IOSDeployModals] Build progress:', progress)
        deployStore.updateIOSProgress({
          step: progress.step as any,
          percent: progress.percent,
          message: progress.message,
          buildUrl: progress.buildUrl,
          error: progress.error,
        })

        // Handle completion
        if (progress.step === 'complete') {
          deployStore.completeIOSDeployment(progress.buildUrl)
          setShowTwoFactorInput(false)
          setTwoFactorError(null)
        } else if (progress.step === 'error') {
          deployStore.failIOSDeployment(progress.error || 'Build failed')
          setShowTwoFactorInput(false)
          isDeployingRef.current = false
        }
      })

      const unsubLogs = deploy.onBuildLog(({ data }) => {
        deployStore.appendIOSLog(data)
      })

      // Subscribe to interactive auth events (for 2FA)
      const unsubAuth = deploy.onInteractiveAuth((event) => {
        console.log('[IOSDeployModals] Interactive auth event:', event.type)

        if (event.type === '2fa') {
          // Show 2FA input UI
          setShowTwoFactorInput(true)
          setTwoFactorError(null)
        } else if (event.confidence > 0.5 && event.type !== 'yes_no' && event.type !== 'menu') {
          // For unknown prompts that need user input, fall back to terminal
          // But don't show terminal for routine yes_no or menu prompts (they're auto-handled)
          console.log('[IOSDeployModals] Unknown prompt, showing terminal:', event.type)
          deployStore.showTerminalFallback(event.type, event.context, event.suggestion, event.humanized)
        }
      })

      // Store cleanup function
      buildListenersRef.current = () => {
        unsubProgress()
        unsubLogs()
        unsubAuth()
      }

      // Use the existing deploy:ios-build-interactive handler
      // It handles prompt detection, auto-confirmation, and 2FA via PTY
      try {
        const result = await deploy.startInteractiveIOSBuild({
          projectPath,
          appleId: credentials?.appleId || '',
          password: credentials?.password || '',
        })

        console.log('[IOSDeployModals] Build result:', result)

        // Clean up listeners
        if (buildListenersRef.current) {
          buildListenersRef.current()
          buildListenersRef.current = null
        }

        if (!result.success) {
          deployStore.failIOSDeployment(result.error || 'Deployment failed')
          setShowTwoFactorInput(false)
          isDeployingRef.current = false
        }
      } catch (error) {
        console.error('[IOSDeployModals] Build error:', error)

        // Clean up listeners
        if (buildListenersRef.current) {
          buildListenersRef.current()
          buildListenersRef.current = null
        }

        deployStore.failIOSDeployment(error instanceof Error ? error.message : 'Deployment failed')
        setShowTwoFactorInput(false)
        isDeployingRef.current = false
      }
    },
    [projectPath, currentProject, tokens.expo?.username, selectedEasAccount]
  )

  /**
   * Handle 2FA code submission
   */
  const handle2FASubmit = useCallback(async (code: string) => {
    setTwoFactorError(null)
    try {
      const result = await deploy.submit2FACode(code)
      if (result.success) {
        setShowTwoFactorInput(false)
      } else {
        setTwoFactorError('Failed to submit code. Please try again.')
      }
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'Failed to submit code')
    }
  }, [])

  /**
   * Handle 2FA cancel
   */
  const handle2FACancel = useCallback(() => {
    setShowTwoFactorInput(false)
    setTwoFactorError(null)
    // Cancel the entire build
    cancelDeploymentRef.current?.()
    deployStore.cancelIOSDeployment()
    isDeployingRef.current = false
  }, [])

  /**
   * Start iOS deployment by checking ASC API key status
   * Routes to appropriate flow based on whether credentials are configured
   */
  const startClaudeDeployment = useCallback(async () => {
    console.log('[IOSDeployModals] startClaudeDeployment called')
    if (!projectPath) return

    try {
      // Ensure project is synced to disk first
      const syncResult = await workbenchStore.syncFilesToDisk()
      if (!syncResult.success) {
        console.error('[IOSDeployModals] Failed to sync files:', syncResult.error)
        return
      }

      const syncedPath = syncResult.path || projectPath

      // Check if ASC API key is configured
      const checkResult = await deploy.checkASCApiKey(syncedPath)

      if (checkResult?.success && checkResult.configured) {
        // Has credentials - use Claude Code (non-interactive)
        // Set project owner based on selected account (for org builds)
        const selectedAccount = deployStore.selectedEasAccount.getState()
        if (selectedAccount) {
          await setProjectOwner(syncedPath, selectedAccount)
        }

        // Prepare the project
        const projectTitle = currentProject?.title || 'myapp'
        const expoUsername = tokens.expo?.username
        await prepareForDeployment(syncedPath, expoUsername, projectTitle)

        // Trigger Claude Code deployment
        const deploymentPrompt = `/deploy-ios`
        workbenchStore.triggerChatPrompt(deploymentPrompt)
      } else {
        // No credentials yet - need interactive setup
        // Show wizard to get credentials first
        deployStore.openIOSSetupWizard()
        // After wizard completes, it will call runInteractiveDeployment
      }
    } catch (error) {
      console.error('[IOSDeployModals] Error starting deployment:', error)
    }
  }, [projectPath, currentProject, tokens.expo?.username])

  // Handle wizard completion - route based on ASC key status
  const handleSetupComplete = useCallback(async () => {
    console.log('[IOSDeployModals] handleSetupComplete called')
    if (!projectPath) return

    deployStore.closeIOSSetupWizard()
    deployStore.closeModal() // Close the deploy modal too
    console.log('[IOSDeployModals] Wizard closed, modal closed')

    // First, prepare the project (ensure app.json and eas.json exist)
    // This must happen BEFORE setProjectOwner since it reads app.json
    const projectTitle = currentProject?.title || 'myapp'
    const expoUsername = tokens.expo?.username
    const prepResult = await prepareForDeployment(projectPath, expoUsername, projectTitle)
    if (!prepResult.success) {
      console.error('[IOSDeployModals] Failed to prepare project:', prepResult.error)
      return
    }

    // Set project owner based on selected account (for org builds)
    // This now works because app.json exists from prepareForDeployment
    const selectedAccount = deployStore.selectedEasAccount.getState()
    if (selectedAccount) {
      const ownerResult = await setProjectOwner(projectPath, selectedAccount)
      if (!ownerResult.success) {
        console.error('[IOSDeployModals] Failed to set owner:', ownerResult.error)
      }
    }

    // Mark iOS setup as complete in eas.json so it persists across sessions
    await markIOSSetupComplete(projectPath)

    // Check if ASC API key is configured
    const checkResult = await deploy.checkASCApiKey(projectPath)
    console.log('[IOSDeployModals] ASC API key check result:', checkResult)

    if (checkResult?.success && checkResult.configured) {
      console.log('[IOSDeployModals] Has ASC key - using Claude Code (non-interactive)')
      // Has ASC key - use Claude Code (non-interactive)
      // Update credential status to indicate credentials are configured
      const currentStatus = deployStore.iOSCredentialStatus.getState()
      if (currentStatus) {
        deployStore.setIOSCredentialStatus({
          ...currentStatus,
          hasDistributionCert: true,
          hasAscApiKey: true,
          isFirstBuild: false,
          isFullyConfigured: true,
        })
      }

      // Trigger Claude Code deployment
      const deploymentPrompt = `/deploy-ios`
      console.log('[IOSDeployModals] Triggering chat prompt with:', deploymentPrompt)
      workbenchStore.triggerChatPrompt(deploymentPrompt)
    } else {
      console.log('[IOSDeployModals] No ASC key - using interactive deployment with Apple credentials')
      // No ASC key - need interactive deployment with Apple credentials
      // Update credential status
      const currentStatus = deployStore.iOSCredentialStatus.getState()
      if (currentStatus) {
        deployStore.setIOSCredentialStatus({
          ...currentStatus,
          hasDistributionCert: true,
          isFirstBuild: true,
          isFullyConfigured: false,
        })
      }

      // Get Apple credentials from deployStore
      const credentials = deployStore.getPendingAppleCredentials()
      console.log(
        '[IOSDeployModals] Retrieved Apple credentials:',
        credentials ? { appleId: credentials.appleId } : null
      )
      if (!credentials) {
        console.error('[IOSDeployModals] No Apple credentials available after wizard completion')
        return
      }

      // Run interactive deployment with credentials
      console.log('[IOSDeployModals] Calling runInteractiveDeployment with credentials...')
      await runInteractiveDeployment(credentials)
    }
  }, [projectPath, currentProject, tokens.expo?.username, runInteractiveDeployment])

  // Handle skip to terminal
  const handleSkipToTerminal = useCallback(() => {
    deployStore.closeIOSSetupWizard()
    runInteractiveDeployment()
  }, [runInteractiveDeployment])

  // Handle cancel deployment
  const handleCancelDeployment = useCallback(() => {
    cancelDeploymentRef.current?.()
    deployStore.cancelIOSDeployment()
  }, [])

  // Handle retry deployment
  const handleRetryDeployment = useCallback(() => {
    deployStore.resetIOSState()
    runAutomatedDeployment()
  }, [runAutomatedDeployment])

  // Handle close progress modal
  const handleCloseProgressModal = useCallback(() => {
    deployStore.closeIOSProgressModal()
  }, [])

  // Handle fix with AI - send build logs to agent
  const handleFixWithAI = useCallback(() => {
    const logs = deployStore.iOSLogs.getState()
    const progress = deployStore.iOSProgress.getState()

    const prompt = buildDeployErrorPrompt({
      platform: 'ios',
      provider: 'eas',
      errorMessage: progress.error,
      logs,
    })

    deployStore.closeIOSProgressModal()
    workbenchStore.triggerChatPrompt(prompt)
  }, [])

  // Handle minimize - close modal but keep deployment running
  const handleMinimize = useCallback(() => {
    deployStore.closeIOSProgressModal()
    // Deployment continues in background via cancelDeploymentRef
    // TODO: Show a small status indicator in the UI when minimized
  }, [])

  // Only bail out if there's no project AND no active modals.
  // When the user navigates away mid-deployment, projectPath clears but
  // the modals must stay mounted to preserve cancel refs and state.
  if (!projectPath && !iOSProgressModalOpen && !iOSSetupWizardOpen && !showTwoFactorInput) return null

  return (
    <>
      {/* iOS Setup Wizard */}
      <IOSSetupWizard
        open={iOSSetupWizardOpen}
        onOpenChange={(open) => {
          if (!open) {
            deployStore.closeIOSSetupWizard()
          }
        }}
        projectPath={projectPath}
        projectTitle={currentProject?.title || 'myapp'}
        credentialStatus={credentialStatus}
        onComplete={handleSetupComplete}
        onSkipToTerminal={handleSkipToTerminal}
      />

      {/* iOS Progress Modal */}
      <DeployProgressModal
        open={iOSProgressModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleMinimize()
          }
        }}
        progress={iOSProgress}
        logs={iOSLogs}
        onCancel={handleCancelDeployment}
        onRetry={handleRetryDeployment}
        onClose={handleCloseProgressModal}
        onMinimize={handleMinimize}
        onFixWithAI={handleFixWithAI}
      />

      {/* 2FA Input Modal - shown when PTY build detects 2FA prompt */}
      <Dialog open={showTwoFactorInput} onOpenChange={setShowTwoFactorInput}>
        <DialogContent className="w-[50vw] max-w-xl px-12">
          <TwoFactorStep onSubmit={handle2FASubmit} onCancel={handle2FACancel} error={twoFactorError} />
        </DialogContent>
      </Dialog>
    </>
  )
}
