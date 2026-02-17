import { atom, map } from 'nanostores'
import type { EditorDocument, FileMap, ChatMessage, Project } from '@/app/types/project'
import { FilesStore } from './files'
import { EditorStore } from './editor'
import { projectStore } from './project-store'

export type WorkbenchViewType = 'editor' | 'preview'
export type WorkbenchTabType = 'editor' | 'preview' | 'database' | 'payments' | 'settings'

// Store a reference to the workbench's runCommand function
let workbenchRunCommand: ((command: string, terminalId?: string) => Promise<void>) | null = null

// Store references for deploy terminal functions
let workbenchCreateDeployTerminal: (() => string) | null = null
let workbenchOpenTerminal: (() => void) | null = null

// Store reference to filesystem API
let filesystemApi: {
  createTempDir: (projectId: string) => Promise<{ success: boolean; path?: string; error?: string }>
  writeFiles: (
    basePath: string,
    files: Array<{ path: string; content: string }>
  ) => Promise<{ success: boolean; error?: string }>
  getTempPath: (projectId: string) => Promise<string>
} | null = null

export class WorkbenchStore {
  #filesStore = new FilesStore()
  #editorStore = new EditorStore(this.#filesStore)

  // Current project
  currentProject = atom<Project | null>(null)

  // Project filesystem path
  projectPath = atom<string | null>(null)

  // Chat state
  chatStreaming = atom<boolean>(false)
  messages = atom<ChatMessage[]>([])

  // Preview error state - errors from dev server that need AI to fix
  promptError = atom<string>('')

  // View state
  activeView = atom<WorkbenchViewType>('preview')

  // Workbench tab state (shared between Titlebar and Workbench)
  // Default to 'preview' so users see their app immediately
  activeTab = atom<WorkbenchTabType>('preview')

  // Chat panel collapsed state
  isChatCollapsed = atom<boolean>(false)
  unsavedFiles = atom<Set<string>>(new Set())

  // Pending prompt from external components (e.g., deployment)
  // The Chat component watches this and sends the prompt when set
  pendingPrompt = atom<string | null>(null)

  // Pending environment variables for the next agent session
  // Used for passing temporary credentials (e.g., Apple ID for iOS deployment)
  pendingEnvVars = atom<Record<string, string> | null>(null)

  // Pending environment variables for PTY (interactive terminal) sessions
  // Used for first-time iOS deployment where interactive prompts are needed
  pendingPtyEnvVars = atom<{ projectPath: string; envVars: Record<string, string> } | null>(null)

  // Pending screenshot from Preview — consumed by Chat to add as attachment
  pendingScreenshot = atom<string | null>(null)

  /**
   * Register the filesystem API for file operations
   * Called once when the conveyor is available
   */
  registerFilesystemApi(api: typeof filesystemApi): void {
    filesystemApi = api
  }

  get files() {
    return this.#filesStore.files
  }

  get currentDocument() {
    return this.#editorStore.currentDocument
  }

  get selectedFile() {
    return this.#editorStore.selectedFile
  }

  get filesCount(): number {
    return this.#filesStore.filesCount
  }

  // Project management
  setProject(project: Project): void {
    this.currentProject.set(project)
    this.#filesStore.setFiles(project.files)
    this.#editorStore.setDocuments(project.files)
    // NOTE: Messages are NOT set from project - they come from local Claude/Codex sessions
  }

  /**
   * Set project metadata only (without touching files)
   * Use this when files are managed separately via projectStore/disk
   * This prevents race conditions where setProject clears files before
   * the async file sync completes
   */
  setProjectMetadata(project: Project): void {
    this.currentProject.set(project)
    // NOTE: Messages are NOT set from project - they come from local Claude/Codex sessions
    // Messages are loaded via aiAgentApi.readSession() in the Chat component
  }

  /**
   * Sync project files to disk in ~/.bfloat-ide/project-{projectId}/
   * Creates the directory if it doesn't exist, then writes all files
   */
  async syncFilesToDisk(): Promise<{ success: boolean; path?: string; error?: string }> {
    const project = this.currentProject.get()
    if (!project) {
      return { success: false, error: 'No project loaded' }
    }

    if (!filesystemApi) {
      console.warn('[WorkbenchStore] Filesystem API not registered')
      return { success: false, error: 'Filesystem API not available' }
    }

    try {
      // Create or get the project directory
      const result = await filesystemApi.createTempDir(project.id)
      if (!result.success || !result.path) {
        return { success: false, error: result.error || 'Failed to create project directory' }
      }

      const projectDir = result.path
      this.projectPath.set(projectDir)

      // Convert FileMap to array of files for writing
      const files = this.files.get()
      const fileEntries: Array<{ path: string; content: string }> = []

      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          fileEntries.push({
            path: filePath,
            content: dirent.content,
          })
        }
      }

      if (fileEntries.length > 0) {
        const writeResult = await filesystemApi.writeFiles(projectDir, fileEntries)
        if (!writeResult.success) {
          return { success: false, error: writeResult.error || 'Failed to write files' }
        }
      }

      return { success: true, path: projectDir }
    } catch (error) {
      console.error('[WorkbenchStore] Failed to sync files to disk:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Get the current project's filesystem path
   */
  getProjectPath(): string | null {
    return this.projectPath.get()
  }

  // View management
  setActiveView(view: WorkbenchViewType): void {
    this.activeView.set(view)
  }

  setActiveTab(tab: WorkbenchTabType): void {
    this.activeTab.set(tab)
  }

  setIsChatCollapsed(collapsed: boolean): void {
    this.isChatCollapsed.set(collapsed)
  }

  toggleChatCollapsed(): void {
    this.isChatCollapsed.set(!this.isChatCollapsed.get())
  }

  /**
   * Trigger a prompt in the chat from an external component
   * This opens the chat panel if collapsed and sets a pending prompt
   * The Chat component will pick up the pending prompt and send it
   */
  triggerChatPrompt(prompt: string): void {
    console.log('[workbenchStore] triggerChatPrompt called with:', prompt)
    console.log('[workbenchStore] Previous pendingPrompt:', this.pendingPrompt.get())
    console.log('[workbenchStore] isChatCollapsed before:', this.isChatCollapsed.get())
    this.pendingPrompt.set(prompt)
    this.isChatCollapsed.set(false) // Open chat panel
    console.log('[workbenchStore] pendingPrompt set to:', this.pendingPrompt.get())
    console.log('[workbenchStore] isChatCollapsed after:', this.isChatCollapsed.get())
  }

  /**
   * Clear the pending prompt after it has been sent
   */
  clearPendingPrompt(): void {
    console.log('[workbenchStore] clearPendingPrompt called')
    console.log('[workbenchStore] pendingPrompt before:', this.pendingPrompt.get())
    this.pendingPrompt.set(null)
    console.log('[workbenchStore] pendingPrompt after: null')
  }

  /**
   * Set environment variables for the next agent session
   * This is used for passing temporary credentials (e.g., Apple ID for iOS deployment)
   */
  setPendingEnvVars(envVars: Record<string, string>): void {
    console.log('[workbenchStore] setPendingEnvVars called with keys:', Object.keys(envVars))
    console.log('[workbenchStore] Previous pendingEnvVars:', this.pendingEnvVars.get())
    this.pendingEnvVars.set(envVars)
    console.log('[workbenchStore] pendingEnvVars set to:', this.pendingEnvVars.get())
  }

  /**
   * Get and clear pending environment variables
   * Called when creating a new agent session
   */
  takePendingEnvVars(): Record<string, string> | null {
    const envVars = this.pendingEnvVars.get()
    console.log('[workbenchStore] takePendingEnvVars called, returning:', envVars ? Object.keys(envVars) : null)
    this.pendingEnvVars.set(null) // Clear after taking
    console.log('[workbenchStore] pendingEnvVars cleared, now:', this.pendingEnvVars.get())
    return envVars
  }

  /**
   * Check if there are pending environment variables (without clearing them)
   * Used to decide whether to create a new session
   */
  hasPendingEnvVars(): boolean {
    const has = this.pendingEnvVars.get() !== null
    console.log('[workbenchStore] hasPendingEnvVars called, returning:', has)
    if (has) {
      console.log('[workbenchStore] pendingEnvVars keys:', Object.keys(this.pendingEnvVars.get()!))
    }
    return has
  }

  /**
   * Set environment variables for PTY (interactive terminal) session
   * This is used for first-time iOS deployment where interactive prompts are needed
   * The terminal will pick these up when spawning
   */
  setPtyEnvVars(projectPath: string, envVars: Record<string, string>): void {
    this.pendingPtyEnvVars.set({ projectPath, envVars })
  }

  /**
   * Get and clear pending PTY environment variables
   * Called when creating a new PTY session
   */
  takePendingPtyEnvVars(): { projectPath: string; envVars: Record<string, string> } | null {
    const ptyEnvVars = this.pendingPtyEnvVars.get()
    this.pendingPtyEnvVars.set(null) // Clear after taking
    return ptyEnvVars
  }

  // File management
  setDocuments(files: FileMap): void {
    this.#editorStore.setDocuments(files)

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath)
          break
        }
      }
    }
  }

  setSelectedFile(filePath: string | undefined): void {
    this.#editorStore.setSelectedFile(filePath)
  }

  setCurrentDocumentContent(newContent: string): void {
    const doc = this.currentDocument.get()
    const filePath = doc?.filePath

    if (!filePath) return

    const originalContent = this.#filesStore.getFile(filePath)?.content
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent

    this.#editorStore.updateFile(filePath, newContent)

    if (doc) {
      const previousUnsavedFiles = this.unsavedFiles.get()

      if (unsavedChanges && previousUnsavedFiles.has(filePath)) {
        return
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles)

      if (unsavedChanges) {
        newUnsavedFiles.add(filePath)
      } else {
        newUnsavedFiles.delete(filePath)
      }

      this.unsavedFiles.set(newUnsavedFiles)
    }
  }

  async saveFile(filePath: string): Promise<void> {
    const documents = this.#editorStore.documents.get()
    const document = documents[filePath]

    if (document === undefined) return

    await this.#filesStore.saveFile(filePath, document.value)

    // Save to disk via projectStore (new architecture)
    const storeStatus = projectStore.status.get()
    if (storeStatus === 'ready') {
      try {
        // Use createFile which writes directly to disk via IPC
        // This handles both new files and existing files
        await projectStore.createFile(filePath, document.value)
        console.log(`[WorkbenchStore] Saved file via projectStore: ${filePath}`)
      } catch (error) {
        console.error(`[WorkbenchStore] Failed to save file via projectStore: ${filePath}`, error)
      }
    }
    // Fallback to legacy filesystemApi
    else {
      const projectDir = this.projectPath.get()
      if (projectDir && filesystemApi) {
        try {
          await filesystemApi.writeFiles(projectDir, [{ path: filePath, content: document.value }])
        } catch (error) {
          console.error(`[WorkbenchStore] Failed to save file to disk: ${filePath}`, error)
        }
      }
    }

    const newUnsavedFiles = new Set(this.unsavedFiles.get())
    newUnsavedFiles.delete(filePath)
    this.unsavedFiles.set(newUnsavedFiles)
  }

  async saveCurrentDocument(): Promise<void> {
    const currentDocument = this.currentDocument.get()
    if (currentDocument === undefined) return
    await this.saveFile(currentDocument.filePath)
  }

  resetCurrentDocument(): void {
    const currentDocument = this.currentDocument.get()
    if (currentDocument === undefined) return

    const { filePath } = currentDocument
    const file = this.#filesStore.getFile(filePath)

    if (!file) return

    this.setCurrentDocumentContent(file.content)
  }

  async saveAllFiles(): Promise<void> {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath)
    }
  }

  /**
   * Save all unsaved files and commit to git before closing project
   * This ensures changes are preserved when switching projects
   */
  async saveAllAndCommit(): Promise<void> {
    // First save all unsaved files to disk
    await this.saveAllFiles()

    // Then commit and push to git
    const storeStatus = projectStore.status.get()
    if (storeStatus === 'ready') {
      try {
        await projectStore.commitAndPush('Auto-save before close')
      } catch (error) {
        console.error('[WorkbenchStore] Failed to commit changes:', error)
      }
    }
  }

  // File operations
  addFile(filePath: string, content: string): void {
    this.#filesStore.addFile(filePath, content)

    // Update the editor document
    this.#editorStore.updateFile(filePath, content)

    // Write to disk via projectStore (new architecture)
    const storeStatus = projectStore.status.get()
    if (storeStatus === 'ready') {
      projectStore.createFile(filePath, content).catch((error) => {
        console.error(`[WorkbenchStore] Failed to add file via projectStore: ${filePath}`, error)
      })
    }
    // Fallback to legacy filesystemApi
    else {
      const projectDir = this.projectPath.get()
      if (projectDir && filesystemApi) {
        filesystemApi.writeFiles(projectDir, [{ path: filePath, content }]).catch((error) => {
          console.error(`[WorkbenchStore] Failed to add file to disk: ${filePath}`, error)
        })
      }
    }
  }

  updateFile(filePath: string, content: string): void {
    this.#filesStore.updateFile(filePath, content)

    // Also update the editor document
    this.#editorStore.updateFile(filePath, content)

    // Write to disk via projectStore (new architecture)
    const storeStatus = projectStore.status.get()
    if (storeStatus === 'ready') {
      // Use createFile which writes directly to disk via IPC
      projectStore.createFile(filePath, content).catch((error) => {
        console.error(`[WorkbenchStore] Failed to update file via projectStore: ${filePath}`, error)
      })
    }
    // Fallback to legacy filesystemApi
    else {
      const projectDir = this.projectPath.get()
      if (projectDir && filesystemApi) {
        filesystemApi.writeFiles(projectDir, [{ path: filePath, content }]).catch((error) => {
          console.error(`[WorkbenchStore] Failed to update file on disk: ${filePath}`, error)
        })
      }
    }
  }

  deleteFile(filePath: string): void {
    this.#filesStore.deleteFile(filePath)
    // Note: We don't delete from disk to preserve history
    // Files will be overwritten on next sync
  }

  setFiles(files: FileMap): void {
    this.#filesStore.setFiles(files)
    this.setDocuments(files)
    console.log('[WorkbenchStore] ===== setFiles COMPLETE =====')
  }

  /**
   * Update a single file entry in the store without writing to disk.
   * Used for syncing file changes from projectStore to workbenchStore.
   */
  updateFileEntry(filePath: string, entry: { type: 'file'; content: string; isBinary?: boolean }): void {
    this.#filesStore.addFile(filePath, entry.content, entry.isBinary)
  }

  // Chat management
  addMessage(message: ChatMessage): void {
    const currentMessages = this.messages.get()
    this.messages.set([...currentMessages, message])
  }

  setMessages(messages: ChatMessage[]): void {
    this.messages.set(messages)
  }

  setChatStreaming(streaming: boolean): void {
    this.chatStreaming.set(streaming)
  }

  // Preview error management
  setPromptError(error: string): void {
    this.promptError.set(error)
  }

  clearPromptError(): void {
    this.promptError.set('')
  }

  // Terminal command execution
  /**
   * Register the workbench's runCommand function
   * Called by the Workbench component on mount
   */
  registerTerminalRunner(runner: (command: string, terminalId?: string) => Promise<void>): void {
    workbenchRunCommand = runner
  }

  /**
   * Unregister the terminal runner
   * Called by the Workbench component on unmount
   */
  unregisterTerminalRunner(): void {
    workbenchRunCommand = null
    workbenchCreateDeployTerminal = null
    workbenchOpenTerminal = null
  }

  /**
   * Register deploy terminal functions
   */
  registerDeployTerminalFunctions(functions: { createDeployTerminal: () => string; openTerminal: () => void }): void {
    workbenchCreateDeployTerminal = functions.createDeployTerminal
    workbenchOpenTerminal = functions.openTerminal
  }

  /**
   * Create a deploy terminal tab and run a command
   * Opens the terminal panel, creates a "Deploy" tab, and runs the command
   */
  async runDeployCommand(command: string): Promise<void> {
    if (!workbenchCreateDeployTerminal || !workbenchOpenTerminal || !workbenchRunCommand) {
      console.warn('[WorkbenchStore] Deploy terminal functions not registered')
      return
    }

    // Open terminal panel
    workbenchOpenTerminal()

    // Create deploy terminal tab and get its ID
    const terminalId = workbenchCreateDeployTerminal()

    // Wait a bit for the terminal to initialize
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Run the command in the deploy terminal
    await workbenchRunCommand(command, terminalId)
  }

  /**
   * Run a terminal command from anywhere in the app
   * @param command The command to run (e.g., 'npm install', 'cd /path')
   * @param terminalId Optional specific terminal ID to run in
   */
  async runTerminalCommand(command: string, terminalId?: string): Promise<void> {
    if (workbenchRunCommand) {
      await workbenchRunCommand(command, terminalId)
    } else {
      console.warn('[WorkbenchStore] No terminal runner registered')
    }
  }

  /**
   * Open the terminal panel
   * Called when needing to show the terminal to the user
   */
  openTerminal(): void {
    if (workbenchOpenTerminal) {
      workbenchOpenTerminal()
    } else {
      console.warn('[WorkbenchStore] openTerminal not registered')
    }
  }

  /**
   * Create a deploy terminal tab and return its ID
   * Opens the terminal panel and creates a "Deploy" tab
   */
  async createDeployTerminalTab(): Promise<string> {
    if (!workbenchCreateDeployTerminal || !workbenchOpenTerminal) {
      console.warn('[WorkbenchStore] Deploy terminal functions not registered')
      throw new Error('Deploy terminal functions not registered')
    }

    // Open terminal panel
    workbenchOpenTerminal()

    // Create deploy terminal tab and return its ID
    return workbenchCreateDeployTerminal()
  }

  /**
   * Reset all workbench state
   * Called when leaving the project page to clear stale data
   */
  reset(): void {
    const currentProject = this.currentProject.get()

    // Clear project state
    this.currentProject.set(null)
    this.projectPath.set(null)

    // Clear files and editor state
    this.#filesStore.setFiles(null)
    this.#editorStore.setDocuments(null)
    this.#editorStore.setSelectedFile(undefined)

    // Clear chat state
    this.messages.set([])
    this.chatStreaming.set(false)

    // Clear error state
    this.promptError.set('')

    // Clear unsaved files
    this.unsavedFiles.set(new Set())

    // Clear pending screenshot
    this.pendingScreenshot.set(null)

    // Reset view state to defaults
    this.activeView.set('preview')
    this.activeTab.set('preview')
    this.isChatCollapsed.set(false)
    console.log('[WorkbenchStore] ===== reset COMPLETE =====')
  }
}

export const workbenchStore = new WorkbenchStore()
