/**
 * Sidecar API — direct imports replacing window.conveyor
 *
 * This module provides typed access to all sidecar API namespaces.
 * Components import from here instead of using the window.conveyor global.
 *
 * Usage:
 *   import { terminal, filesystem, aiAgent } from '@/app/api/sidecar'
 *   await terminal.create(id, cwd)
 *   await filesystem.readFile(path)
 *   await aiAgent.createSession(options)
 */

export {
  windowBridge as window,
  terminalBridge as terminal,
  filesystemBridge as filesystem,
  aiAgentBridge as aiAgent,
  projectSyncBridge as projectSync,
  projectFilesBridge as projectFiles,
  providerBridge as provider,
  deployBridge as deploy,
  secretsBridge as secrets,
  localProjectsBridge as localProjects,
  templateBridge as template,
  appBridge as app,
  screenshotBridge as screenshot,
} from '@/packages/desktop/src/conveyor-bridge'

// Re-export core API client for advanced use cases
export {
  getSidecarApiSync,
  getSidecarApi,
  type SidecarApi,
} from '@/packages/desktop/src/api'
