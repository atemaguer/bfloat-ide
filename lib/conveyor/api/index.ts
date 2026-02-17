import { electronAPI } from '@electron-toolkit/preload'
import { WindowApi } from './window-api'
import { TerminalApi } from './terminal-api'
import { FilesystemApi } from './filesystem-api'
import { ProjectSyncApi } from './project-sync-api'
import { ProjectFilesApi } from './project-files-api'
import { ProviderApi } from './provider-api'
import { AIAgentApi } from './ai-agent-api'
import { DeployApi } from './deploy-api'
import { SecretsApi } from './secrets-api'
import { ScreenshotApi } from './screenshot-api'
import { LocalProjectsApi } from './local-projects-api'
import { TemplateApi } from './template-api'

// Note: Removed for local-first architecture:
// - AppApi, GitHubImportApi, LocalImportApi: removed backend dependencies
// - ProjectApi/UserApi: removed (backend-dependent)
// - StripeApi: removed (backend-dependent)
// - UpdateApi: removed (users pull from GitHub)
export const conveyor = {
  window: new WindowApi(electronAPI),
  terminal: new TerminalApi(electronAPI),
  filesystem: new FilesystemApi(electronAPI),
  projectSync: new ProjectSyncApi(electronAPI),
  projectFiles: new ProjectFilesApi(electronAPI),
  provider: new ProviderApi(electronAPI),
  aiAgent: new AIAgentApi(electronAPI),
  deploy: new DeployApi(electronAPI),
  secrets: new SecretsApi(electronAPI),
  screenshot: new ScreenshotApi(electronAPI),
  localProjects: new LocalProjectsApi(electronAPI),
  template: new TemplateApi(electronAPI),
}

export type ConveyorApi = typeof conveyor
export { ProjectSyncApi, ProviderApi, AIAgentApi, DeployApi, SecretsApi, LocalProjectsApi }
