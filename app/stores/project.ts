import { createStore } from 'zustand/vanilla'
import type { FileMap, ChatMessage, Project, AppType } from '@/app/types/project'

/**
 * Simplified project store for git-based architecture
 *
 * Key differences from old workbench store:
 * - No editor document state (AI-only changes, no user editing)
 * - Files come from agent (git clone) not S3
 * - No unsaved files tracking (everything is in git)
 * - Simple reactive file map
 */

export type WorkbenchViewType = 'code' | 'preview'

// Agent API reference - set during app initialization
let agentApi: {
  start: (config: { projectId: string; remoteUrl: string }) => Promise<{ success: boolean; projectPath?: string; error?: string }>
  stop: (projectId: string) => Promise<{ success: boolean; error?: string }>
  execute: (projectId: string, changes: Array<{ path: string; content?: string; type: 'write' | 'delete' }>) => Promise<{ success: boolean; error?: string }>
  commit: (projectId: string, options: { message: string; messageId?: string }) => Promise<{ success: boolean; error?: string }>
  getFiles: (projectId: string) => Promise<{ success: boolean; files?: Array<{ path: string; content: string; isBinary: boolean }>; error?: string }>
  pull: (projectId: string) => Promise<{ success: boolean; error?: string }>
  status: (projectId: string) => Promise<{ isRunning: boolean; projectPath?: string; hasUncommittedChanges?: boolean }>
  onFileChange: (callback: (data: { projectId: string; type: string; path: string; relativePath: string }) => void) => () => void
} | null = null

// Terminal runner reference
let terminalRunner: ((command: string, terminalId?: string) => Promise<void>) | null = null

class ProjectStore {
  // Current project
  currentProject = createStore<Project | null>(() => null)

  // Project files - simple reactive map
  files = createStore<FileMap>(() => ({}))

  // Selected file for viewing (read-only)
  selectedFile = createStore<string | undefined>(() => undefined)

  // Project path on disk
  projectPath = createStore<string | null>(() => null)

  // Chat state
  chatStreaming = createStore<boolean>(() => false)
  messages = createStore<ChatMessage[]>(() => [])

  // Preview error state
  promptError = createStore<string>(() => '')

  // View state
  activeView = createStore<WorkbenchViewType>(() => 'preview')

  // Agent running state
  agentRunning = createStore<boolean>(() => false)

  // File change subscription cleanup
  #fileChangeUnsubscribe: (() => void) | null = null

  /**
   * Register the agent API
   */
  registerAgentApi(api: typeof agentApi): void {
    agentApi = api
  }

  /**
   * Register terminal runner
   */
  registerTerminalRunner(runner: (command: string, terminalId?: string) => Promise<void>): void {
    terminalRunner = runner
  }

  unregisterTerminalRunner(): void {
    terminalRunner = null
  }

  /**
   * Load a project and start the agent
   */
  async loadProject(project: Project, remoteUrl: string): Promise<{ success: boolean; error?: string }> {
    if (!agentApi) {
      return { success: false, error: 'Agent API not registered' }
    }

    // Set project state
    this.currentProject.setState(project, true)
    // NOTE: Messages are NOT set from project - they come from local Claude/Codex sessions

    // Start agent (clones/pulls repo)
    const result = await agentApi.start({
      projectId: project.id,
      remoteUrl,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    this.projectPath.setState(result.projectPath ?? null, true)
    this.agentRunning.setState(true, true)

    // Load files from agent
    await this.refreshFiles()

    // Subscribe to file changes
    this.#subscribeToFileChanges(project.id)

    return { success: true }
  }

  /**
   * Refresh files from the agent
   */
  async refreshFiles(): Promise<void> {
    const project = this.currentProject.getState()
    if (!project || !agentApi) return

    const result = await agentApi.getFiles(project.id)
    if (result.success && result.files) {
      // Convert agent files to FileMap
      const fileMap: FileMap = {}
      for (const file of result.files) {
        fileMap[file.path] = {
          type: 'file',
          content: file.content,
        }
      }
      this.files.setState(fileMap, true)
    }
  }

  /**
   * Unload the current project
   */
  async unloadProject(): Promise<void> {
    const project = this.currentProject.getState()
    if (project && agentApi) {
      await agentApi.stop(project.id)
    }

    // Cleanup subscription
    if (this.#fileChangeUnsubscribe) {
      this.#fileChangeUnsubscribe()
      this.#fileChangeUnsubscribe = null
    }

    this.currentProject.setState(null, true)
    this.files.setState({}, true)
    this.selectedFile.setState(undefined, true)
    this.projectPath.setState(null, true)
    this.messages.setState([], true)
    this.agentRunning.setState(false, true)
  }

  /**
   * Execute file changes from AI
   */
  async executeChanges(changes: Array<{ path: string; content?: string; type: 'write' | 'delete' }>): Promise<{ success: boolean; error?: string }> {
    const project = this.currentProject.getState()
    if (!project || !agentApi) {
      return { success: false, error: 'No project loaded' }
    }

    const result = await agentApi.execute(project.id, changes)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    // Files will be updated via file change subscription
    return { success: true }
  }

  /**
   * Commit current changes
   */
  async commit(message: string, messageId?: string): Promise<{ success: boolean; error?: string }> {
    const project = this.currentProject.getState()
    if (!project || !agentApi) {
      return { success: false, error: 'No project loaded' }
    }

    return agentApi.commit(project.id, { message, messageId })
  }

  /**
   * Pull latest changes
   */
  async pull(): Promise<{ success: boolean; error?: string }> {
    const project = this.currentProject.getState()
    if (!project || !agentApi) {
      return { success: false, error: 'No project loaded' }
    }

    const result = await agentApi.pull(project.id)
    if (result.success) {
      await this.refreshFiles()
    }
    return result
  }

  // View management
  setActiveView(view: WorkbenchViewType): void {
    this.activeView.setState(view, true)
  }

  setSelectedFile(filePath: string | undefined): void {
    this.selectedFile.setState(filePath, true)
  }

  // Get file content
  getFileContent(filePath: string): string | undefined {
    const file = this.files.getState()[filePath]
    if (file?.type === 'file') {
      return file.content
    }
    return undefined
  }

  // Chat management
  addMessage(message: ChatMessage): void {
    const currentMessages = this.messages.getState()
    this.messages.setState([...currentMessages, message], true)
  }

  setMessages(messages: ChatMessage[]): void {
    this.messages.setState(messages, true)
  }

  setChatStreaming(streaming: boolean): void {
    this.chatStreaming.setState(streaming, true)
  }

  // Preview error management
  setPromptError(error: string): void {
    this.promptError.setState(error, true)
  }

  clearPromptError(): void {
    this.promptError.setState('', true)
  }

  // Terminal command execution
  async runTerminalCommand(command: string, terminalId?: string): Promise<void> {
    if (terminalRunner) {
      await terminalRunner(command, terminalId)
    } else {
      console.warn('[ProjectStore] No terminal runner registered')
    }
  }

  // File count helper
  get filesCount(): number {
    return Object.keys(this.files.getState()).length
  }

  #subscribeToFileChanges(projectId: string): void {
    if (!agentApi) return

    // Cleanup existing subscription
    if (this.#fileChangeUnsubscribe) {
      this.#fileChangeUnsubscribe()
    }

    // Subscribe to file changes
    this.#fileChangeUnsubscribe = agentApi.onFileChange((event) => {
      if (event.projectId !== projectId) return

      console.log(`[ProjectStore] File ${event.type}: ${event.relativePath}`)

      // Refresh files on any change
      // This is simple but effective - we reload all files
      // Could be optimized to only update the changed file
      this.refreshFiles()
    })
  }
}

export const projectStore = new ProjectStore()

// Re-export for backward compatibility during migration
export { projectStore as workbenchStore }
