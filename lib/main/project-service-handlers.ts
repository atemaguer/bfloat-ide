/**
 * ProjectService IPC Handlers
 *
 * Exposes ProjectService methods to renderer via IPC.
 * All file operations go through these handlers.
 */

import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { handle } from './shared'
import { projectService, type FileNode, type ProjectState, type FileContent } from './project-service'

/**
 * Set up the main window for sending events
 */
export function setProjectServiceWindow(window: BrowserWindow): void {
  projectService.setMainWindow(window)
}

/**
 * Register all ProjectService IPC handlers
 */
export function registerProjectServiceHandlers(): void {
  // Open a project (clone/pull + start watching)
  handle('project:open', async (projectId: string, remoteUrl: string, appType?: string): Promise<ProjectState> => {
    return projectService.open(projectId, remoteUrl, appType)
  })

  // Close current project (stop watching)
  handle('project:close', async (): Promise<void> => {
    return projectService.close()
  })

  // Get current project state
  handle('project:getState', async (): Promise<ProjectState | null> => {
    return projectService.getState()
  })

  // Read file content (lazy load)
  handle('project:readFile', async (relativePath: string): Promise<FileContent> => {
    return projectService.readFile(relativePath)
  })

  // Write file content
  handle('project:writeFile', async (relativePath: string, content: string): Promise<void> => {
    return projectService.writeFile(relativePath, content)
  })

  // Delete file
  handle('project:deleteFile', async (relativePath: string): Promise<void> => {
    return projectService.deleteFile(relativePath)
  })

  // Create directory
  handle('project:createDirectory', async (relativePath: string): Promise<void> => {
    return projectService.createDirectory(relativePath)
  })

  // Rename/move file or directory
  handle('project:rename', async (oldPath: string, newPath: string): Promise<void> => {
    return projectService.rename(oldPath, newPath)
  })

  // Git: commit and push
  handle('project:commitAndPush', async (message: string): Promise<void> => {
    return projectService.commitAndPush(message)
  })

  // Git: sync to remote with fresh authenticated URL
  handle('project:syncToRemote', async (authenticatedUrl: string): Promise<void> => {
    return projectService.syncToRemote(authenticatedUrl)
  })

  // Git: pull latest
  handle('project:pull', async (): Promise<void> => {
    return projectService.pull()
  })

  // Git: check for changes
  handle('project:hasChanges', async (): Promise<boolean> => {
    return projectService.hasChanges()
  })

  // Get current project path
  handle('project:getPath', async (): Promise<string | null> => {
    return projectService.getProjectPath()
  })

  // Check if project is ready
  handle('project:isReady', async (): Promise<boolean> => {
    return projectService.isReady()
  })

  // Rescan file tree (useful when files are added outside of watcher)
  handle('project:rescanTree', async (): Promise<FileNode[]> => {
    return projectService.rescanTree()
  })

  // Check if a project exists locally (already cloned)
  handle('project:existsLocally', async (projectId: string): Promise<boolean> => {
    const projectPath = path.join(os.homedir(), '.bfloat-ide', 'projects', projectId)
    return fs.existsSync(projectPath)
  })

  // Save image attachment - returns the file path
  handle('project:saveAttachment', async (filename: string, base64Data: string): Promise<string> => {
    console.log('[DEBUG-IMG] saveAttachment called with filename:', filename, 'data length:', base64Data.length)

    const projectPath = projectService.getProjectPath()
    if (!projectPath) {
      console.error('[DEBUG-IMG] No project open')
      throw new Error('No project open')
    }
    console.log('[DEBUG-IMG] Project path:', projectPath)

    // Create .bfloat-ide/temp directory for attachments
    const tempDir = path.join(projectPath, '.bfloat-ide', 'temp', 'attachments')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
      console.log('[DEBUG-IMG] Created temp directory:', tempDir)
    }

    // Extract the base64 data (remove data URL prefix if present)
    const base64Content = base64Data.includes(',')
      ? base64Data.split(',')[1]
      : base64Data

    console.log('[DEBUG-IMG] Extracted base64 content length:', base64Content.length)

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Content, 'base64')
    console.log('[DEBUG-IMG] Converted to buffer, size:', buffer.length, 'bytes')

    // Write the file
    const filePath = path.join(tempDir, filename)
    fs.writeFileSync(filePath, buffer)

    console.log('[DEBUG-IMG] Saved attachment:', filePath)
    return filePath
  })

  console.log('[ProjectServiceHandlers] Registered all handlers')
}

/**
 * Cleanup on app quit
 */
export async function cleanupProjectService(): Promise<void> {
  console.log('[ProjectServiceHandlers] Cleaning up')
  await projectService.close()
}
