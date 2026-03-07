/**
 * EAS Account Management
 *
 * Utilities for fetching and managing Expo/EAS accounts.
 * Uses CLI commands to get available accounts.
 */

import { terminal, filesystem } from '@/app/api/sidecar'

export interface EasAccount {
  name: string
  role: 'owner' | 'admin' | 'developer' | 'viewer'
}

export interface EasAccountsResult {
  success: boolean
  accounts: EasAccount[]
  currentUser?: string
  error?: string
}

let inFlightAccountsFetch: Promise<EasAccountsResult> | null = null

/**
 * Parse the output of `eas whoami` to extract available accounts
 *
 * Example output (may include version warning):
 * ```
 * ★ eas-cli@16.28.0 is now available.
 * To upgrade, run:
 * npm install -g eas-cli
 * Proceeding with outdated version.
 *
 * ben_afloat
 *
 * Accounts:
 * • ben_afloat (Role: Owner)
 * • bfloat (Role: Admin)
 * ```
 */
function parseWhoamiOutput(output: string): EasAccountsResult {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter((line) => {
      if (!line) return false
      // Drop shell noise/prompt echoes that can appear in PTY captures.
      if (
        line.startsWith('➜') ||
        line.startsWith('$ ') ||
        line.startsWith('npx -y eas-cli whoami')
      ) {
        return false
      }
      return true
    })

  if (lines.length === 0) {
    return { success: false, accounts: [], error: 'No output from eas whoami' }
  }

  // Check for "not logged in" errors anywhere in output
  if (output.toLowerCase().includes('not logged') || output.toLowerCase().includes('log in')) {
    return { success: false, accounts: [], error: 'Not logged in to EAS' }
  }

  const accounts: EasAccount[] = []
  let currentUser: string | undefined

  // Parse account lines (format: "• account_name (Role: RoleName)")
  const accountPattern = /^[•*-]\s*(\S+)\s*\(Role:\s*(\w+)\)/i

  // Find the "Accounts:" section and parse accounts
  let inAccountsSection = false

  for (const line of lines) {
    // Skip empty lines and informational noise lines
    if (!line || line.startsWith('★') || line.startsWith('To upgrade') ||
        line.startsWith('npm install') || line.startsWith('Proceeding with') ||
        line.startsWith('error: could not lock config file')) {
      continue
    }

    // Detect "Accounts:" header
    if (line.toLowerCase() === 'accounts:') {
      inAccountsSection = true
      continue
    }

    // Parse account entries
    const match = line.match(accountPattern)
    if (match) {
      const [, name, role] = match
      accounts.push({
        name,
        role: role.toLowerCase() as EasAccount['role'],
      })
      continue
    }

    // If we haven't found currentUser yet and this line looks like a username
    // (single word, not a header, not an account line)
    if (!currentUser && !inAccountsSection && /^[a-zA-Z0-9_-]+$/.test(line)) {
      currentUser = line
    }
  }

  if (accounts.length === 0) {
    // Fallback: older/partial outputs may only include the active user.
    if (currentUser) {
      return {
        success: true,
        accounts: [{ name: currentUser, role: 'owner' }],
        currentUser,
      }
    }
    return { success: false, accounts: [], error: 'No accounts found in output' }
  }

  return {
    success: true,
    accounts,
    currentUser,
  }
}

/**
 * Fetch available EAS accounts using the CLI
 */
export async function fetchEasAccounts(): Promise<EasAccountsResult> {
  if (inFlightAccountsFetch) {
    return inFlightAccountsFetch
  }

  inFlightAccountsFetch = fetchEasAccountsInternal()
  try {
    return await inFlightAccountsFetch
  } finally {
    inFlightAccountsFetch = null
  }
}

async function fetchEasAccountsInternal(): Promise<EasAccountsResult> {
  const terminalId = `eas-whoami-${Date.now()}`

  try {
    // Create terminal
    const result = await terminal.create(terminalId)
    if (!result.success) {
      console.warn('[EasAccounts] Failed to create terminal')
      return { success: false, accounts: [], error: 'Failed to create terminal' }
    }

    // Execute and capture command output deterministically.
    const execResult = await terminal.executeCommand(terminalId, 'npx -y eas-cli whoami 2>&1')
    const output = execResult.output ?? ''

    console.log('[EasAccounts] Raw output:', output)

    // Parse output
    const parsed = parseWhoamiOutput(output)
    console.log('[EasAccounts] Parsed result:', parsed)

    return parsed
  } catch (error) {
    console.error('[EasAccounts] Error fetching accounts:', error)
    return {
      success: false,
      accounts: [],
      error: error instanceof Error ? error.message : 'Failed to fetch accounts',
    }
  } finally {
    try {
      terminal.removeListeners(terminalId)
      await terminal.kill(terminalId)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get the current project's EAS owner from app.json
 */
export async function getProjectOwner(projectPath: string): Promise<string | null> {
  try {
    const appJsonPath = `${projectPath}/app.json`
    if (!filesystem) return null
    const result = await filesystem.readFile(appJsonPath)

    if (result.success && result.content) {
      const appConfig = JSON.parse(result.content)
      return appConfig.expo?.owner || null
    }
  } catch {
    // Ignore errors
  }

  return null
}

/**
 * Set the project's EAS owner in app.json
 * Also removes projectId so eas init will create/link under new owner
 */
export async function setProjectOwner(
  projectPath: string,
  owner: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const appJsonPath = `${projectPath}/app.json`
    if (!filesystem) {
      return { success: false, error: 'Filesystem API not available' }
    }
    const result = await filesystem.readFile(appJsonPath)

    if (!result.success || !result.content) {
      return { success: false, error: 'Could not read app.json' }
    }

    const appConfig = JSON.parse(result.content)

    if (!appConfig.expo) {
      appConfig.expo = {}
    }

    const currentOwner = appConfig.expo.owner
    const currentProjectId = appConfig.expo.extra?.eas?.projectId

    console.log('[setProjectOwner] Current owner:', currentOwner)
    console.log('[setProjectOwner] New owner:', owner)
    console.log('[setProjectOwner] Current projectId:', currentProjectId)

    appConfig.expo.owner = owner

    // Only remove projectId when owner actually changes.
    // Keeping the existing projectId avoids unnecessary EAS relink prompts for
    // the same owner during repeated deployments.
    const ownerChanged = Boolean(currentOwner) && currentOwner !== owner
    if (ownerChanged && appConfig.expo.extra?.eas?.projectId) {
      console.log('[setProjectOwner] Removing projectId because owner changed')
      delete appConfig.expo.extra.eas.projectId
      if (Object.keys(appConfig.expo.extra.eas).length === 0) {
        delete appConfig.expo.extra.eas
      }
      if (appConfig.expo.extra && Object.keys(appConfig.expo.extra).length === 0) {
        delete appConfig.expo.extra
      }
    }

    const newContent = JSON.stringify(appConfig, null, 2)
    console.log('[setProjectOwner] Writing app.json with owner:', owner)

    await filesystem.writeFile(appJsonPath, newContent)

    return { success: true }
  } catch (error) {
    console.error('[setProjectOwner] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update app.json',
    }
  }
}
