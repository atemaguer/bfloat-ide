/**
 * ProjectStore - Renderer
 *
 * Reactive cache over IPC for project filesystem.
 * Subscribes to file change events from main process.
 * Lazy loads file contents on demand.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import { projectFiles } from '@/app/api/sidecar'

// Types matching main process
export type ProjectStatus = 'idle' | 'opening' | 'ready' | 'error'

export interface FileNode {
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
}

export interface OpenFile {
  path: string
  content: string
  isBinary: boolean
  dirty: boolean
  originalContent: string // For detecting changes
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
  projectId: string
}

// Language detection helper
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sh: 'shell',
    bash: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    env: 'plaintext',
  }
  return languageMap[ext || ''] || 'plaintext'
}

/**
 * ProjectStore - singleton store for project state
 */
class ProjectStoreImpl {
  // Project metadata
  projectId = createStore<string | null>(() => null)
  projectPath = createStore<string | null>(() => null)
  status = createStore<ProjectStatus>(() => 'idle')
  error = createStore<string | null>(() => null)

  // File tree (paths + metadata, NO content)
  fileTree = createStore<Record<string, FileNode>>(() => ({}))

  // Open files cache (content loaded on demand)
  openFiles = createStore<Record<string, OpenFile>>(() => ({}))

  // Currently selected file
  currentFile = createStore<string | null>(() => null)

  // Timestamp of last file change (for triggering re-syncs on content changes)
  lastFileChange = createStore<number>(() => 0)

  // Derived: current document for editor
  currentDocument: StoreApi<OpenFile | null>

  // Derived: sorted file tree as array
  fileTreeArray: StoreApi<FileNode[]>

  // Derived: list of dirty (unsaved) files
  dirtyFiles: StoreApi<string[]>

  // Track if IPC listener is set up
  private listenerSetUp = false

  constructor() {
    // Derived: current open document
    this.currentDocument = createStore<OpenFile | null>(() => {
      const currentPath = this.currentFile.getState()
      if (!currentPath) return null
      return this.openFiles.getState()[currentPath] || null
    })

    this.currentFile.subscribe(() => {
      const currentPath = this.currentFile.getState()
      if (!currentPath) { this.currentDocument.setState(null, true); return }
      this.currentDocument.setState(this.openFiles.getState()[currentPath] || null, true)
    })
    this.openFiles.subscribe(() => {
      const currentPath = this.currentFile.getState()
      if (!currentPath) { this.currentDocument.setState(null, true); return }
      this.currentDocument.setState(this.openFiles.getState()[currentPath] || null, true)
    })

    // Derived: sorted file tree
    this.fileTreeArray = createStore<FileNode[]>(() =>
      Object.values(this.fileTree.getState()).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.path.localeCompare(b.path)
      })
    )

    this.fileTree.subscribe((tree) => {
      this.fileTreeArray.setState(
        Object.values(tree).sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.path.localeCompare(b.path)
        }),
        true
      )
    })

    // Derived: dirty files
    this.dirtyFiles = createStore<string[]>(() =>
      Object.values(this.openFiles.getState())
        .filter(f => f.dirty)
        .map(f => f.path)
    )

    this.openFiles.subscribe((files) => {
      this.dirtyFiles.setState(
        Object.values(files)
          .filter(f => f.dirty)
          .map(f => f.path),
        true
      )
    })
  }

  /**
   * Initialize IPC listener for file changes
   * Must be called once when app starts
   */
  initializeListener(): void {
    if (this.listenerSetUp) return

    if (typeof window !== 'undefined') {
      projectFiles.onFileChange((event: FileChangeEvent) => {
        this.handleFileChange(event)
      })
      this.listenerSetUp = true
      console.log('[ProjectStore] IPC listener initialized')
    }
  }

  /**
   * Handle file change event from main process
   */
  private handleFileChange(event: FileChangeEvent): void {
    // Ignore if not for current project
    if (event.projectId !== this.projectId.getState()) return

    console.log(`[ProjectStore] File change: ${event.type} ${event.path}`)

    switch (event.type) {
      case 'add':
        this.addFileNode(event.path, 'file')
        break
      case 'addDir':
        this.addFileNode(event.path, 'directory')
        break
      case 'change':
        this.invalidateFile(event.path)
        break
      case 'unlink':
        this.removeFileNode(event.path)
        break
      case 'unlinkDir':
        this.removeFileNode(event.path)
        break
    }

    // Update timestamp to trigger re-sync in UI
    this.lastFileChange.setState(Date.now(), true)
  }

  /**
   * Add a node to file tree
   */
  private addFileNode(path: string, type: 'file' | 'directory'): void {
    const tree = { ...this.fileTree.getState() }
    tree[path] = { path, type }
    this.fileTree.setState(tree, true)
  }

  /**
   * Remove a node from file tree
   */
  private removeFileNode(path: string): void {
    const tree = { ...this.fileTree.getState() }
    delete tree[path]
    this.fileTree.setState(tree, true)

    // Also remove from open files if open
    const open = { ...this.openFiles.getState() }
    if (open[path]) {
      delete open[path]
      this.openFiles.setState(open, true)
    }

    // Clear current file if it was deleted
    if (this.currentFile.getState() === path) {
      this.currentFile.setState(null, true)
    }
  }

  /**
   * Invalidate cached file content (will re-fetch on next access)
   */
  private invalidateFile(path: string): void {
    const open = { ...this.openFiles.getState() }
    if (open[path]) {
      // Remove from cache so next openFile call fetches fresh content
      delete open[path]
      this.openFiles.setState(open, true)
      console.log(`[ProjectStore] Invalidated cache for: ${path}`)
    }
  }

  /**
   * Open a project
   */
  async open(projectId: string, remoteUrl: string, appType?: string): Promise<void> {
    const currentId = this.projectId.getState()
    const currentStatus = this.status.getState()

    // Only skip if already READY for this exact project
    // Don't skip 'opening' state - the previous open might have been interrupted
    if (currentId === projectId && currentStatus === 'ready') {
      console.log(`[ProjectStore] Project ${projectId} already ready, skipping`)
      return
    }

    console.log(`[ProjectStore] Opening project: ${projectId} (current status: ${currentStatus})`)

    this.status.setState('opening', true)
    this.error.setState(null, true)
    this.projectId.setState(projectId, true)

    try {
      const result = await projectFiles.open(projectId, remoteUrl, appType)

      if (!result) {
        throw new Error('Failed to open project: no response from sidecar')
      }

      if (result.status === 'error') {
        throw new Error(result.error || 'Failed to open project')
      }

      this.projectPath.setState(result.projectPath, true)

      // Build file tree from result
      const tree: Record<string, FileNode> = {}
      if (result.fileTree) {
        for (const node of result.fileTree) {
          tree[node.path] = node
        }
      }
      this.fileTree.setState(tree, true)

      this.status.setState('ready', true)
      console.log(`[ProjectStore] Project ready with ${result.fileTree?.length ?? 0} files`)
    } catch (err) {
      console.error(`[ProjectStore] Failed to open project:`, err)
      this.status.setState('error', true)
      this.error.setState(err instanceof Error ? err.message : 'Unknown error', true)
      throw err
    }
  }

  /**
   * Close current project
   */
  async close(): Promise<void> {
    // Capture current projectId before async operation
    const closingProjectId = this.projectId.getState()
    console.log(`[ProjectStore] Closing project: ${closingProjectId}`)

    await projectFiles.close()

    // Only reset state if no new project has been opened while we were closing
    // This prevents race condition when navigating away and back quickly
    const currentProjectId = this.projectId.getState()
    if (currentProjectId !== closingProjectId) {
      console.log(`[ProjectStore] Skipping state reset - new project opened: ${currentProjectId}`)
      return
    }

    // Reset all state
    this.projectId.setState(null, true)
    this.projectPath.setState(null, true)
    this.status.setState('idle', true)
    this.error.setState(null, true)
    this.fileTree.setState({}, true)
    this.openFiles.setState({}, true)
    this.currentFile.setState(null, true)
  }

  /**
   * Open a file (lazy load content)
   */
  async openFile(path: string): Promise<OpenFile> {
    console.log(`[ProjectStore] Opening file: ${path}`)

    this.currentFile.setState(path, true)

    // Return cached if available and not dirty
    const cached = this.openFiles.getState()[path]
    if (cached) {
      return cached
    }

    // Fetch from main process
    return this.fetchFileContent(path)
  }

  /**
   * Fetch file content from main process
   */
  private async fetchFileContent(path: string): Promise<OpenFile> {
    const result = await projectFiles.readFile(path)

    const openFile: OpenFile = {
      path: result.path,
      content: result.content,
      isBinary: result.isBinary,
      dirty: false,
      originalContent: result.content
    }

    const open = { ...this.openFiles.getState() }
    open[path] = openFile
    this.openFiles.setState(open, true)

    return openFile
  }

  /**
   * Update file content in memory (marks as dirty)
   */
  updateFileContent(path: string, content: string): void {
    const open = { ...this.openFiles.getState() }
    const existing = open[path]

    if (!existing) {
      console.warn(`[ProjectStore] Cannot update unopened file: ${path}`)
      return
    }

    const dirty = content !== existing.originalContent
    open[path] = { ...existing, content, dirty }
    this.openFiles.setState(open, true)
  }

  /**
   * Save file to disk
   */
  async saveFile(path: string): Promise<void> {
    const open = this.openFiles.getState()
    const file = open[path]

    if (!file) {
      throw new Error(`File not open: ${path}`)
    }

    await projectFiles.writeFile(path, file.content)

    // Update cache - no longer dirty
    const updated = { ...open }
    updated[path] = { ...file, dirty: false, originalContent: file.content }
    this.openFiles.setState(updated, true)

    console.log(`[ProjectStore] Saved file: ${path}`)
  }

  /**
   * Save current file
   */
  async saveCurrentFile(): Promise<void> {
    const current = this.currentFile.getState()
    if (current) {
      await this.saveFile(current)
    }
  }

  /**
   * Save all dirty files
   */
  async saveAllFiles(): Promise<void> {
    const dirty = this.dirtyFiles.getState()
    for (const path of dirty) {
      await this.saveFile(path)
    }
  }

  /**
   * Revert file to original content
   */
  revertFile(path: string): void {
    const open = { ...this.openFiles.getState() }
    const file = open[path]

    if (!file) return

    open[path] = { ...file, content: file.originalContent, dirty: false }
    this.openFiles.setState(open, true)
  }

  /**
   * Close a file (remove from open files)
   */
  closeFile(path: string): void {
    const open = { ...this.openFiles.getState() }
    delete open[path]
    this.openFiles.setState(open, true)

    // If this was current file, clear it
    if (this.currentFile.getState() === path) {
      // Try to select another open file
      const remaining = Object.keys(open)
      this.currentFile.setState(remaining.length > 0 ? remaining[0] : null, true)
    }
  }

  /**
   * Create a new file
   */
  async createFile(path: string, content: string = ''): Promise<void> {
    await projectFiles.writeFile(path, content)
    // Watcher will pick up the add event
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    await projectFiles.deleteFile(path)
    // Watcher will pick up the unlink event
  }

  /**
   * Create a directory
   */
  async createDirectory(path: string): Promise<void> {
    await projectFiles.createDirectory(path)
    // Watcher will pick up the addDir event
  }

  /**
   * Rename/move a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await projectFiles.rename(oldPath, newPath)
    // Watcher will pick up the unlink + add events
  }

  /**
   * Commit and push changes
   */
  async commitAndPush(message: string): Promise<void> {
    await projectFiles.commitAndPush(message)
  }

  /**
   * Sync local changes to remote with a fresh authenticated URL
   */
  async syncToRemote(authenticatedUrl: string): Promise<void> {
    await projectFiles.syncToRemote(authenticatedUrl)
  }

  /**
   * Pull latest changes
   */
  async pull(): Promise<void> {
    await projectFiles.pull()
  }

  /**
   * Check if there are uncommitted git changes
   */
  async hasGitChanges(): Promise<boolean> {
    return projectFiles.hasChanges()
  }

  /**
   * Get language for a file path
   */
  getLanguage(path: string): string {
    return getLanguageFromPath(path)
  }

  /**
   * Refresh the file tree by rescanning the project directory
   * Useful when files are added outside of the watcher (e.g., manual copy)
   */
  async refreshFileTree(): Promise<void> {
    if (this.status.getState() !== 'ready') {
      console.log('[ProjectStore] Cannot refresh - project not ready')
      return
    }

    console.log('[ProjectStore] Refreshing file tree...')

    try {
      const newTree = await projectFiles.rescanTree()

      // Build new tree record
      const tree: Record<string, FileNode> = {}
      for (const node of newTree) {
        tree[node.path] = node
      }
      this.fileTree.setState(tree, true)

      // Trigger re-sync in UI
      this.lastFileChange.setState(Date.now(), true)

      console.log(`[ProjectStore] File tree refreshed with ${newTree.length} files`)
    } catch (err) {
      console.error('[ProjectStore] Failed to refresh file tree:', err)
    }
  }
}

// Singleton instance
export const projectStore = new ProjectStoreImpl()
