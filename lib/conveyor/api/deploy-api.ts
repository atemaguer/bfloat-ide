import { ConveyorApi } from '@/lib/preload/shared'
import type {
  SaveASCApiKeyArgs,
  SaveASCApiKeyResult,
  CheckASCApiKeyResult,
  IOSBuildArgs,
  IOSBuildResult,
  IOSBuildProgress,
  IOSBuildInteractiveArgs,
  AppleSessionInfo,
  InteractiveAuthEvent,
} from '../schemas/deploy-schema'

type BuildLogCallback = (data: { data: string }) => void
type BuildProgressCallback = (progress: IOSBuildProgress) => void
type InteractiveAuthCallback = (event: InteractiveAuthEvent) => void

export type AppleSessionsResult = {
  sessions: AppleSessionInfo[]
  hasValidSession: boolean
}

// Store callbacks for build events
const buildLogCallbacks = new Set<BuildLogCallback>()
const buildProgressCallbacks = new Set<BuildProgressCallback>()
const interactiveAuthCallbacks = new Set<InteractiveAuthCallback>()
let globalBuildListenersInitialized = false

export class DeployApi extends ConveyorApi {
  /**
   * Save App Store Connect API Key
   * Stores the .p8 file securely and updates eas.json
   */
  saveASCApiKey = (args: SaveASCApiKeyArgs): Promise<SaveASCApiKeyResult> =>
    this.invoke('deploy:save-asc-api-key', args)

  /**
   * Check if App Store Connect API Key is configured
   * Returns key info if configured
   */
  checkASCApiKey = (projectPath: string): Promise<CheckASCApiKeyResult> =>
    this.invoke('deploy:check-asc-api-key', { projectPath })

  /**
   * Start iOS build and submit to TestFlight
   * Uses --non-interactive if API key is configured
   * Progress updates are sent via events
   */
  startIOSBuild = (args: IOSBuildArgs): Promise<IOSBuildResult> =>
    this.invoke('deploy:ios-build', args)

  /**
   * Cancel an ongoing build
   */
  cancelBuild = (buildId?: string): Promise<{ success: boolean }> =>
    this.invoke('deploy:cancel-build', { buildId })

  // Initialize global listeners for build events
  private initGlobalBuildListeners = (): void => {
    if (globalBuildListenersInitialized) return
    globalBuildListenersInitialized = true

    this.renderer.on('deploy:ios-build-log', (_, data: { data: string }) => {
      buildLogCallbacks.forEach((callback) => callback(data))
    })

    this.renderer.on('deploy:ios-build-progress', (_, progress: IOSBuildProgress) => {
      buildProgressCallbacks.forEach((callback) => callback(progress))
    })

    this.renderer.on('deploy:ios-interactive-auth', (_, event: InteractiveAuthEvent) => {
      interactiveAuthCallbacks.forEach((callback) => callback(event))
    })
  }

  /**
   * Subscribe to build log output
   * Returns unsubscribe function
   */
  onBuildLog = (callback: BuildLogCallback): (() => void) => {
    this.initGlobalBuildListeners()
    buildLogCallbacks.add(callback)
    return () => {
      buildLogCallbacks.delete(callback)
    }
  }

  /**
   * Subscribe to build progress updates
   * Returns unsubscribe function
   */
  onBuildProgress = (callback: BuildProgressCallback): (() => void) => {
    this.initGlobalBuildListeners()
    buildProgressCallbacks.add(callback)
    return () => {
      buildProgressCallbacks.delete(callback)
    }
  }

  /**
   * Clear all build event listeners
   */
  clearBuildListeners = (): void => {
    buildLogCallbacks.clear()
    buildProgressCallbacks.clear()
    interactiveAuthCallbacks.clear()
  }

  /**
   * Start interactive iOS build with Apple ID credentials
   * Uses Apple ID + password flow with 2FA support
   */
  startInteractiveIOSBuild = (args: IOSBuildInteractiveArgs): Promise<IOSBuildResult> =>
    this.invoke('deploy:ios-build-interactive', args)

  /**
   * Submit 2FA code during interactive build
   */
  submit2FACode = (code: string): Promise<{ success: boolean }> =>
    this.invoke('deploy:submit-2fa', { code })

  /**
   * Submit terminal input during interactive build
   * For handling unknown prompts in terminal fallback mode
   */
  submitTerminalInput = (input: string): Promise<{ success: boolean }> =>
    this.invoke('deploy:submit-terminal-input', { input })

  /**
   * Check Apple session status
   * Returns session info including age and validity
   */
  checkAppleSession = (appleId: string): Promise<AppleSessionInfo> =>
    this.invoke('deploy:check-apple-session', { appleId })

  /**
   * Clear Apple session(s)
   * Pass appleId to clear specific session, or omit to clear all
   */
  clearAppleSession = (appleId?: string): Promise<{ success: boolean; cleared: number }> =>
    this.invoke('deploy:clear-apple-session', { appleId })

  /**
   * List all Apple sessions
   * Returns all cached Apple sessions along with validity info
   * Useful to check if user has valid credentials before prompting
   */
  listAppleSessions = (): Promise<AppleSessionsResult> =>
    this.invoke('deploy:list-apple-sessions')

  /**
   * Write Apple credentials to a secure file for deployment
   * If projectPath is provided, writes to project/.bfloat-ide/creds/ (avoids Claude permission issues)
   * Otherwise writes to ~/.bfloat-ide/temp/creds/
   * Returns the path to the created file
   */
  writeAppleCredsFile = (args: { appleId: string; password: string; projectPath?: string }): Promise<{ success: boolean; path?: string }> =>
    this.invoke('deploy:write-apple-creds-file', args)

  /**
   * Delete a credentials temp file
   */
  deleteCredsFile = (path: string): Promise<{ success: boolean }> =>
    this.invoke('deploy:delete-creds-file', { path })

  /**
   * Subscribe to interactive auth events
   * Fired when prompts are detected during build
   * Returns unsubscribe function
   */
  onInteractiveAuth = (callback: InteractiveAuthCallback): (() => void) => {
    this.initGlobalBuildListeners()
    interactiveAuthCallbacks.add(callback)
    return () => {
      interactiveAuthCallbacks.delete(callback)
    }
  }
}
