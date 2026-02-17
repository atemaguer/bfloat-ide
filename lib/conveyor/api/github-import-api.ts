/**
 * GitHub Import API
 *
 * Renderer-side API for local GitHub repository import.
 * Handles the three-phase import process: start, analyze, complete.
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

// Types for GitHub import
export interface GitHubRepoInfo {
  owner: string
  repo: string
  name: string
  description: string | null
  defaultBranch: string
  cloneUrl: string
  htmlUrl: string
}

export interface GitHubImportStartResult {
  success: boolean
  projectId?: string
  projectPath?: string
  giteaUrl?: string
  repoInfo?: GitHubRepoInfo
  error?: string
}

export interface GitHubImportAnalyzeResult {
  success: boolean
  sessionId?: string
  appType?: string
  error?: string
}

export interface GitHubImportCompleteResult {
  success: boolean
  error?: string
}

export interface GitHubImportProgressData {
  stage: 'validating' | 'cloning' | 'analyzing' | 'syncing' | 'complete' | 'failed'
  message: string
  projectId?: string
}

export class GitHubImportApi extends ConveyorApi {
  /**
   * Start GitHub import: validate URL, create project, clone repo
   */
  start = (config: {
    githubUrl: string
    provider: AgentProviderId
    token: string
  }): Promise<GitHubImportStartResult> => this.invoke('github-import:start', config)

  /**
   * Analyze project with Claude/Codex agent
   */
  analyze = (config: {
    projectId: string
    projectPath: string
    giteaUrl: string
    provider: AgentProviderId
  }): Promise<GitHubImportAnalyzeResult> => this.invoke('github-import:analyze', config)

  /**
   * Complete import: update project status in backend
   */
  complete = (config: {
    projectId: string
    success: boolean
    appType?: string
    error?: string
    token: string
  }): Promise<GitHubImportCompleteResult> => this.invoke('github-import:complete', config)

  /**
   * Subscribe to import progress events
   */
  onProgress = (callback: (data: GitHubImportProgressData) => void) =>
    this.on<GitHubImportProgressData>('github-import:progress', callback)

  /**
   * Subscribe to agent analysis stream for a specific project
   */
  onAnalysisStream = (
    projectId: string,
    callback: (message: AgentMessage | { type: 'stream_end' }) => void
  ) => this.on(`github-import:stream:${projectId}`, callback)
}
