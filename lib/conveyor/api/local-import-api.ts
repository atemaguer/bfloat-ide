/**
 * Local Import API
 *
 * Renderer-side API for importing local project folders.
 * Handles the import process: folder selection, copy, analyze, complete.
 */

import { ConveyorApi } from '@/lib/preload/shared'

// Define types inline to avoid importing from main process modules
type AgentProviderId = 'claude' | 'codex' | 'bfloat'

// Simplified agent message type for streaming
interface AgentMessage {
  type: string
  content?: {
    text?: string
    toolName?: string
    [key: string]: unknown
  }
}

// Types for local import
export interface LocalImportSelectResult {
  success: boolean
  folderPath?: string
  folderName?: string
  error?: string
}

export interface LocalImportStartResult {
  success: boolean
  projectId?: string
  projectPath?: string
  giteaUrl?: string
  error?: string
}

export interface LocalImportAnalyzeResult {
  success: boolean
  sessionId?: string
  appType?: string
  error?: string
}

export interface LocalImportCompleteResult {
  success: boolean
  error?: string
}

export interface LocalImportProgressData {
  stage: 'validating' | 'copying' | 'initializing' | 'analyzing' | 'syncing' | 'complete' | 'failed'
  message: string
  projectId?: string
}

export class LocalImportApi extends ConveyorApi {
  /**
   * Open folder selection dialog
   */
  selectFolder = (): Promise<LocalImportSelectResult> =>
    this.invoke('local-import:select-folder')

  /**
   * Start local import: create project, clone Gitea repo, copy local files
   */
  start = (config: {
    folderPath: string
    folderName: string
    provider: AgentProviderId
    token: string
    appType?: 'mobile' | 'web'
  }): Promise<LocalImportStartResult> => this.invoke('local-import:start', config)

  /**
   * Analyze project with Claude/Codex agent
   */
  analyze = (config: {
    projectId: string
    projectPath: string
    giteaUrl: string
    provider: AgentProviderId
  }): Promise<LocalImportAnalyzeResult> => this.invoke('local-import:analyze', config)

  /**
   * Complete import: update project status in backend
   */
  complete = (config: {
    projectId: string
    success: boolean
    appType?: string
    error?: string
    token: string
  }): Promise<LocalImportCompleteResult> => this.invoke('local-import:complete', config)

  /**
   * Subscribe to import progress events
   */
  onProgress = (callback: (data: LocalImportProgressData) => void) =>
    this.on<LocalImportProgressData>('local-import:progress', callback)

  /**
   * Subscribe to agent analysis stream for a specific project
   */
  onAnalysisStream = (
    projectId: string,
    callback: (message: AgentMessage | { type: 'stream_end' }) => void
  ) => this.on(`local-import:stream:${projectId}`, callback)
}
