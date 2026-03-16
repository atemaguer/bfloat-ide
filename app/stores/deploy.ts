import { createStore } from 'zustand/vanilla'
import type { DeployStep } from '@/app/utils/eas-output-parser'
import type { EasAccount } from '@/app/utils/eas-accounts'
import type { PromptType, HumanizedPrompt } from '@/lib/conveyor/schemas/deploy-schema'
import { appendCleanTerminalChunk } from '@/app/utils/clean-logs'
import type { DeployErrorKind } from '@/app/utils/deploy-error'

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
export type IOSWizardResumeStep = 'apple-credentials' | null

const STORAGE_KEY = 'bfloat_deployments'
const MIGRATION_KEY = 'bfloat_deployments_migrated'

class DeployStore {
  // Modal visibility
  modalOpen = createStore<boolean>(() => false)

  // Current running deployment
  activeDeployment = createStore<Deployment | null>(() => null)

  // Whether to show embedded terminal (for interactive deployments like iOS)
  showTerminal = createStore<boolean>(() => false)

  // Deployment history (persisted to projects.json via sidecar)
  deployments = createStore<Deployment[]>(() => [])

  // Background completion notification
  deploymentNotification = createStore<DeploymentNotification | null>(() => null)

  // Terminal ID for the current deployment
  terminalId = createStore<string | null>(() => null)

  // iOS-specific state
  iOSSetupStep = createStore<iOSSetupStep>(() => 'idle')
  iOSProgress = createStore<iOSDeployProgress>(() => ({
    step: 'prepare',
    percent: 0,
    message: 'Preparing...',
  }))
  iOSLogs = createStore<string>(() => '')
  iOSProgressModalOpen = createStore<boolean>(() => false)
  iOSSetupWizardOpen = createStore<boolean>(() => false)
  iOSErrorKind = createStore<DeployErrorKind>(() => 'generic')
  iOSSetupResumeStep = createStore<IOSWizardResumeStep>(() => null)
  iOSCredentialStatus = createStore<{
    hasExpoToken: boolean
    hasEasProject: boolean
    hasDistributionCert: boolean
    hasAscApiKey: boolean
    isFullyConfigured: boolean
    isFirstBuild: boolean
  } | null>(() => null)

  // Flag to trigger automated deployment from IOSDeployModals
  iOSShouldStartDeployment = createStore<boolean>(() => false)

  // EAS account management
  easAccounts = createStore<EasAccount[]>(() => [])
  selectedEasAccount = createStore<string | null>(() => null) // Account name to use for builds
  isLoadingAccounts = createStore<boolean>(() => false)

  // Apple login state for GUI-based flow
  appleLoginStatus = createStore<AppleLoginStatus>(() => 'idle')
  appleLoginError = createStore<string | null>(() => null)
  appleId = createStore<string>(() => '') // Stores the Apple ID for retry with OTP

  // Build logs for collapsible logs section
  buildLogs = createStore<string>(() => '')

  // Interactive auth state for new wizard flow
  interactiveAuthState = createStore<InteractiveAuthState>(() => ({ mode: 'none' }))

  // Pending Apple credentials for interactive build
  pendingAppleCredentials = createStore<{ appleId: string; password: string } | null>(() => null)

  /**
   * Load deployments from sidecar for the given project
   */
  async loadDeployments(projectId: string): Promise<void> {
    try {
      const deployments = await window.conveyor.localProjects.listDeployments(projectId)
      this.deployments.setState(deployments ?? [], true)
    } catch (err) {
      console.warn('[DeployStore] Failed to load deployments:', err)
    }
  }

  /**
   * One-time migration from localStorage to sidecar.
   * Call after sidecar is confirmed ready.
   */
  async migrate(): Promise<void> {
    try {
      if (localStorage.getItem(MIGRATION_KEY)) return

      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        localStorage.setItem(MIGRATION_KEY, '1')
        return
      }

      const deployments: Deployment[] = JSON.parse(raw)

      // Group by projectId
      const byProject = new Map<string, Deployment[]>()
      for (const d of deployments) {
        if (!d.projectId) continue // Discard orphans
        const bucket = byProject.get(d.projectId) ?? []
        bucket.push(d)
        byProject.set(d.projectId, bucket)
      }

      // Write each bucket to sidecar
      const promises: Promise<void>[] = []
      for (const [projectId, projectDeployments] of byProject) {
        for (const deployment of projectDeployments) {
          promises.push(
            window.conveyor.localProjects.addDeployment(projectId, deployment)
          )
        }
      }
      await Promise.allSettled(promises)

      localStorage.setItem(MIGRATION_KEY, '1')
      console.log(`[DeployStore] Migrated ${deployments.length} deployments from localStorage`)
    } catch (err) {
      console.warn('[DeployStore] Migration failed:', err)
    }
  }

  openModal(): void {
    this.modalOpen.setState(true, true)
  }

  toggleModal(): void {
    if (this.modalOpen.getState()) {
      this.closeModal()
    } else {
      this.openModal()
    }
  }

  closeModal(): void {
    // Allow closing the deploy panel even during active deployments
    // The deployment continues in the background
    this.modalOpen.setState(false, true)
    this.showTerminal.setState(false, true)
    this.terminalId.setState(null, true)
  }

  startDeployment(platform: DeploymentPlatform, projectId?: string): Deployment {
    const deployment: Deployment = {
      id: `deploy-${Date.now()}`,
      projectId,
      platform,
      status: 'running',
      startedAt: new Date().toISOString(),
    }

    this.activeDeployment.setState(deployment, true)

    return deployment
  }

  async completeDeployment(url?: string): Promise<void> {
    const active = this.activeDeployment.getState()
    if (!active) return

    const completed: Deployment = {
      ...active,
      status: 'success',
      completedAt: new Date().toISOString(),
      url,
    }

    // Optimistic in-memory update
    const history = this.deployments.getState()
    this.deployments.setState([completed, ...history].slice(0, 50), true)

    this.activeDeployment.setState(null, true)
    this.showTerminal.setState(false, true)

    // Persist to sidecar (fire-and-forget)
    if (completed.projectId) {
      window.conveyor.localProjects.addDeployment(completed.projectId, completed).catch((err: unknown) =>
        console.warn('[DeployStore] Failed to persist deployment:', err)
      )
    }
  }

  async failDeployment(error: string): Promise<void> {
    const active = this.activeDeployment.getState()
    if (!active) return

    const failed: Deployment = {
      ...active,
      status: 'error',
      completedAt: new Date().toISOString(),
      error,
    }

    // Optimistic in-memory update
    const history = this.deployments.getState()
    this.deployments.setState([failed, ...history].slice(0, 50), true)

    this.activeDeployment.setState(null, true)
    this.showTerminal.setState(false, true)

    // Persist to sidecar (fire-and-forget)
    if (failed.projectId) {
      window.conveyor.localProjects.addDeployment(failed.projectId, failed).catch((err: unknown) =>
        console.warn('[DeployStore] Failed to persist deployment:', err)
      )
    }
  }

  cancelDeployment(): void {
    const active = this.activeDeployment.getState()
    if (!active) return

    this.activeDeployment.setState(null, true)
    this.showTerminal.setState(false, true)
    this.terminalId.setState(null, true)
  }

  getDeploymentsByPlatform(platform: DeploymentPlatform): Deployment[] {
    return this.deployments.getState().filter((d) => d.platform === platform)
  }

  getLatestDeployment(platform: DeploymentPlatform): Deployment | undefined {
    return this.deployments.getState().find((d) => d.platform === platform)
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
    this.iOSCredentialStatus.setState(status, true)
  }

  /**
   * Open the iOS setup wizard
   */
  openIOSSetupWizard(): void {
    this.iOSSetupWizardOpen.setState(true, true)
    this.iOSSetupStep.setState('wizard', true)
  }

  /**
   * Close the iOS setup wizard
   */
  closeIOSSetupWizard(): void {
    this.iOSSetupWizardOpen.setState(false, true)
    this.iOSSetupStep.setState('idle', true)
    this.iOSSetupResumeStep.setState(null, true)
  }

  setIOSSetupResumeStep(step: IOSWizardResumeStep): void {
    this.iOSSetupResumeStep.setState(step, true)
  }

  /**
   * Start iOS deployment with progress tracking
   */
  startIOSDeployment(projectId?: string): void {
    this.iOSSetupStep.setState('deploying', true)
    this.iOSProgressModalOpen.setState(true, true)
    this.iOSErrorKind.setState('generic', true)
    this.iOSProgress.setState({
      step: 'prepare',
      percent: 0,
      message: 'Starting deployment...',
    }, true)
    this.iOSLogs.setState('', true)
    this.startDeployment('ios', projectId)
  }

  /**
   * Trigger automated iOS deployment
   * This sets a flag that IOSDeployModals watches to start the deployment
   */
  triggerIOSDeployment(): void {
    this.iOSShouldStartDeployment.setState(true, true)
  }

  /**
   * Clear the deployment trigger flag
   */
  clearIOSDeploymentTrigger(): void {
    this.iOSShouldStartDeployment.setState(false, true)
  }

  /**
   * Update iOS deployment progress
   */
  updateIOSProgress(progress: Partial<iOSDeployProgress>): void {
    const current = this.iOSProgress.getState()
    this.iOSProgress.setState({ ...current, ...progress }, true)
  }

  /**
   * Append to iOS deployment logs
   * Uses comprehensive cleaning to remove ANSI codes, spinner characters, and escape sequences
   */
  appendIOSLog(data: string): void {
    const current = this.iOSLogs.getState()
    this.iOSLogs.setState(appendCleanTerminalChunk(current, data), true)
  }

  /**
   * Complete iOS deployment successfully
   */
  async completeIOSDeployment(buildUrl?: string): Promise<void> {
    this.iOSProgress.setState({
      step: 'complete',
      percent: 100,
      message: 'Deployment complete!',
      buildUrl,
    }, true)
    this.iOSSetupStep.setState('complete', true)
    await this.completeDeployment(buildUrl)

    if (!this.iOSProgressModalOpen.getState()) {
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
  async failIOSDeployment(error: string, errorKind: DeployErrorKind = 'generic'): Promise<void> {
    this.iOSProgress.setState({
      ...this.iOSProgress.getState(),
      step: 'error',
      error,
    }, true)
    this.iOSErrorKind.setState(errorKind, true)
    this.iOSSetupStep.setState('idle', true)
    await this.failDeployment(error)

    if (!this.iOSProgressModalOpen.getState()) {
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
    this.iOSProgressModalOpen.setState(false, true)
    this.iOSSetupStep.setState('idle', true)
    this.cancelDeployment()
  }

  /**
   * Open the iOS progress modal (e.g. to view an in-progress deployment)
   */
  openIOSProgressModal(): void {
    this.iOSProgressModalOpen.setState(true, true)
  }

  /**
   * Close the iOS progress modal
   */
  closeIOSProgressModal(): void {
    this.iOSProgressModalOpen.setState(false, true)
    this.iOSSetupStep.setState('idle', true)
  }

  /**
   * Reset iOS state for a fresh deployment
   */
  resetIOSState(): void {
    this.iOSSetupStep.setState('idle', true)
    this.iOSProgress.setState({
      step: 'prepare',
      percent: 0,
      message: 'Preparing...',
    }, true)
    this.iOSLogs.setState('', true)
    this.iOSProgressModalOpen.setState(false, true)
    this.iOSSetupWizardOpen.setState(false, true)
    this.iOSErrorKind.setState('generic', true)
    this.iOSSetupResumeStep.setState(null, true)
    // Don't reset credential status - it should persist
    // Reset Apple login state
    this.appleLoginStatus.setState('idle', true)
    this.appleLoginError.setState(null, true)
    this.buildLogs.setState('', true)
  }

  // Apple login methods for GUI-based flow

  /**
   * Set Apple login status
   */
  setAppleLoginStatus(status: AppleLoginStatus): void {
    this.appleLoginStatus.setState(status, true)
  }

  /**
   * Set Apple login error
   */
  setAppleLoginError(error: string | null): void {
    this.appleLoginError.setState(error, true)
  }

  /**
   * Store Apple ID for OTP retry
   */
  setAppleId(appleId: string): void {
    this.appleId.setState(appleId, true)
  }

  /**
   * Append to build logs
   * Uses comprehensive cleaning to remove ANSI codes, spinner characters, and escape sequences
   */
  appendBuildLog(data: string): void {
    const current = this.buildLogs.getState()
    this.buildLogs.setState(appendCleanTerminalChunk(current, data), true)
  }

  /**
   * Clear build logs
   */
  clearBuildLogs(): void {
    this.buildLogs.setState('', true)
  }

  /**
   * Reset Apple login state
   */
  resetAppleLoginState(): void {
    this.appleLoginStatus.setState('idle', true)
    this.appleLoginError.setState(null, true)
    this.appleId.setState('', true)
  }

  // Interactive auth methods for new wizard flow

  /**
   * Set interactive auth state
   */
  setInteractiveAuthState(state: InteractiveAuthState): void {
    this.interactiveAuthState.setState(state, true)
  }

  /**
   * Show credentials form
   */
  showCredentialsForm(): void {
    this.interactiveAuthState.setState({ mode: 'credentials' }, true)
  }

  /**
   * Show 2FA input
   */
  show2FAInput(context?: string, suggestion?: string): void {
    this.interactiveAuthState.setState({
      mode: '2fa',
      promptType: '2fa',
      promptContext: context,
      suggestion,
    }, true)
  }

  /**
   * Show terminal fallback
   */
  showTerminalFallback(promptType: PromptType, context?: string, suggestion?: string, humanized?: HumanizedPrompt): void {
    this.interactiveAuthState.setState({
      mode: 'terminal-fallback',
      promptType,
      promptContext: context,
      suggestion,
      humanized,
    }, true)
  }

  /**
   * Reset interactive auth state
   */
  resetInteractiveAuth(): void {
    this.interactiveAuthState.setState({ mode: 'none' }, true)
    this.pendingAppleCredentials.setState(null, true)
  }

  /**
   * Store pending Apple credentials for interactive build
   */
  setPendingAppleCredentials(appleId: string, password: string): void {
    this.pendingAppleCredentials.setState({ appleId, password }, true)
    this.appleId.setState(appleId, true) // Also store for OTP retry
  }

  /**
   * Get pending Apple credentials
   */
  getPendingAppleCredentials(): { appleId: string; password: string } | null {
    return this.pendingAppleCredentials.getState()
  }

  /**
   * Clear pending Apple credentials
   */
  clearPendingAppleCredentials(): void {
    this.pendingAppleCredentials.setState(null, true)
  }

  // EAS Account management methods

  /**
   * Set available EAS accounts
   */
  setEasAccounts(accounts: EasAccount[]): void {
    const seen = new Set<string>()
    const deduped = accounts.filter((account) => {
      const key = account.name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    this.easAccounts.setState(deduped, true)

    // Auto-select: prefer org account (non-owner role) as they're likely paid, otherwise first account
    const selected = this.selectedEasAccount.getState()
    const selectedStillExists = selected ? deduped.some((a) => a.name === selected) : false
    if ((!selected || !selectedStillExists) && deduped.length > 0) {
      const orgAccount = deduped.find((a) => a.role !== 'owner')
      this.selectedEasAccount.setState(orgAccount?.name || deduped[0].name, true)
    }
  }

  /**
   * Select an EAS account for builds
   */
  selectEasAccount(accountName: string): void {
    this.selectedEasAccount.setState(accountName, true)
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
        this.selectedEasAccount.setState(saved, true)
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get the currently selected account details
   */
  getSelectedAccount(): EasAccount | null {
    const selected = this.selectedEasAccount.getState()
    if (!selected) return null
    return this.easAccounts.getState().find((a) => a.name === selected) || null
  }

  /**
   * Set loading state for accounts
   */
  setLoadingAccounts(loading: boolean): void {
    this.isLoadingAccounts.setState(loading, true)
  }

  /**
   * Show a deployment notification toast
   */
  showDeploymentNotification(notification: DeploymentNotification): void {
    this.deploymentNotification.setState(notification, true)
  }

  /**
   * Dismiss the current deployment notification
   */
  dismissDeploymentNotification(): void {
    this.deploymentNotification.setState(null, true)
  }
}

export const deployStore = new DeployStore()
