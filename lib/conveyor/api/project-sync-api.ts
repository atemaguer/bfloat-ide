/**
 * Project Sync API
 *
 * Renderer-side API for project file synchronization.
 * Handles git operations, file watching, and project path management.
 */

import { ConveyorApi } from '@/lib/preload/shared'
import type { FileChange, ProjectFile, FileChangeEvent } from '@/lib/conveyor/schemas/agent-schema'

export interface ProjectSyncFileChangeEventData {
  projectId: string
  type: FileChangeEvent['type']
  path: string
  relativePath: string
}

export interface ProjectSyncErrorEventData {
  projectId: string
  error: string
}

export class ProjectSyncApi extends ConveyorApi {
  /**
   * Start project sync for a project
   * Clones/pulls repo and starts file watching
   * For new projects (no remoteUrl), initializes from template based on appType
   */
  start = (config: { projectId: string; remoteUrl: string; appType?: string }) => this.invoke('agent-start', config)

  /**
   * Stop project sync for a project
   */
  stop = (projectId: string) => this.invoke('agent-stop', projectId)

  /**
   * Execute file changes
   * Writes/deletes files, auto-commits to git
   */
  execute = (projectId: string, changes: FileChange[], commitMessage?: string) =>
    this.invoke('agent-execute', projectId, changes, commitMessage)

  /**
   * Commit and push changes with optional version tag
   */
  commit = (projectId: string, options: { message: string; messageId?: string }) =>
    this.invoke('agent-commit', projectId, options)

  /**
   * Get all files for a project
   */
  getFiles = (projectId: string) => this.invoke('agent-get-files', projectId)

  /**
   * Read a single file
   */
  readFile = (projectId: string, filePath: string) =>
    this.invoke('agent-read-file', projectId, filePath)

  /**
   * Pull latest changes from remote
   */
  pull = (projectId: string) => this.invoke('agent-pull', projectId)

  /**
   * Get sync status for a project
   */
  status = (projectId: string) => this.invoke('agent-status', projectId)

  /**
   * Get the project path for a running sync
   */
  getProjectPath = (projectId: string) => this.invoke('agent-get-project-path', projectId)

  /**
   * Subscribe to file change events
   * These are triggered when files change on disk
   */
  onFileChange = (callback: (data: ProjectSyncFileChangeEventData) => void) =>
    this.on<ProjectSyncFileChangeEventData>('agent-file-changed', callback)

  /**
   * Subscribe to sync error events
   */
  onError = (callback: (data: ProjectSyncErrorEventData) => void) =>
    this.on<ProjectSyncErrorEventData>('agent-error', callback)
}

// Re-export types for convenience
export type { FileChange, ProjectFile, FileChangeEvent }
