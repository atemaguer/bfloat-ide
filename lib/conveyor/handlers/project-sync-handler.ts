/**
 * Project Sync Handler
 *
 * IPC handlers for project file synchronization with git.
 * Manages cloning, watching, and syncing project files.
 */

import * as os from 'os'
import * as path from 'path'
import { BrowserWindow } from 'electron'
import { handle } from '@/lib/main/shared'
import {
  ProjectSync,
  getProjectSync,
  registerProjectSync,
  unregisterProjectSync,
  stopAllProjectSyncs,
  type FileChange,
} from '@/lib/main/git-ops/project-sync'

let mainWindow: BrowserWindow | null = null

// Get the .bfloat-ide/projects directory path
const getProjectsBasePath = (): string => {
  return path.join(os.homedir(), '.bfloat-ide', 'projects')
}

export const setProjectSyncMainWindow = (window: BrowserWindow): void => {
  mainWindow = window
}

export const registerProjectSyncHandlers = () => {
  // Start project sync for a project
  handle(
    'agent-start',
    async (config: {
      projectId: string
      remoteUrl: string
      appType?: string
    }): Promise<{ success: boolean; projectPath?: string; error?: string }> => {
      try {
        const { projectId, remoteUrl, appType } = config

        // Check if sync already exists
        let sync = getProjectSync(projectId)
        if (sync?.isStarted) {
          return { success: true, projectPath: sync.projectPath }
        }

        // Create project path
        const projectPath = path.join(getProjectsBasePath(), projectId)

        // Create new project sync
        sync = new ProjectSync({
          projectId,
          projectPath,
          remoteUrl,
          appType,
          onFileChange: (event) => {
            // Send file change event to renderer
            if (mainWindow) {
              mainWindow.webContents.send('agent-file-changed', {
                projectId,
                ...event,
              })
            }
          },
          onError: (error) => {
            console.error(`[ProjectSyncHandler] Error in project ${projectId}:`, error)
            if (mainWindow) {
              mainWindow.webContents.send('agent-error', {
                projectId,
                error: error.message,
              })
            }
          },
        })

        await sync.start()
        registerProjectSync(sync)

        console.log(`[ProjectSyncHandler] Sync started for project ${projectId}`)
        return { success: true, projectPath }
      } catch (error) {
        console.error(`[ProjectSyncHandler] Failed to start sync:`, error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Stop project sync for a project
  handle('agent-stop', async (projectId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const sync = getProjectSync(projectId)
      if (sync) {
        await sync.stop()
        unregisterProjectSync(projectId)
        console.log(`[ProjectSyncHandler] Sync stopped for project ${projectId}`)
      }
      return { success: true }
    } catch (error) {
      console.error(`[ProjectSyncHandler] Failed to stop sync:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Execute file changes
  handle(
    'agent-execute',
    async (
      projectId: string,
      changes: FileChange[],
      commitMessage?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const sync = getProjectSync(projectId)
        if (!sync) {
          return { success: false, error: `No sync running for project ${projectId}` }
        }

        await sync.executeChanges(changes, commitMessage)
        return { success: true }
      } catch (error) {
        console.error(`[ProjectSyncHandler] Failed to execute changes:`, error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Commit and push changes
  handle(
    'agent-commit',
    async (
      projectId: string,
      options: { message: string; messageId?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const sync = getProjectSync(projectId)
        if (!sync) {
          return { success: false, error: `No sync running for project ${projectId}` }
        }

        await sync.commitAndSync(options.message, options.messageId)
        return { success: true }
      } catch (error) {
        console.error(`[ProjectSyncHandler] Failed to commit:`, error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Get all files for a project
  handle('agent-get-files', async (projectId: string) => {
    try {
      const sync = getProjectSync(projectId)
      if (!sync) {
        return { success: false, error: `No sync running for project ${projectId}` }
      }

      const files = await sync.getFiles()
      return { success: true, files }
    } catch (error) {
      console.error(`[ProjectSyncHandler] Failed to get files:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Read a single file
  handle('agent-read-file', async (projectId: string, filePath: string) => {
    try {
      const sync = getProjectSync(projectId)
      if (!sync) {
        return { success: false, error: `No sync running for project ${projectId}` }
      }

      const content = await sync.readFile(filePath)
      return { success: true, content }
    } catch (error) {
      console.error(`[ProjectSyncHandler] Failed to read file:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Pull latest changes
  handle('agent-pull', async (projectId: string) => {
    try {
      const sync = getProjectSync(projectId)
      if (!sync) {
        return { success: false, error: `No sync running for project ${projectId}` }
      }

      await sync.pull()
      return { success: true }
    } catch (error) {
      console.error(`[ProjectSyncHandler] Failed to pull:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Check sync status
  handle('agent-status', async (projectId: string) => {
    const sync = getProjectSync(projectId)
    if (!sync) {
      return { isRunning: false }
    }

    let hasUncommittedChanges = false
    try {
      hasUncommittedChanges = await sync.hasUncommittedChanges()
    } catch {
      // Ignore errors
    }

    return {
      isRunning: sync.isStarted,
      projectPath: sync.projectPath,
      hasUncommittedChanges,
    }
  })

  // Get project path for running sync
  handle('agent-get-project-path', (projectId: string) => {
    const sync = getProjectSync(projectId)
    return sync?.projectPath ?? null
  })
}

// Cleanup function to be called on app quit
export const cleanupAllProjectSyncs = async () => {
  console.log(`[ProjectSyncHandler] Cleaning up all syncs`)
  await stopAllProjectSyncs()
}
