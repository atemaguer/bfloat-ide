/**
 * iOS Deployment Section
 *
 * Simplified deployment flow:
 * 1. Click "Publish to iOS App Store" to check ASC API key status
 * 2. If ASC key exists → trigger Claude Code deployment (non-interactive)
 * 3. If no ASC key → show IOSSetupWizard for interactive deployment
 */

import { useCallback, useState, useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { Loader2, XCircle } from 'lucide-react'
import { deployStore } from '@/app/stores/deploy'
import { workbenchStore } from '@/app/stores/workbench'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { fetchEasAccounts, setProjectOwner } from '@/app/utils/eas-accounts'
import { checkiOSCredentialStatus } from '@/app/utils/ios-credentials'
import { getDefaultEasConfig } from '@/app/utils/eas-config'
import { EasAccountSelector } from './EasAccountSelector'

/**
 * Prepare the project for iOS deployment
 * Moved here to share between DeployiOSSection and IOSDeployModals
 */
async function prepareForDeployment(
  projectPath: string,
  expoUsername: string | undefined,
  projectTitle: string
): Promise<{ success: boolean; error?: string }> {
  if (!window.conveyor?.filesystem) {
    return { success: false, error: 'Filesystem API not available' }
  }

  try {
    // Ensure app.json exists (EAS needs this to write config, even with app.config.js)
    const appJsonPath = `${projectPath}/app.json`
    const readResult = await window.conveyor.filesystem.readFile(appJsonPath)

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
      appConfig.expo.ios.bundleIdentifier = `com.${owner}.${projectSlug}`
    }

    if (!appConfig.expo.ios.infoPlist) {
      appConfig.expo.ios.infoPlist = {}
    }
    if (appConfig.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption === undefined) {
      appConfig.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption = false
    }

    // Always write app.json so EAS can modify it (needed even with app.config.js)
    await window.conveyor.filesystem.writeFile(appJsonPath, JSON.stringify(appConfig, null, 2))

    // Ensure eas.json and inject production env vars
    const easJsonPath = `${projectPath}/eas.json`
    const easResult = await window.conveyor.filesystem.readFile(easJsonPath)

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

    await window.conveyor.filesystem.writeFile(easJsonPath, JSON.stringify(easConfig, null, 2))

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

interface DeployiOSSectionProps {
  disabled?: boolean
}

export function DeployiOSSection({ disabled = false }: DeployiOSSectionProps) {
  const activeDeployment = useStore(deployStore.activeDeployment)
  const projectPath = useStore(workbenchStore.projectPath)
  const tokens = useStore(providerAuthStore.tokens)
  const easAccounts = useStore(deployStore.easAccounts)
  const isLoadingAccounts = useStore(deployStore.isLoadingAccounts)

  // Local state
  const [isCheckingCredentials, setIsCheckingCredentials] = useState(false)

  const files = useStore(workbenchStore.files)

  const isRunning = activeDeployment?.status === 'running' && activeDeployment?.platform === 'ios'
  const isExpoConnected = tokens.expo !== null
  const hasFiles = Object.keys(files).length > 0
  const isButtonDisabled = disabled || isRunning || !projectPath || !hasFiles || isCheckingCredentials

  // Fetch EAS accounts when Expo is connected
  useEffect(() => {
    async function loadAccounts() {
      if (!isExpoConnected) return
      if (easAccounts.length > 0) return // Already loaded

      deployStore.setLoadingAccounts(true)
      deployStore.loadSelectedAccount() // Load persisted selection

      try {
        const result = await fetchEasAccounts()
        if (result.success && result.accounts.length > 0) {
          deployStore.setEasAccounts(result.accounts)
        }
      } catch (error) {
        console.error('[DeployiOSSection] Error fetching accounts:', error)
      } finally {
        deployStore.setLoadingAccounts(false)
      }
    }

    loadAccounts()
  }, [isExpoConnected, easAccounts.length])

  // Check credential status when component mounts or project changes
  useEffect(() => {
    async function checkCredentials() {
      if (!projectPath) return

      setIsCheckingCredentials(true)
      try {
        const status = await checkiOSCredentialStatus(projectPath, isExpoConnected)
        deployStore.setIOSCredentialStatus(status)
      } catch (error) {
        console.error('[DeployiOSSection] Error checking credentials:', error)
      } finally {
        setIsCheckingCredentials(false)
      }
    }

    checkCredentials()
  }, [projectPath, isExpoConnected])

  // Cancel an in-progress build
  const handleCancel = useCallback(async () => {
    try {
      // Kill any running PTY build processes
      await window.conveyor?.deploy?.cancelBuild()
    } catch {
      // Ignore - process may already be dead
    }
    // Clear all deployment state
    deployStore.cancelIOSDeployment()
  }, [])

  // Main publish handler - check ASC key status and route accordingly
  const handlePublish = useCallback(async () => {
    if (disabled) return

    setIsCheckingCredentials(true)

    try {
      // Use projectStore path directly (git repo with node_modules)
      if (!projectPath) {
        console.error('[DeployiOSSection] No project path available')
        return
      }

      // Refresh credential status with project path
      const status = await checkiOSCredentialStatus(projectPath, isExpoConnected)
      deployStore.setIOSCredentialStatus(status)

      if (!status.hasExpoToken) {
        // User needs to connect Expo first
        console.log('[DeployiOSSection] Expo not connected, user needs to connect first')
        return
      }

      // Check if ASC API key is configured
      const checkResult = await window.conveyor?.deploy?.checkASCApiKey(projectPath)

      if (checkResult?.success && checkResult.configured) {
        // Has credentials - use Claude Code (non-interactive)
        // Set project owner based on selected account (for org builds)
        const selectedAccount = deployStore.selectedEasAccount.get()
        if (selectedAccount) {
          await setProjectOwner(projectPath, selectedAccount)
        }

        // Prepare the project
        const currentProj = workbenchStore.currentProject.get()
        const projectTitle = currentProj?.title || 'myapp'
        const expoUsername = tokens.expo?.username
        await prepareForDeployment(projectPath, expoUsername, projectTitle)

        // Trigger Claude Code deployment
        const deploymentPrompt = `/deploy-ios`
        workbenchStore.triggerChatPrompt(deploymentPrompt)
      } else {
        // No credentials yet - need interactive setup
        // Show wizard to get credentials first
        deployStore.openIOSSetupWizard()
        // Close modal after a short delay to ensure wizard state is applied
        setTimeout(() => deployStore.closeModal(), 0)
      }
    } finally {
      setIsCheckingCredentials(false)
    }
  }, [projectPath, disabled, isExpoConnected, tokens.expo?.username])

  return (
    <div className="flex flex-col gap-3">
      {/* Publish button row */}
      <div className="flex items-center justify-between ps-4 pe-3 py-3 border border-border rounded-[10px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">Publish to App Store</span>
        </div>
        {isRunning ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { deployStore.openIOSProgressModal(); deployStore.closeModal() }}
              className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium border border-border rounded-[10px] transition-all hover:bg-secondary cursor-pointer gap-1.5"
            >
              <Loader2 size={14} className="animate-spin" />
              <span>Progress</span>
            </button>
            <button
              onClick={handleCancel}
              className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-destructive border border-destructive/30 rounded-[10px] transition-all hover:bg-destructive/10 cursor-pointer gap-1.5"
            >
              <XCircle size={14} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <button
            onClick={handlePublish}
            disabled={isButtonDisabled}
            title={!hasFiles ? 'Project has no files to publish' : !projectPath ? 'Project path not set' : undefined}
            className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium bg-foreground text-background rounded-[10px] transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer gap-2"
          >
            {isCheckingCredentials ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <span>Publish</span>
            )}
          </button>
        )}
      </div>

      {/* Account selector - show when Expo is connected */}
      {isExpoConnected && (
        <div>
          {isLoadingAccounts ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              <span>Loading accounts...</span>
            </div>
          ) : easAccounts.length > 0 ? (
            <>
              <div className="text-xs text-muted-foreground mb-1.5">Build Account</div>
              <EasAccountSelector disabled={isRunning} />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
