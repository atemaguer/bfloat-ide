import { atom } from 'nanostores'
import type { DeployStep } from '@/app/utils/eas-output-parser'
import type { EasAccount } from '@/app/utils/eas-accounts'
import type { PromptType, HumanizedPrompt } from '@/lib/conveyor/schemas/deploy-schema'
import { cleanTerminalOutput } from '@/app/utils/clean-logs'

export type DeploymentPlatform = 'web' | 'android' | 'ios'
export type DeploymentStatus = 'idle' | 'running' | 'success' | 'error'
export type DeploymentNotificationStatus = 'success' | 'error'

// Apple login status for GUI-based login flow
export type AppleLoginStatus = 'idle' | 'logging-in' | 'needs-otp' | 'success' | 'error'

// Interactive auth mode for the new wizard flow
export type InteractiveAuthMode = 'none' | 'credentials' | '2fa' | 'terminal-fallback'

// Interactive auth state
export interface InteractiveAuthState {
  mode: InteractiveAuthMode
  promptType?: PromptType
  promptContext?: string
  suggestion?: string
  humanized?: HumanizedPrompt
}

export interface Deployment {
  id: string
  projectId?: string
  platform: DeploymentPlatform
  status: DeploymentStatus
  startedAt: string
  completedAt?: string
  url?: string
  error?: string
}

export interface DeploymentNotification {
  id: string
  platform: DeploymentPlatform
  status: DeploymentNotificationStatus
  message: string
  buildUrl?: string
}

/**
 * iOS deployment progress state
 */
export interface iOSDeployProgress {
  step: DeployStep
  percent: number
  message: string
  buildUrl?: string
  error?: string
}

/**
 * iOS setup wizard state
 */
export type iOSSetupStep = 'idle' | 'wizard' | 'deploying' | 'complete'

const STORAGE_KEY = 'bfloat_deployments'

function getStoredDeployments(): Deployment[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('[DeployStore] Failed to parse stored deployments:', e)
  }
  return []
}

function saveDeployments(deployments: Deployment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deployments))
  } catch (e) {
    console.error('[DeployStore] Failed to save deployments:', e)
  }
}

class DeployStore {
  // Modal visibility
  modalOpen = atom<boolean>(false)

  // Current running deployment
  activeDeployment = atom<Deployment | null>(null)

  // Whether to show embedded terminal (for interactive deployments like iOS)
  showTerminal = atom<boolean>(false)

  // Deployment history (persisted to localStorage)
  deployments = atom<Deployment[]>(getStoredDeployments())

  // Background completion notification
  deploymentNotification = atom<DeploymentNotification | null>(null)

  // Terminal ID for the current deployment
  terminalId = atom<string | null>(null)

  // iOS-specific state
  iOSSetupStep = atom<iOSSetupStep>('idle')
  iOSProgress = atom<iOSDeployProgress>({
    step: 'prepare',
    percent: 0,
    message: 'Preparing...',
  })
  iOSLogs = atom<string>('')
  iOSProgressModalOpen = atom<boolean>(false)
  iOSSetupWizardOpen = atom<boolean>(false)
  iOSCredentialStatus = atom<{
    hasExpoToken: boolean
    hasEasProject: boolean
    hasDistributionCert: boolean
    hasAscApiKey: boolean
    isFullyConfigured: boolean
    isFirstBuild: boolean
  } | null>(null)

  // Flag to trigger automated deployment from IOSDeployModals
  iOSShouldStartDeployment = atom<boolean>(false)

  // EAS account management
  easAccounts = atom<EasAccount[]>([])
  selectedEasAccount = atom<string | null>(null) // Account name to use for builds
  isLoadingAccounts = atom<boolean>(false)

  // Apple login state for GUI-based flow
  appleLoginStatus = atom<AppleLoginStatus>('idle')
  appleLoginError = atom<string | null>(null)
  appleId = atom<string>('') // Stores the Apple ID for retry with OTP

  // Build logs for collapsible logs section
  buildLogs = atom<string>('')

  // Interactive auth state for new wizard flow
  interactiveAuthState = atom<InteractiveAuthState>({ mode: 'none' })

  // Pending Apple credentials for interactive build
  pendingAppleCredentials = atom<{ appleId: string; password: string } | null>(null)

  constructor() {
    // Sync deployments to localStorage
    this.deployments.subscribe((value) => {
      saveDeployments(value)
    })
  }

  openModal(): void {
    this.modalOpen.set(true)
  }

  toggleModal(): void {
    if (this.modalOpen.get()) {
      this.closeModal()
    } else {
      this.openModal()
    }
  }

  closeModal(): void {
    // Allow closing the deploy panel even during active deployments
    // The deployment continues in the background
    this.modalOpen.set(false)
    this.showTerminal.set(false)
    this.terminalId.set(null)
  }

  startDeployment(platform: DeploymentPlatform, projectId?: string): Deployment {
    const deployment: Deployment = {
      id: `deploy-${Date.now()}`,
      projectId,
      platform,
      status: 'running',
      startedAt: new Date().toISOString(),
    }

    this.activeDeployment.set(deployment)

    return deployment
  }

  completeDeployment(url?: string): void {
    const active = this.activeDeployment.get()
    if (!active) return

    const completed: Deployment = {
      ...active,
      status: 'success',
      completedAt: new Date().toISOString(),
      url,
    }

    // Add to history
    const history = this.deployments.get()
    this.deployments.set([completed, ...history].slice(0, 50)) // Keep last 50

    this.activeDeployment.set(null)
    this.showTerminal.set(false)
  }

  failDeployment(error: string): void {
    const active = this.activeDeployment.get()
    if (!active) return

    const failed: Deployment = {
      ...active,
      status: 'error',
      completedAt: new Date().toISOString(),
      error,
    }

    // Add to history
    const history = this.deployments.get()
    this.deployments.set([failed, ...history].slice(0, 50))

    this.activeDeployment.set(null)
    this.showTerminal.set(false)
  }

  cancelDeployment(): void {
    const active = this.activeDeployment.get()
    if (!active) return

    this.activeDeployment.set(null)
    this.showTerminal.set(false)
    this.terminalId.set(null)
  }

  getDeploymentsByPlatform(platform: DeploymentPlatform): Deployment[] {
    return this.deployments.get().filter((d) => d.platform === platform)
  }

  getLatestDeployment(platform: DeploymentPlatform): Deployment | undefined {
    return this.deployments.get().find((d) => d.platform === platform)
  }

  // iOS-specific methods

  /**
   * Set iOS credential status
   */
  setIOSCredentialStatus(status: {
    hasExpoToken: boolean
    hasEasProject: boolean
    hasDistributionCert: boolean
    hasAscApiKey: boolean
    isFullyConfigured: boolean
    isFirstBuild: boolean
  } | null): void {
    this.iOSCredentialStatus.set(status)
  }

  /**
   * Open the iOS setup wizard
   */
  openIOSSetupWizard(): void {
    this.iOSSetupWizardOpen.set(true)
    this.iOSSetupStep.set('wizard')
  }

  /**
   * Close the iOS setup wizard
   */
  closeIOSSetupWizard(): void {
    this.iOSSetupWizardOpen.set(false)
    this.iOSSetupStep.set('idle')
  }

  /**
   * Start iOS deployment with progress tracking
   */
  startIOSDeployment(projectId?: string): void {
    this.iOSSetupStep.set('deploying')
    this.iOSProgressModalOpen.set(true)
    this.iOSProgress.set({
      step: 'prepare',
      percent: 0,
      message: 'Starting deployment...',
    })
    this.iOSLogs.set('')
    this.startDeployment('ios', projectId)
  }

  /**
   * Trigger automated iOS deployment
   * This sets a flag that IOSDeployModals watches to start the deployment
   */
  triggerIOSDeployment(): void {
    this.iOSShouldStartDeployment.set(true)
  }

  /**
   * Clear the deployment trigger flag
   */
  clearIOSDeploymentTrigger(): void {
    this.iOSShouldStartDeployment.set(false)
  }

  /**
   * Update iOS deployment progress
   */
  updateIOSProgress(progress: Partial<iOSDeployProgress>): void {
    const current = this.iOSProgress.get()
    this.iOSProgress.set({ ...current, ...progress })
  }

  /**
   * Append to iOS deployment logs
   * Uses comprehensive cleaning to remove ANSI codes, spinner characters, and escape sequences
   */
  appendIOSLog(data: string): void {
    const current = this.iOSLogs.get()
    const cleaned = cleanTerminalOutput(data)
    this.iOSLogs.set(current + cleaned)
  }

  /**
   * Complete iOS deployment successfully
   */
  completeIOSDeployment(buildUrl?: string): void {
    this.iOSProgress.set({
      step: 'complete',
      percent: 100,
      message: 'Deployment complete!',
      buildUrl,
    })
    this.iOSSetupStep.set('complete')
    this.completeDeployment(buildUrl)

    if (!this.iOSProgressModalOpen.get()) {
      this.showDeploymentNotification({
        id: `deploy-toast-${Date.now()}`,
        platform: 'ios',
        status: 'success',
        message: 'iOS build completed successfully.',
        buildUrl,
      })
    }
  }

  /**
   * Fail iOS deployment with error
   */
  failIOSDeployment(error: string): void {
    this.iOSProgress.set({
      ...this.iOSProgress.get(),
      step: 'error',
      error,
    })
    this.iOSSetupStep.set('idle')
    this.failDeployment(error)

    if (!this.iOSProgressModalOpen.get()) {
      this.showDeploymentNotification({
        id: `deploy-toast-${Date.now()}`,
        platform: 'ios',
        status: 'error',
        message: error || 'iOS build failed.',
      })
    }
  }

  /**
   * Cancel iOS deployment
   */
  cancelIOSDeployment(): void {
    this.iOSProgressModalOpen.set(false)
    this.iOSSetupStep.set('idle')
    this.cancelDeployment()
  }

  /**
   * Open the iOS progress modal (e.g. to view an in-progress deployment)
   */
  openIOSProgressModal(): void {
    this.iOSProgressModalOpen.set(true)
  }

  /**
   * Close the iOS progress modal
   */
  closeIOSProgressModal(): void {
    this.iOSProgressModalOpen.set(false)
    this.iOSSetupStep.set('idle')
  }

  /**
   * Reset iOS state for a fresh deployment
   */
  resetIOSState(): void {
    this.iOSSetupStep.set('idle')
    this.iOSProgress.set({
      step: 'prepare',
      percent: 0,
      message: 'Preparing...',
    })
    this.iOSLogs.set('')
    this.iOSProgressModalOpen.set(false)
    this.iOSSetupWizardOpen.set(false)
    // Don't reset credential status - it should persist
    // Reset Apple login state
    this.appleLoginStatus.set('idle')
    this.appleLoginError.set(null)
    this.buildLogs.set('')
  }

  // Apple login methods for GUI-based flow

  /**
   * Set Apple login status
   */
  setAppleLoginStatus(status: AppleLoginStatus): void {
    this.appleLoginStatus.set(status)
  }

  /**
   * Set Apple login error
   */
  setAppleLoginError(error: string | null): void {
    this.appleLoginError.set(error)
  }

  /**
   * Store Apple ID for OTP retry
   */
  setAppleId(appleId: string): void {
    this.appleId.set(appleId)
  }

  /**
   * Append to build logs
   * Uses comprehensive cleaning to remove ANSI codes, spinner characters, and escape sequences
   */
  appendBuildLog(data: string): void {
    const current = this.buildLogs.get()
    const cleaned = cleanTerminalOutput(data)
    this.buildLogs.set(current + cleaned)
  }

  /**
   * Clear build logs
   */
  clearBuildLogs(): void {
    this.buildLogs.set('')
  }

  /**
   * Reset Apple login state
   */
  resetAppleLoginState(): void {
    this.appleLoginStatus.set('idle')
    this.appleLoginError.set(null)
    this.appleId.set('')
  }

  // Interactive auth methods for new wizard flow

  /**
   * Set interactive auth state
   */
  setInteractiveAuthState(state: InteractiveAuthState): void {
    this.interactiveAuthState.set(state)
  }

  /**
   * Show credentials form
   */
  showCredentialsForm(): void {
    this.interactiveAuthState.set({ mode: 'credentials' })
  }

  /**
   * Show 2FA input
   */
  show2FAInput(context?: string, suggestion?: string): void {
    this.interactiveAuthState.set({
      mode: '2fa',
      promptType: '2fa',
      promptContext: context,
      suggestion,
    })
  }

  /**
   * Show terminal fallback
   */
  showTerminalFallback(promptType: PromptType, context?: string, suggestion?: string, humanized?: HumanizedPrompt): void {
    this.interactiveAuthState.set({
      mode: 'terminal-fallback',
      promptType,
      promptContext: context,
      suggestion,
      humanized,
    })
  }

  /**
   * Reset interactive auth state
   */
  resetInteractiveAuth(): void {
    this.interactiveAuthState.set({ mode: 'none' })
    this.pendingAppleCredentials.set(null)
  }

  /**
   * Store pending Apple credentials for interactive build
   */
  setPendingAppleCredentials(appleId: string, password: string): void {
    this.pendingAppleCredentials.set({ appleId, password })
    this.appleId.set(appleId) // Also store for OTP retry
  }

  /**
   * Get pending Apple credentials
   */
  getPendingAppleCredentials(): { appleId: string; password: string } | null {
    return this.pendingAppleCredentials.get()
  }

  /**
   * Clear pending Apple credentials
   */
  clearPendingAppleCredentials(): void {
    this.pendingAppleCredentials.set(null)
  }

  // EAS Account management methods

  /**
   * Set available EAS accounts
   */
  setEasAccounts(accounts: EasAccount[]): void {
    this.easAccounts.set(accounts)

    // Auto-select: prefer org account (non-owner role) as they're likely paid, otherwise first account
    if (!this.selectedEasAccount.get() && accounts.length > 0) {
      const orgAccount = accounts.find((a) => a.role !== 'owner')
      this.selectedEasAccount.set(orgAccount?.name || accounts[0].name)
    }
  }

  /**
   * Select an EAS account for builds
   */
  selectEasAccount(accountName: string): void {
    this.selectedEasAccount.set(accountName)
    // Persist selection
    try {
      localStorage.setItem('bfloat_selected_eas_account', accountName)
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Load persisted account selection
   */
  loadSelectedAccount(): void {
    try {
      const saved = localStorage.getItem('bfloat_selected_eas_account')
      if (saved) {
        this.selectedEasAccount.set(saved)
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get the currently selected account details
   */
  getSelectedAccount(): EasAccount | null {
    const selected = this.selectedEasAccount.get()
    if (!selected) return null
    return this.easAccounts.get().find((a) => a.name === selected) || null
  }

  /**
   * Set loading state for accounts
   */
  setLoadingAccounts(loading: boolean): void {
    this.isLoadingAccounts.set(loading)
  }

  /**
   * Show a deployment notification toast
   */
  showDeploymentNotification(notification: DeploymentNotification): void {
    this.deploymentNotification.set(notification)
  }

  /**
   * Dismiss the current deployment notification
   */
  dismissDeploymentNotification(): void {
    this.deploymentNotification.set(null)
  }
}

export const deployStore = new DeployStore()
