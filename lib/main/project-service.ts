/**
 * ProjectService - Main Process
 *
 * Single source of truth for project filesystem operations.
 * Owns the file watcher, handles all I/O, manages git operations.
 * Emits granular events to renderer - no full refreshes needed.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { exec, type ExecOptions } from 'child_process'
import { promisify } from 'util'
import { ensureSkillsInjected } from '../agents/skills-injector'
import { getShellPaths, isBundledShellAvailable } from '../platform/shell'

const execAsync = promisify(exec)

/**
 * Get the git executable path
 * Uses bundled MinGit on Windows if available, otherwise falls back to system git
 */
function getGitPath(): string {
  if (process.platform === 'win32' && isBundledShellAvailable()) {
    const shellPaths = getShellPaths()
    if (existsSync(shellPaths.git)) {
      console.log('[ProjectService] Using bundled MinGit:', shellPaths.git)
      return shellPaths.git
    }
  }
  return 'git'
}

/**
 * Execute a git command with proper path handling
 */
async function execGit(args: string, options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
  const gitPath = getGitPath()
  // Quote the git path in case it contains spaces
  const cmd = gitPath === 'git' ? `git ${args}` : `"${gitPath}" ${args}`

  // On Windows with bundled git, disable credential helper to avoid GCM prompts
  const execOptions: ExecOptions = {
    ...options,
    env: {
      ...process.env,
      ...options?.env,
      // Disable credential helper to prevent GCM prompts - we embed tokens in URLs
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    }
  }

  return execAsync(cmd, execOptions)
}

// Base directory for all projects
const PROJECTS_DIR = path.join(os.homedir(), '.bfloat-ide', 'projects')

// Get git access token from environment (for authenticated git operations)
const GIT_ACCESS_TOKEN = process.env.GIT_ACCESS_TOKEN || ''

/**
 * Add authentication token to git URL if needed
 * For HTTPS URLs, embeds the token. For SSH URLs, returns as-is.
 */
function addAuthToken(url: string): string {
  if (!GIT_ACCESS_TOKEN) {
    console.log('[ProjectService] No GIT_ACCESS_TOKEN found, using URL as-is')
    return url
  }

  try {
    const urlObj = new URL(url)
    // Only modify HTTPS URLs
    if (urlObj.protocol === 'https:') {
      const authUrl = `${urlObj.protocol}//${GIT_ACCESS_TOKEN}@${urlObj.host}${urlObj.pathname}`
      console.log(`[ProjectService] Using authenticated git URL (token: ${GIT_ACCESS_TOKEN.slice(0, 8)}...)`)
      return authUrl
    }
  } catch {
    // URL parsing failed, return as-is
  }

  return url
}

// File extensions to treat as binary
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wav',
  '.zip', '.tar', '.gz', '.pdf'
])

// Directories to ignore
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.expo', '.next', 'dist', 'build'])

// Files to ignore
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db'])

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

type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FileChangeEvent {
  type: FileChangeType
  path: string // relative path
  projectId: string
}

/**
 * ProjectService manages a single project's filesystem
 */
export class ProjectService {
  private projectId: string | null = null
  private projectPath: string | null = null
  private remoteUrl: string | null = null
  private watcher: FSWatcher | null = null
  private status: ProjectStatus = 'idle'
  private mainWindow: BrowserWindow | null = null

  /**
   * Set the main window for sending events
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Get current project state
   */
  getState(): ProjectState | null {
    if (!this.projectId || !this.projectPath) {
      return null
    }
    return {
      projectId: this.projectId,
      projectPath: this.projectPath,
      status: this.status,
      fileTree: []
    }
  }

  /**
   * Open a project - clone if needed, start watching
   */
  async open(projectId: string, remoteUrl: string, appType?: string): Promise<ProjectState> {
    const startTime = Date.now()
    console.log(`[ProjectService] ========== OPEN PROJECT ==========`)
    console.log(`[ProjectService] projectId: ${projectId}`)
    console.log(`[ProjectService] remoteUrl: "${remoteUrl}" (${typeof remoteUrl}, truthy: ${!!remoteUrl}, trim truthy: ${!!(remoteUrl && remoteUrl.trim())})`)
    console.log(`[ProjectService] appType: ${appType}`)
    console.log(`[ProjectService] Opening project: ${projectId}${appType ? ` (appType: ${appType})` : ''}`)

    // Close any existing project first
    await this.close()

    this.projectId = projectId
    this.projectPath = path.join(PROJECTS_DIR, projectId)
    this.remoteUrl = remoteUrl
    this.status = 'cloning'

    try {
      // Ensure projects directory exists
      await fs.mkdir(PROJECTS_DIR, { recursive: true })

      // Check if project directory already exists on disk
      const projectExists = existsSync(this.projectPath)
      console.log(`[ProjectService] Project path: ${this.projectPath}`)
      console.log(`[ProjectService] Project exists on disk: ${projectExists}`)

      if (projectExists) {
        // Project directory exists - just use existing files, NO git operations
        // This preserves all local changes made by the agent
        console.log(`[ProjectService] USING EXISTING FILES - no git clone or pull`)
      } else if (remoteUrl && remoteUrl.trim() !== '') {
        console.log(`[ProjectService] remoteUrl is set: "${remoteUrl}" - will clone`)
        // Project doesn't exist but has remote URL - clone it
        // The remoteUrl should already have authentication token embedded from backend
        const authenticatedUrl = addAuthToken(remoteUrl)
        const cloneStart = Date.now()

        // Log URL info for debugging (without exposing token)
        try {
          const urlObj = new URL(authenticatedUrl)
          const hasCredentials = !!urlObj.username || !!urlObj.password
          console.log(`[ProjectService] Cloning - host: ${urlObj.host}, hasCredentials: ${hasCredentials}`)
          if (urlObj.username) {
            console.log(`[ProjectService] URL username: ${urlObj.username.substring(0, 10)}...`)
          }
        } catch {
          console.log(`[ProjectService] Could not parse URL for logging`)
        }

        console.log(`[ProjectService] Project does NOT exist - cloning...`)
        await execGit(`clone "${authenticatedUrl}" "${this.projectPath}"`)
        console.log(`[ProjectService] Clone took ${Date.now() - cloneStart}ms`)
        // Set the remote URL with auth for subsequent operations
        await execGit(`-C "${this.projectPath}" remote set-url origin "${authenticatedUrl}"`)
        console.log(`[ProjectService] Clone + remote set complete`)
      } else {
        // No remote URL - initialize from template (new project created from prompt)
        console.log(`[ProjectService] No remote URL detected - will initialize from template`)
        console.log(`[ProjectService] remoteUrl value: "${remoteUrl}" (type: ${typeof remoteUrl})`)
        console.log(`[ProjectService] appType value: "${appType || 'web'}"`)
        const { initializeFromTemplate } = await import('@/lib/conveyor/handlers/template-handler')
        const templateResult = await initializeFromTemplate(this.projectPath, appType || 'web')
        if (!templateResult.success) {
          console.error(`[ProjectService] Template initialization FAILED:`, templateResult.error)
          throw new Error(`Template initialization failed: ${templateResult.error}`)
        }
        console.log(`[ProjectService] Template initialized successfully`)
        // Note: No git initialization for local projects - git is only used for imported repos
      }

      // Inject AI skills (bundled with app, gitignored in project)
      const skillsStart = Date.now()
      await ensureSkillsInjected(this.projectPath)
      console.log(`[ProjectService] Skills injection took ${Date.now() - skillsStart}ms`)

      // Scan file tree
      const scanStart = Date.now()
      const fileTree = await this.scanTree()
      console.log(`[ProjectService] Tree scan took ${Date.now() - scanStart}ms, found ${fileTree.length} files`)

      // Start watching
      this.startWatcher()

      this.status = 'ready'
      console.log(`[ProjectService] Project ready in ${Date.now() - startTime}ms total: ${this.projectPath}`)

      return {
        projectId: this.projectId,
        projectPath: this.projectPath,
        status: this.status,
        fileTree
      }
    } catch (error) {
      console.error(`[ProjectService] Failed to open project:`, error)
      this.status = 'error'
      return {
        projectId: this.projectId,
        projectPath: this.projectPath || '',
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        fileTree: []
      }
    }
  }

  /**
   * Close the current project - stop watching, clean up
   * Note: Won't reset state if a project is currently being opened (cloning status)
   * to prevent race conditions with React 18 Strict Mode
   */
  async close(): Promise<void> {
    // Don't close if we're in the middle of opening a project
    // This prevents race conditions from React 18 Strict Mode's simulated unmount
    if (this.status === 'cloning') {
      console.log(`[ProjectService] Ignoring close() - project is still opening`)
      return
    }

    if (this.watcher) {
      console.log(`[ProjectService] Closing project: ${this.projectId}`)
      await this.watcher.close()
      this.watcher = null
    }
    this.projectId = null
    this.projectPath = null
    this.remoteUrl = null
    this.status = 'idle'
  }

  /**
   * Scan directory tree (metadata only, no contents)
   */
  private async scanTree(dirPath?: string): Promise<FileNode[]> {
    const basePath = dirPath || this.projectPath
    if (!basePath) return []

    const nodes: FileNode[] = []

    const scan = async (currentPath: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        // Skip ignored
        if (IGNORED_FILES.has(entry.name)) continue
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.') && entry.name !== '.env') continue

        const fullPath = path.join(currentPath, entry.name)
        const relativePath = path.relative(this.projectPath!, fullPath)

        if (entry.isDirectory()) {
          nodes.push({ path: relativePath, type: 'directory' })
          await scan(fullPath)
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath)
            nodes.push({
              path: relativePath,
              type: 'file',
              size: stat.size,
              modifiedAt: stat.mtimeMs
            })
          } catch {
            nodes.push({ path: relativePath, type: 'file' })
          }
        }
      }
    }

    await scan(basePath)
    return nodes
  }

  /**
   * Start file watcher
   */
  private startWatcher(): void {
    if (!this.projectPath) return

    console.log(`[ProjectService] Starting watcher for: ${this.projectPath}`)

    this.watcher = chokidar.watch(this.projectPath, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(this.projectPath!, filePath)
        if (!relativePath) return false

        const parts = relativePath.split(path.sep)
        for (const part of parts) {
          if (IGNORED_DIRS.has(part)) return true
          if (part.startsWith('.') && part !== '.env') return true
        }
        if (IGNORED_FILES.has(parts[parts.length - 1])) return true
        return false
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    })

    this.watcher.on('add', (filePath) => this.emitChange('add', filePath))
    this.watcher.on('change', (filePath) => this.emitChange('change', filePath))
    this.watcher.on('unlink', (filePath) => this.emitChange('unlink', filePath))
    this.watcher.on('addDir', (filePath) => this.emitChange('addDir', filePath))
    this.watcher.on('unlinkDir', (filePath) => this.emitChange('unlinkDir', filePath))

    this.watcher.on('error', (error) => {
      console.error(`[ProjectService] Watcher error:`, error)
    })

    console.log(`[ProjectService] Watcher started`)
  }

  /**
   * Emit file change event to renderer
   */
  private emitChange(type: FileChangeType, filePath: string): void {
    if (!this.projectPath || !this.projectId || !this.mainWindow) return

    const relativePath = path.relative(this.projectPath, filePath)
    console.log(`[ProjectService] File ${type}: ${relativePath}`)

    const event: FileChangeEvent = {
      type,
      path: relativePath,
      projectId: this.projectId
    }

    this.mainWindow.webContents.send('project:fileChange', event)
  }

  /**
   * Read file content (lazy load)
   */
  async readFile(relativePath: string): Promise<FileContent> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    const fullPath = path.join(this.projectPath, relativePath)
    const ext = path.extname(relativePath).toLowerCase()
    const isBinary = BINARY_EXTENSIONS.has(ext)

    if (isBinary) {
      const buffer = await fs.readFile(fullPath)
      return {
        path: relativePath,
        content: buffer.toString('base64'),
        isBinary: true
      }
    }

    const content = await fs.readFile(fullPath, 'utf-8')
    return {
      path: relativePath,
      content,
      isBinary: false
    }
  }

  /**
   * Write file content
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    const fullPath = path.join(this.projectPath, relativePath)

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true })

    await fs.writeFile(fullPath, content, 'utf-8')
    console.log(`[ProjectService] Wrote file: ${relativePath}`)
  }

  /**
   * Delete file
   */
  async deleteFile(relativePath: string): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    const fullPath = path.join(this.projectPath, relativePath)
    await fs.unlink(fullPath)
    console.log(`[ProjectService] Deleted file: ${relativePath}`)
  }

  /**
   * Create directory
   */
  async createDirectory(relativePath: string): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    const fullPath = path.join(this.projectPath, relativePath)
    await fs.mkdir(fullPath, { recursive: true })
    console.log(`[ProjectService] Created directory: ${relativePath}`)
  }

  /**
   * Rename/move file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    const fullOldPath = path.join(this.projectPath, oldPath)
    const fullNewPath = path.join(this.projectPath, newPath)

    // Ensure parent directory of destination exists
    await fs.mkdir(path.dirname(fullNewPath), { recursive: true })

    await fs.rename(fullOldPath, fullNewPath)
    console.log(`[ProjectService] Renamed: ${oldPath} -> ${newPath}`)
  }

  /**
   * Commit and push changes to git
   */
  async commitAndPush(message: string): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    // Stage all changes
    await execGit(`-C "${this.projectPath}" add -A`)

    // Check if there's anything to commit
    const { stdout: status } = await execGit(`-C "${this.projectPath}" status --porcelain`)
    if (!status.trim()) {
      console.log(`[ProjectService] Nothing to commit`)
      return
    }

    // Commit
    const escapedMessage = message.replace(/"/g, '\\"')
    await execGit(`-C "${this.projectPath}" commit -m "${escapedMessage}"`)

    // Push
    await execGit(`-C "${this.projectPath}" push`)
    console.log(`[ProjectService] Committed and pushed: ${message}`)
  }

  /**
   * Sync local changes to remote with a fresh authenticated URL.
   * Updates the remote URL (to use a non-expired GitHub App token),
   * stages and commits any uncommitted changes, then pushes ALL
   * local commits (including previously unpushed ones) to remote.
   */
  async syncToRemote(authenticatedUrl: string): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    // Update remote URL with fresh token
    await execGit(`-C "${this.projectPath}" remote set-url origin "${authenticatedUrl}"`)

    // Stage and commit any uncommitted changes
    await execGit(`-C "${this.projectPath}" add -A`)
    const { stdout: status } = await execGit(`-C "${this.projectPath}" status --porcelain`)
    if (status.trim()) {
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const escapedMessage = `Deploy sync - ${timestamp}`.replace(/"/g, '\\"')
      await execGit(`-C "${this.projectPath}" commit -m "${escapedMessage}"`)
    }

    // Push all local commits (including previously unpushed ones)
    await execGit(`-C "${this.projectPath}" push origin main`)
    console.log(`[ProjectService] Synced to remote with fresh token`)
  }

  /**
   * Pull latest changes
   */
  async pull(): Promise<void> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    await execGit(`-C "${this.projectPath}" pull --rebase`)
    console.log(`[ProjectService] Pulled latest changes`)
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasChanges(): Promise<boolean> {
    if (!this.projectPath) {
      return false
    }

    const { stdout } = await execGit(`-C "${this.projectPath}" status --porcelain`)
    return stdout.trim().length > 0
  }

  /**
   * Get current project path
   */
  getProjectPath(): string | null {
    return this.projectPath
  }

  /**
   * Get current project ID
   */
  getProjectId(): string | null {
    return this.projectId
  }

  /**
   * Check if project is ready
   */
  isReady(): boolean {
    return this.status === 'ready'
  }

  /**
   * Rescan the file tree and return updated nodes
   * Useful when files are added outside of the watcher (e.g., manual copy)
   */
  async rescanTree(): Promise<FileNode[]> {
    if (!this.projectPath) {
      throw new Error('No project open')
    }

    console.log(`[ProjectService] Rescanning file tree: ${this.projectPath}`)
    const fileTree = await this.scanTree()
    console.log(`[ProjectService] Rescan found ${fileTree.length} files`)
    return fileTree
  }
}

// Singleton instance
export const projectService = new ProjectService()
