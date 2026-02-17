/**
 * Project Sync
 *
 * Handles synchronization of project files with git repositories.
 * - Clones/pulls from Gitea
 * - Watches for file changes
 * - Commits and pushes changes
 */

import chokidar, { type FSWatcher } from 'chokidar'
import { type Dirent } from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { createGitOps, type FileChange, type GitOps } from './index'
import { initializeFromTemplate } from '@/lib/conveyor/handlers/template-handler'

export interface ProjectSyncOptions {
  projectId: string
  projectPath: string
  remoteUrl: string
  appType?: string
  onFileChange?: (event: FileChangeEvent) => void
  onError?: (error: Error) => void
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
  relativePath: string
}

export interface ProjectFile {
  path: string
  content: string
  isBinary: boolean
}

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules'])

const IGNORED_FILES = new Set(['.DS_Store'])

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
])

const isBinaryPath = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

const isIgnoredRelativePath = (relativePath: string): boolean => {
  if (!relativePath || relativePath === '.') return false
  const parts = relativePath.split(path.sep).filter(Boolean)
  if (parts.length === 0) return false

  const lastPart = parts[parts.length - 1]
  if (IGNORED_FILES.has(lastPart)) return true

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (IGNORED_DIRECTORIES.has(part)) return true
    if (part.startsWith('.') && part.length > 1 && i < parts.length - 1) {
      return true
    }
  }

  return false
}

const shouldSkipDirectory = (dirName: string): boolean => {
  if (IGNORED_DIRECTORIES.has(dirName)) return true
  return dirName.startsWith('.') && dirName.length > 1
}

const listFilesOnDisk = async (projectPath: string): Promise<string[]> => {
  const files: string[] = []

  const walk = async (dirPath: string) => {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch (error) {
      console.warn(`[ProjectSync] Failed to read directory ${dirPath}:`, error)
      return
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue

      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue
        await walk(fullPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (IGNORED_FILES.has(entry.name)) continue

      const relativePath = path.relative(projectPath, fullPath)
      if (isIgnoredRelativePath(relativePath)) continue

      files.push(relativePath.split(path.sep).join('/'))
    }
  }

  await walk(projectPath)
  return files
}

export class ProjectSync {
  #git: GitOps
  #watcher: FSWatcher | null = null
  #options: ProjectSyncOptions
  #isStarted = false

  constructor(options: ProjectSyncOptions) {
    this.#options = options
    this.#git = createGitOps(options.projectPath, options.remoteUrl)
  }

  get projectPath(): string {
    return this.#options.projectPath
  }

  get projectId(): string {
    return this.#options.projectId
  }

  get isStarted(): boolean {
    return this.#isStarted
  }

  /**
   * Start project sync:
   * 1. Clone if not already cloned, or initialize from template if no remote URL
   * 2. Start watching for file changes
   */
  async start(): Promise<void> {
    if (this.#isStarted) {
      console.log(`[ProjectSync] Already started for ${this.#options.projectId}`)
      return
    }

    console.log(`[ProjectSync] Starting for project ${this.#options.projectId}`)

    // Only clone/initialize if project doesn't exist - never pull on reload
    const isCloned = await this.#git.isCloned()
    if (!isCloned) {
      if (this.#options.remoteUrl) {
        console.log(`[ProjectSync] Cloning repository...`)
        await this.#git.clone()
      } else {
        // No remote URL - initialize from template
        console.log(`[ProjectSync] Initializing from template...`)
        const appType = this.#options.appType || 'web'
        const result = await initializeFromTemplate(this.#options.projectPath, appType)
        if (!result.success) {
          throw new Error(
            `[ProjectSync] Template initialization failed: ${result.error ?? 'unknown error'}`
          )
        }
        console.log(`[ProjectSync] Template initialized, creating initial git commit...`)
        await this.#git.initRepo('Initial commit from template')
      }
    } else {
      // Project exists - use existing files, skip all git operations
      console.log(`[ProjectSync] Project already exists, using existing files (no git pull)`)
    }

    // Start watching for changes
    this.#startWatcher()
    this.#isStarted = true

    console.log(`[ProjectSync] Started successfully`)
  }

  /**
   * Stop project sync and cleanup
   */
  async stop(): Promise<void> {
    if (!this.#isStarted) {
      return
    }

    console.log(`[ProjectSync] Stopping for project ${this.#options.projectId}`)

    if (this.#watcher) {
      await this.#watcher.close()
      this.#watcher = null
    }

    this.#isStarted = false
    console.log(`[ProjectSync] Stopped`)
  }

  /**
   * Execute file changes and sync to git
   */
  async executeChanges(changes: FileChange[], commitMessage?: string): Promise<void> {
    console.log(`[ProjectSync] Executing ${changes.length} changes`)

    for (const change of changes) {
      if (change.type === 'delete') {
        await this.#git.deleteFile(change.path)
      } else if (change.content !== undefined) {
        await this.#git.writeFile(change.path, change.content)
      }
    }

    // Auto-commit and push changes to Gitea
    if (changes.length > 0) {
      const message = commitMessage || `Updated ${changes.length} file(s)`
      console.log(`[ProjectSync] Auto-committing: ${message}`)
      try {
        await this.#git.commitAndPush(message)
        console.log(`[ProjectSync] Changes synced to remote`)
      } catch (error) {
        console.error(`[ProjectSync] Failed to sync:`, error)
        // Don't throw - local changes are still applied, just not synced
      }
    }
  }

  /**
   * Commit and push current changes with optional version tag
   */
  async commitAndSync(message: string, messageId?: string): Promise<void> {
    await this.#git.commitAndPush(message)

    if (messageId) {
      await this.#git.tag(`msg-${messageId}`)
    }
  }

  /**
   * Get all files in the project
   */
  async getFiles(): Promise<ProjectFile[]> {
    const filePaths = await listFilesOnDisk(this.#options.projectPath)
    const files: ProjectFile[] = []

    for (const filePath of filePaths) {
      try {
        if (isBinaryPath(filePath)) {
          const buffer = await this.#git.readBinaryFile(filePath)
          files.push({
            path: filePath,
            content: buffer.toString('base64'),
            isBinary: true,
          })
          continue
        }

        const content = await this.#git.readFile(filePath)
        files.push({
          path: filePath,
          content,
          isBinary: false,
        })
      } catch (error) {
        console.warn(`[ProjectSync] Could not read file ${filePath}:`, error)
      }
    }

    return files
  }

  /**
   * Read a single file
   */
  async readFile(filePath: string): Promise<string> {
    return this.#git.readFile(filePath)
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    return this.#git.hasChanges()
  }

  /**
   * Pull latest changes from remote
   */
  async pull(): Promise<void> {
    await this.#git.pull()
  }

  #startWatcher(): void {
    const { projectPath, onFileChange, onError } = this.#options

    this.#watcher = chokidar.watch(projectPath, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(projectPath, filePath)
        if (!relativePath || relativePath.startsWith('..')) return false
        return isIgnoredRelativePath(relativePath)
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    })

    this.#watcher.on('all', (event, filePath) => {
      const relativePath = path.relative(projectPath, filePath)

      if (isIgnoredRelativePath(relativePath)) {
        return
      }

      console.log(`[ProjectSync] File ${event}: ${relativePath}`)

      if (onFileChange) {
        onFileChange({
          type: event as FileChangeEvent['type'],
          path: filePath,
          relativePath,
        })
      }
    })

    this.#watcher.on('error', (error) => {
      console.error(`[ProjectSync] Watcher error:`, error)
      if (onError) {
        onError(error)
      }
    })

    console.log(`[ProjectSync] Watching for changes in ${projectPath}`)
  }
}

// ProjectSync registry to manage multiple project sync instances
const projectSyncs = new Map<string, ProjectSync>()

export function getProjectSync(projectId: string): ProjectSync | undefined {
  return projectSyncs.get(projectId)
}

export function registerProjectSync(sync: ProjectSync): void {
  projectSyncs.set(sync.projectId, sync)
}

export function unregisterProjectSync(projectId: string): void {
  projectSyncs.delete(projectId)
}

export function getAllProjectSyncs(): ProjectSync[] {
  return Array.from(projectSyncs.values())
}

export async function stopAllProjectSyncs(): Promise<void> {
  const allSyncs = getAllProjectSyncs()
  await Promise.all(allSyncs.map((sync) => sync.stop()))
  projectSyncs.clear()
}
