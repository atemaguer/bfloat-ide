/**
 * Apple Session Manager
 *
 * Manages Apple ID session caching using Fastlane's spaceship session storage.
 * Sessions are stored at ~/.app-store/auth/<email>/cookie
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface AppleSessionInfo {
  /** Whether a session exists */
  exists: boolean
  /** Apple ID the session is for (if available) */
  appleId?: string
  /** When the session was last modified */
  lastModified?: Date
  /** Age in days */
  ageInDays?: number
  /** Path to session file */
  sessionPath?: string
}

export interface AppleSessionManagerOptions {
  /** Max age in days before session is considered stale (default: 30) */
  maxAgeDays?: number
}

/**
 * Get the Fastlane spaceship session directory
 * Fastlane stores sessions at ~/.app-store/auth/<email>/cookie
 */
function getAppStoreDir(): string {
  return path.join(os.homedir(), '.app-store', 'auth')
}

/**
 * Get session cookie path for an Apple ID
 */
function getSessionPath(appleId: string): string {
  // Fastlane uses the email as directory name
  return path.join(getAppStoreDir(), appleId, 'cookie')
}

export class AppleSessionManager {
  private readonly maxAgeDays: number

  constructor(options: AppleSessionManagerOptions = {}) {
    this.maxAgeDays = options.maxAgeDays ?? 30
  }

  /**
   * Check if a valid session exists for the given Apple ID
   */
  checkSession(appleId: string): AppleSessionInfo {
    const sessionPath = getSessionPath(appleId)

    try {
      if (!fs.existsSync(sessionPath)) {
        return { exists: false }
      }

      const stats = fs.statSync(sessionPath)
      const lastModified = stats.mtime
      const ageMs = Date.now() - lastModified.getTime()
      const ageInDays = ageMs / (1000 * 60 * 60 * 24)

      return {
        exists: true,
        appleId,
        lastModified,
        ageInDays: Math.floor(ageInDays),
        sessionPath,
      }
    } catch {
      return { exists: false }
    }
  }

  /**
   * Check if there are any sessions in the app-store auth directory
   */
  hasAnySessions(): boolean {
    const appStoreDir = getAppStoreDir()

    try {
      if (!fs.existsSync(appStoreDir)) {
        return false
      }

      // Each Apple ID has its own directory containing a cookie file
      const entries = fs.readdirSync(appStoreDir, { withFileTypes: true })
      return entries.some((entry) => entry.isDirectory())
    } catch {
      return false
    }
  }

  /**
   * List all available sessions
   */
  listSessions(): AppleSessionInfo[] {
    const appStoreDir = getAppStoreDir()
    const sessions: AppleSessionInfo[] = []

    try {
      if (!fs.existsSync(appStoreDir)) {
        return []
      }

      // Each Apple ID has its own directory
      const entries = fs.readdirSync(appStoreDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const appleId = entry.name
        const cookiePath = path.join(appStoreDir, appleId, 'cookie')

        try {
          const stats = fs.statSync(cookiePath)
          if (stats.isFile() || stats.isSymbolicLink()) {
            const lastModified = stats.mtime
            const ageMs = Date.now() - lastModified.getTime()
            const ageInDays = ageMs / (1000 * 60 * 60 * 24)

            sessions.push({
              exists: true,
              appleId,
              lastModified,
              ageInDays: Math.floor(ageInDays),
              sessionPath: cookiePath,
            })
          }
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // Return empty if directory unreadable
    }

    return sessions.sort((a, b) => (a.ageInDays || 0) - (b.ageInDays || 0))
  }

  /**
   * Check if a session is still valid (not too old)
   */
  isSessionValid(session: AppleSessionInfo): boolean {
    if (!session.exists || session.ageInDays === undefined) {
      return false
    }
    return session.ageInDays < this.maxAgeDays
  }

  /**
   * Get a human-readable age string
   */
  getAgeString(session: AppleSessionInfo): string {
    if (!session.exists || session.ageInDays === undefined) {
      return 'No session'
    }

    const days = session.ageInDays
    if (days === 0) {
      return 'Today'
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return `${days} days ago`
    } else if (days < 30) {
      const weeks = Math.floor(days / 7)
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`
    } else {
      const months = Math.floor(days / 30)
      return `${months} month${months > 1 ? 's' : ''} ago`
    }
  }

  /**
   * Clear session for a specific Apple ID
   */
  clearSession(appleId: string): boolean {
    const sessionPath = getSessionPath(appleId)

    try {
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath)
        // Also try to remove the directory if it's empty
        const appleIdDir = path.dirname(sessionPath)
        try {
          fs.rmdirSync(appleIdDir)
        } catch {
          // Directory not empty or doesn't exist, that's fine
        }
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): number {
    const appStoreDir = getAppStoreDir()
    let cleared = 0

    try {
      if (!fs.existsSync(appStoreDir)) {
        return 0
      }

      const entries = fs.readdirSync(appStoreDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const appleIdDir = path.join(appStoreDir, entry.name)
        try {
          // Remove the entire directory (cookie file + any contents)
          fs.rmSync(appleIdDir, { recursive: true, force: true })
          cleared++
        } catch {
          // Skip directories we can't delete
        }
      }
    } catch {
      // Ignore errors
    }

    return cleared
  }

  /**
   * Get session status message for UI
   */
  getSessionStatusMessage(appleId: string): string {
    const session = this.checkSession(appleId)

    if (!session.exists) {
      return 'No saved session - 2FA will be required'
    }

    if (!this.isSessionValid(session)) {
      return `Session expired (${this.getAgeString(session)}) - 2FA may be required`
    }

    return `Last authenticated ${this.getAgeString(session)}`
  }
}
