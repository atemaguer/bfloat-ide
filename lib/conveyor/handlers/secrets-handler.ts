import { handle } from '@/lib/main/shared'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import * as os from 'os'

// Base directory for all projects (same as project-service.ts)
const PROJECTS_DIR = path.join(os.homedir(), '.bfloat-ide', 'projects')

export interface Secret {
  key: string
  value: string
}

export interface SecretsReadResult {
  secrets: Secret[]
  error?: string
}

export interface SecretOperationResult {
  success: boolean
  error?: string
}

/**
 * Parse .env file content into key-value pairs
 * Preserves the original structure for later reconstruction
 */
function parseEnvFile(content: string): { secrets: Secret[]; lines: string[] } {
  const secrets: Secret[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Parse KEY=value format
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex > 0) {
      const key = trimmed.substring(0, equalsIndex).trim()
      let value = trimmed.substring(equalsIndex + 1).trim()

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      secrets.push({ key, value })
    }
  }

  return { secrets, lines }
}

/**
 * Reconstruct .env file content, updating or adding a secret
 * Preserves comments and empty lines
 */
function updateEnvContent(content: string, key: string, value: string): string {
  const lines = content.split('\n')
  let found = false
  const needsQuotes = value.includes(' ') || value.includes('#') || value.includes('"') || value.includes("'")
  const formattedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value

  const updatedLines = lines.map(line => {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      return line
    }

    // Check if this line has our key
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex > 0) {
      const lineKey = trimmed.substring(0, equalsIndex).trim()
      if (lineKey === key) {
        found = true
        return `${key}=${formattedValue}`
      }
    }

    return line
  })

  // If key wasn't found, add it at the end
  if (!found) {
    // Add a newline before if the last line isn't empty
    if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1].trim() !== '') {
      updatedLines.push(`${key}=${formattedValue}`)
    } else if (updatedLines.length === 0) {
      updatedLines.push(`${key}=${formattedValue}`)
    } else {
      // Replace the last empty line with our new key
      updatedLines[updatedLines.length - 1] = `${key}=${formattedValue}`
      updatedLines.push('') // Add trailing newline
    }
  }

  return updatedLines.join('\n')
}

/**
 * Remove a secret from .env content
 * Preserves comments and structure
 */
function removeFromEnvContent(content: string, key: string): string {
  const lines = content.split('\n')

  const filteredLines = lines.filter(line => {
    const trimmed = line.trim()

    // Keep empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      return true
    }

    // Check if this line has our key
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex > 0) {
      const lineKey = trimmed.substring(0, equalsIndex).trim()
      return lineKey !== key
    }

    return true
  })

  return filteredLines.join('\n')
}

/**
 * Get the .env.local file path for a project
 * We use .env.local (instead of .env) so that frameworks like Next.js and Expo
 * automatically pick it up and so it's gitignored by default.
 */
function getEnvPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, '.env.local')
}

export const registerSecretsHandlers = () => {
  /**
   * Read all secrets from the project's .env.local file
   * Falls back to .env for backwards compatibility with existing projects,
   * and migrates to .env.local on first write.
   */
  handle('secrets:read', async ({ projectId }: { projectId: string }): Promise<SecretsReadResult> => {
    try {
      const envLocalPath = getEnvPath(projectId)
      const legacyEnvPath = path.join(PROJECTS_DIR, projectId, '.env')

      // Prefer .env.local, fall back to legacy .env
      let envPath = envLocalPath
      if (!existsSync(envLocalPath) && existsSync(legacyEnvPath)) {
        envPath = legacyEnvPath
      }

      if (!existsSync(envPath)) {
        return { secrets: [] }
      }

      const content = await fs.readFile(envPath, 'utf-8')
      const { secrets } = parseEnvFile(content)

      return { secrets }
    } catch (error) {
      console.error('[SecretsHandler] Error reading secrets:', error)
      return {
        secrets: [],
        error: error instanceof Error ? error.message : 'Failed to read secrets'
      }
    }
  })

  /**
   * Set (add or update) a secret in the project's .env.local file
   * Migrates from legacy .env if .env.local doesn't exist yet.
   */
  handle('secrets:set', async ({ projectId, key, value }: { projectId: string; key: string; value: string }): Promise<SecretOperationResult> => {
    try {
      const envLocalPath = getEnvPath(projectId)
      const legacyEnvPath = path.join(PROJECTS_DIR, projectId, '.env')
      let content = ''

      if (existsSync(envLocalPath)) {
        content = await fs.readFile(envLocalPath, 'utf-8')
      } else if (existsSync(legacyEnvPath)) {
        // Migrate: read from legacy .env, will write to .env.local
        content = await fs.readFile(legacyEnvPath, 'utf-8')
      }

      const updatedContent = updateEnvContent(content, key, value)
      await fs.writeFile(envLocalPath, updatedContent, 'utf-8')

      console.log(`[SecretsHandler] Set secret: ${key}`)
      return { success: true }
    } catch (error) {
      console.error('[SecretsHandler] Error setting secret:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set secret'
      }
    }
  })

  /**
   * Delete a secret from the project's .env.local file
   * Also checks the legacy .env for backwards compatibility.
   */
  handle('secrets:delete', async ({ projectId, key }: { projectId: string; key: string }): Promise<SecretOperationResult> => {
    try {
      const envLocalPath = getEnvPath(projectId)
      const legacyEnvPath = path.join(PROJECTS_DIR, projectId, '.env')

      // Prefer .env.local, fall back to legacy .env
      let envPath = envLocalPath
      if (!existsSync(envLocalPath) && existsSync(legacyEnvPath)) {
        envPath = legacyEnvPath
      }

      if (!existsSync(envPath)) {
        return { success: true } // Nothing to delete
      }

      const content = await fs.readFile(envPath, 'utf-8')
      const updatedContent = removeFromEnvContent(content, key)
      await fs.writeFile(envPath, updatedContent, 'utf-8')

      console.log(`[SecretsHandler] Deleted secret: ${key}`)
      return { success: true }
    } catch (error) {
      console.error('[SecretsHandler] Error deleting secret:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete secret'
      }
    }
  })
}
