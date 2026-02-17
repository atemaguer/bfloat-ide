/**
 * ProjectStore - Renderer
 *
 * Reactive cache over IPC for project filesystem.
 * Subscribes to file change events from main process.
 * Lazy loads file contents on demand.
 */

import { atom, map, computed, type ReadableAtom } from 'nanostores'

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
  projectId = atom<string | null>(null)
  projectPath = atom<string | null>(null)
  status = atom<ProjectStatus>('idle')
  error = atom<string | null>(null)

  // File tree (paths + metadata, NO content)
  fileTree = map<Record<string, FileNode>>({})

  // Open files cache (content loaded on demand)
  openFiles = map<Record<string, OpenFile>>({})

  // Currently selected file
  currentFile = atom<string | null>(null)

  // Timestamp of last file change (for triggering re-syncs on content changes)
  lastFileChange = atom<number>(0)

  // Computed: current document for editor
  currentDocument: ReadableAtom<OpenFile | null>

  // Computed: sorted file tree as array
  fileTreeArray: ReadableAtom<FileNode[]>

  // Computed: list of dirty (unsaved) files
  dirtyFiles: ReadableAtom<string[]>

  // Track if IPC listener is set up
  private listenerSetUp = false

  constructor() {
    // Computed: current open document
    this.currentDocument = computed(
      [this.currentFile, this.openFiles],
      (currentPath, files): OpenFile | null => {
        if (!currentPath) return null
        return files[currentPath] || null
      }
    )

    // Computed: sorted file tree
    this.fileTreeArray = computed(
      [this.fileTree],
      (tree): FileNode[] => {
        return Object.values(tree).sort((a, b) => {
          // Directories first
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
          }
          // Then alphabetically
          return a.path.localeCompare(b.path)
        })
      }
    )

    // Computed: dirty files
    this.dirtyFiles = computed(
      [this.openFiles],
      (files): string[] => {
        return Object.values(files)
          .filter(f => f.dirty)
          .map(f => f.path)
      }
    )
  }

  /**
   * Initialize IPC listener for file changes
   * Must be called once when app starts
   */
  initializeListener(): void {
    if (this.listenerSetUp) return

    if (typeof window !== 'undefined' && window.conveyor?.projectFiles) {
      window.conveyor.projectFiles.onFileChange((event: FileChangeEvent) => {
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
    if (event.projectId !== this.projectId.get()) return

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
    this.lastFileChange.set(Date.now())
  }

  /**
   * Add a node to file tree
   */
  private addFileNode(path: string, type: 'file' | 'directory'): void {
    const tree = { ...this.fileTree.get() }
    tree[path] = { path, type }
    this.fileTree.set(tree)
  }

  /**
   * Remove a node from file tree
   */
  private removeFileNode(path: string): void {
    const tree = { ...this.fileTree.get() }
    delete tree[path]
    this.fileTree.set(tree)

    // Also remove from open files if open
    const open = { ...this.openFiles.get() }
    if (open[path]) {
      delete open[path]
      this.openFiles.set(open)
    }

    // Clear current file if it was deleted
    if (this.currentFile.get() === path) {
      this.currentFile.set(null)
    }
  }

  /**
   * Invalidate cached file content (will re-fetch on next access)
   */
  private invalidateFile(path: string): void {
    const open = { ...this.openFiles.get() }
    if (open[path]) {
      // Remove from cache so next openFile call fetches fresh content
      delete open[path]
      this.openFiles.set(open)
      console.log(`[ProjectStore] Invalidated cache for: ${path}`)
    }
  }

  /**
   * Open a project
   */
  async open(projectId: string, remoteUrl: string, appType?: string): Promise<void> {
    const currentId = this.projectId.get()
    const currentStatus = this.status.get()

    // Only skip if already READY for this exact project
    // Don't skip 'opening' state - the previous open might have been interrupted
    if (currentId === projectId && currentStatus === 'ready') {
      console.log(`[ProjectStore] Project ${projectId} already ready, skipping`)
      return
    }

    console.log(`[ProjectStore] Opening project: ${projectId} (current status: ${currentStatus})`)

    this.status.set('opening')
    this.error.set(null)
    this.projectId.set(projectId)

    try {
      const result = await window.conveyor.projectFiles.open(projectId, remoteUrl, appType)

      if (result.status === 'error') {
        throw new Error(result.error || 'Failed to open project')
      }

      this.projectPath.set(result.projectPath)

      // Build file tree from result
      const tree: Record<string, FileNode> = {}
      for (const node of result.fileTree) {
        tree[node.path] = node
      }
      this.fileTree.set(tree)

      this.status.set('ready')
      console.log(`[ProjectStore] Project ready with ${result.fileTree.length} files`)
    } catch (err) {
      console.error(`[ProjectStore] Failed to open project:`, err)
      this.status.set('error')
      this.error.set(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  /**
   * Close current project
   */
  async close(): Promise<void> {
    // Capture current projectId before async operation
    const closingProjectId = this.projectId.get()
    console.log(`[ProjectStore] Closing project: ${closingProjectId}`)

    await window.conveyor.projectFiles.close()

    // Only reset state if no new project has been opened while we were closing
    // This prevents race condition when navigating away and back quickly
    const currentProjectId = this.projectId.get()
    if (currentProjectId !== closingProjectId) {
      console.log(`[ProjectStore] Skipping state reset - new project opened: ${currentProjectId}`)
      return
    }

    // Reset all state
    this.projectId.set(null)
    this.projectPath.set(null)
    this.status.set('idle')
    this.error.set(null)
    this.fileTree.set({})
    this.openFiles.set({})
    this.currentFile.set(null)
  }

  /**
   * Open a file (lazy load content)
   */
  async openFile(path: string): Promise<OpenFile> {
    console.log(`[ProjectStore] Opening file: ${path}`)

    this.currentFile.set(path)

    // Return cached if available and not dirty
    const cached = this.openFiles.get()[path]
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
    const result = await window.conveyor.projectFiles.readFile(path)

    const openFile: OpenFile = {
      path: result.path,
      content: result.content,
      isBinary: result.isBinary,
      dirty: false,
      originalContent: result.content
    }

    const open = { ...this.openFiles.get() }
    open[path] = openFile
    this.openFiles.set(open)

    return openFile
  }

  /**
   * Update file content in memory (marks as dirty)
   */
  updateFileContent(path: string, content: string): void {
    const open = { ...this.openFiles.get() }
    const existing = open[path]

    if (!existing) {
      console.warn(`[ProjectStore] Cannot update unopened file: ${path}`)
      return
    }

    const dirty = content !== existing.originalContent
    open[path] = { ...existing, content, dirty }
    this.openFiles.set(open)
  }

  /**
   * Save file to disk
   */
  async saveFile(path: string): Promise<void> {
    const open = this.openFiles.get()
    const file = open[path]

    if (!file) {
      throw new Error(`File not open: ${path}`)
    }

    await window.conveyor.projectFiles.writeFile(path, file.content)

    // Update cache - no longer dirty
    const updated = { ...open }
    updated[path] = { ...file, dirty: false, originalContent: file.content }
    this.openFiles.set(updated)

    console.log(`[ProjectStore] Saved file: ${path}`)
  }

  /**
   * Save current file
   */
  async saveCurrentFile(): Promise<void> {
    const current = this.currentFile.get()
    if (current) {
      await this.saveFile(current)
    }
  }

  /**
   * Save all dirty files
   */
  async saveAllFiles(): Promise<void> {
    const dirty = this.dirtyFiles.get()
    for (const path of dirty) {
      await this.saveFile(path)
    }
  }

  /**
   * Revert file to original content
   */
  revertFile(path: string): void {
    const open = { ...this.openFiles.get() }
    const file = open[path]

    if (!file) return

    open[path] = { ...file, content: file.originalContent, dirty: false }
    this.openFiles.set(open)
  }

  /**
   * Close a file (remove from open files)
   */
  closeFile(path: string): void {
    const open = { ...this.openFiles.get() }
    delete open[path]
    this.openFiles.set(open)

    // If this was current file, clear it
    if (this.currentFile.get() === path) {
      // Try to select another open file
      const remaining = Object.keys(open)
      this.currentFile.set(remaining.length > 0 ? remaining[0] : null)
    }
  }

  /**
   * Create a new file
   */
  async createFile(path: string, content: string = ''): Promise<void> {
    await window.conveyor.projectFiles.writeFile(path, content)
    // Watcher will pick up the add event
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    await window.conveyor.projectFiles.deleteFile(path)
    // Watcher will pick up the unlink event
  }

  /**
   * Create a directory
   */
  async createDirectory(path: string): Promise<void> {
    await window.conveyor.projectFiles.createDirectory(path)
    // Watcher will pick up the addDir event
  }

  /**
   * Rename/move a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await window.conveyor.projectFiles.rename(oldPath, newPath)
    // Watcher will pick up the unlink + add events
  }

  /**
   * Commit and push changes
   */
  async commitAndPush(message: string): Promise<void> {
    await window.conveyor.projectFiles.commitAndPush(message)
  }

  /**
   * Sync local changes to remote with a fresh authenticated URL
   */
  async syncToRemote(authenticatedUrl: string): Promise<void> {
    await window.conveyor.projectFiles.syncToRemote(authenticatedUrl)
  }

  /**
   * Pull latest changes
   */
  async pull(): Promise<void> {
    await window.conveyor.projectFiles.pull()
  }

  /**
   * Check if there are uncommitted git changes
   */
  async hasGitChanges(): Promise<boolean> {
    return window.conveyor.projectFiles.hasChanges()
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
    if (this.status.get() !== 'ready') {
      console.log('[ProjectStore] Cannot refresh - project not ready')
      return
    }

    console.log('[ProjectStore] Refreshing file tree...')

    try {
      const newTree = await window.conveyor.projectFiles.rescanTree()

      // Build new tree record
      const tree: Record<string, FileNode> = {}
      for (const node of newTree) {
        tree[node.path] = node
      }
      this.fileTree.set(tree)

      // Trigger re-sync in UI
      this.lastFileChange.set(Date.now())

      console.log(`[ProjectStore] File tree refreshed with ${newTree.length} files`)
    } catch (err) {
      console.error('[ProjectStore] Failed to refresh file tree:', err)
    }
  }
}

// Singleton instance
export const projectStore = new ProjectStoreImpl()
