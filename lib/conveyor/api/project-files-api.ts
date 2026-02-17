/**
 * Project Files API
 *
 * Renderer-side API for project filesystem operations.
 * Uses the new ProjectService architecture with lazy loading
 * and granular file change events.
 */

import { ConveyorApi } from '@/lib/preload/shared'

// Types matching the main process ProjectService
export type ProjectStatus = 'idle' | 'cloning' | 'ready' | 'error'

export interface FileNode {
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
}

export interface FileContent {
  path: string
  content: string
  isBinary: boolean
}

export interface ProjectState {
  projectId: string
  projectPath: string
  status: ProjectStatus
  error?: string
  fileTree: FileNode[]
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
  projectId: string
}

export class ProjectFilesApi extends ConveyorApi {
  /**
   * Open a project - clone if needed, start watching
   */
  open = (projectId: string, remoteUrl: string, appType?: string): Promise<ProjectState> =>
    this.renderer.invoke('project:open', projectId, remoteUrl, appType) as Promise<ProjectState>

  /**
   * Close current project - stop watching
   */
  close = (): Promise<void> =>
    this.renderer.invoke('project:close') as Promise<void>

  /**
   * Get current project state
   */
  getState = (): Promise<ProjectState | null> =>
    this.renderer.invoke('project:getState') as Promise<ProjectState | null>

  /**
   * Read file content (lazy load)
   */
  readFile = (relativePath: string): Promise<FileContent> =>
    this.renderer.invoke('project:readFile', relativePath) as Promise<FileContent>

  /**
   * Write file content
   */
  writeFile = (relativePath: string, content: string): Promise<void> =>
    this.renderer.invoke('project:writeFile', relativePath, content) as Promise<void>

  /**
   * Delete file
   */
  deleteFile = (relativePath: string): Promise<void> =>
    this.renderer.invoke('project:deleteFile', relativePath) as Promise<void>

  /**
   * Create directory
   */
  createDirectory = (relativePath: string): Promise<void> =>
    this.renderer.invoke('project:createDirectory', relativePath) as Promise<void>

  /**
   * Rename/move file or directory
   */
  rename = (oldPath: string, newPath: string): Promise<void> =>
    this.renderer.invoke('project:rename', oldPath, newPath) as Promise<void>

  /**
   * Commit and push to git
   */
  commitAndPush = (message: string): Promise<void> =>
    this.renderer.invoke('project:commitAndPush', message) as Promise<void>

  /**
   * Sync local changes to remote using a fresh authenticated URL
   */
  syncToRemote = (authenticatedUrl: string): Promise<void> =>
    this.renderer.invoke('project:syncToRemote', authenticatedUrl) as Promise<void>

  /**
   * Pull latest from git
   */
  pull = (): Promise<void> =>
    this.renderer.invoke('project:pull') as Promise<void>

  /**
   * Check if there are uncommitted git changes
   */
  hasChanges = (): Promise<boolean> =>
    this.renderer.invoke('project:hasChanges') as Promise<boolean>

  /**
   * Get current project path
   */
  getPath = (): Promise<string | null> =>
    this.renderer.invoke('project:getPath') as Promise<string | null>

  /**
   * Check if project is ready
   */
  isReady = (): Promise<boolean> =>
    this.renderer.invoke('project:isReady') as Promise<boolean>

  /**
   * Rescan file tree (useful when files are added outside of watcher)
   */
  rescanTree = (): Promise<FileNode[]> =>
    this.renderer.invoke('project:rescanTree') as Promise<FileNode[]>

  /**
   * Check if a project exists locally (already cloned)
   * Useful to skip authenticated URL fetch on subsequent loads
   */
  existsLocally = (projectId: string): Promise<boolean> =>
    this.renderer.invoke('project:existsLocally', projectId) as Promise<boolean>

  /**
   * Save an image attachment (base64) and return the file path
   */
  saveAttachment = (filename: string, base64Data: string): Promise<string> =>
    this.renderer.invoke('project:saveAttachment', filename, base64Data) as Promise<string>

  /**
   * Subscribe to file change events
   */
  onFileChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.on<FileChangeEvent>('project:fileChange', callback)
}
