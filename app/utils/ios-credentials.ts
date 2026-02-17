/**
 * iOS Credential Status Checker
 *
 * Checks the status of iOS deployment credentials to determine if:
 * - One-time setup wizard is needed
 * - Automated deployment can proceed
 */

export interface iOSCredentialStatus {
  /** Whether EXPO_TOKEN is available for authentication */
  hasExpoToken: boolean
  /** Whether the project has an EAS project ID configured */
  hasEasProject: boolean
  /** Whether iOS distribution credentials exist on EAS (after first build) */
  hasDistributionCert: boolean
  /** Whether App Store Connect API key is configured */
  hasAscApiKey: boolean
  /** Whether all required credentials are configured for automated deployment */
  isFullyConfigured: boolean
  /** Whether this appears to be the first iOS build (no credentials stored) */
  isFirstBuild: boolean
}

/**
 * Check if EAS project is initialized by looking for projectId in app.json
 */
async function checkEasProject(projectPath: string): Promise<boolean> {
  if (!window.conveyor?.filesystem) {
    return false
  }

  try {
    const appJsonPath = `${projectPath}/app.json`
    const readResult = await window.conveyor.filesystem.readFile(appJsonPath)

    if (!readResult.success || !readResult.content) {
      return false
    }

    const appConfig = JSON.parse(readResult.content)
    const projectId = appConfig.expo?.extra?.eas?.projectId

    return Boolean(projectId)
  } catch {
    return false
  }
}

/**
 * Check if ASC API key is configured in eas.json
 * Uses the IPC call when available for more accurate checking
 */
async function checkAscApiKey(projectPath: string): Promise<boolean> {
  // Try using the IPC call first (validates key file exists)
  if (window.conveyor?.deploy?.checkASCApiKey) {
    try {
      const result = await window.conveyor.deploy.checkASCApiKey(projectPath)
      return result.configured
    } catch {
      // Fall back to file-based check
    }
  }

  // Fallback: check eas.json directly
  if (!window.conveyor?.filesystem) {
    return false
  }

  try {
    const easJsonPath = `${projectPath}/eas.json`
    const readResult = await window.conveyor.filesystem.readFile(easJsonPath)

    if (!readResult.success || !readResult.content) {
      return false
    }

    const easConfig = JSON.parse(readResult.content)

    // Check for ASC API key configuration in submit section
    const submitConfig = easConfig.submit?.production?.ios
    if (submitConfig?.ascApiKeyPath && submitConfig?.ascApiKeyId && submitConfig?.ascApiKeyIssuerId) {
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Check if iOS distribution credentials exist on EAS
 * This requires running an EAS command to query credentials
 */
async function checkDistributionCredentials(projectPath: string): Promise<boolean> {
  // For now, we assume credentials exist if:
  // 1. EAS project is initialized
  // 2. There's a previous iOS build in history
  // This is a heuristic - the real check would require running `eas credentials --json`

  if (!window.conveyor?.filesystem) {
    return false
  }

  try {
    // Check for .easignore or other indicators of previous builds
    const hasEasProject = await checkEasProject(projectPath)
    if (!hasEasProject) {
      return false
    }

    // Check for any iOS build artifacts or history
    // For a more accurate check, we'd need to run: eas credentials --platform ios --json
    // For now, we'll check if the project has been built before by looking at eas.json
    // and checking if there are iOS-specific configurations

    const easJsonPath = `${projectPath}/eas.json`
    const readResult = await window.conveyor.filesystem.readFile(easJsonPath)

    if (!readResult.success || !readResult.content) {
      return false
    }

    const easConfig = JSON.parse(readResult.content)

    // If there's iOS-specific build config beyond defaults, likely has been set up
    const iosBuildConfig = easConfig.build?.production?.ios || easConfig.build?.development?.ios
    if (iosBuildConfig && Object.keys(iosBuildConfig).length > 0) {
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Check if Expo token is available for authentication
 * This is passed in from the component since tokens are stored via IPC
 */
function checkExpoToken(hasExpoToken?: boolean): boolean {
  return hasExpoToken ?? false
}

/**
 * Main function to check iOS credential status
 * Returns detailed status of all required credentials
 * @param projectPath - Path to the project directory
 * @param isExpoConnected - Whether Expo account is connected (from providerAuthStore)
 */
export async function checkiOSCredentialStatus(
  projectPath: string,
  isExpoConnected: boolean = false
): Promise<iOSCredentialStatus> {
  const [hasEasProject, hasAscApiKey, hasDistributionCert] = await Promise.all([
    checkEasProject(projectPath),
    checkAscApiKey(projectPath),
    checkDistributionCredentials(projectPath),
  ])

  const hasExpoToken = checkExpoToken(isExpoConnected)

  // Determine if this is a first build scenario
  // First build if we don't have API key configured
  const isFirstBuild = hasExpoToken && !hasAscApiKey

  // Fully configured means:
  // - Expo token available (for EAS CLI auth)
  // - EAS project initialized
  // - ASC API key configured (enables non-interactive builds)
  // Note: Distribution credentials are created automatically by EAS
  const isFullyConfigured = hasExpoToken && hasEasProject && hasAscApiKey

  return {
    hasExpoToken,
    hasEasProject,
    hasDistributionCert,
    hasAscApiKey,
    isFullyConfigured,
    isFirstBuild,
  }
}

/**
 * Quick check to determine if iOS deployment can be automated
 * Returns true if all credentials are ready for non-interactive deployment
 */
export async function canAutoDeployiOS(
  projectPath: string,
  isExpoConnected: boolean = false
): Promise<boolean> {
  const status = await checkiOSCredentialStatus(projectPath, isExpoConnected)
  return status.isFullyConfigured
}

/**
 * Get a human-readable description of what's missing for iOS deployment
 */
export function getMissingCredentialsMessage(status: iOSCredentialStatus): string {
  const missing: string[] = []

  if (!status.hasExpoToken) {
    missing.push('Expo account connection')
  }

  if (!status.hasEasProject) {
    missing.push('EAS project initialization')
  }

  if (!status.hasAscApiKey) {
    missing.push('App Store Connect API Key')
  }

  if (missing.length === 0) {
    return 'All credentials are configured'
  }

  return `Missing: ${missing.join(', ')}`
}
