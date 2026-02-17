/**
 * Local Projects API
 *
 * Renderer-side API for local-first project management.
 * Stores projects in ~/.bfloat-ide/projects.json
 */

import { ConveyorApi } from '@/lib/preload/shared'
import type { Project, AgentSession } from '@/app/types/project'

export class LocalProjectsApi extends ConveyorApi {
  /**
   * List all projects
   * Note: Using renderer.invoke directly because these channels aren't in the typed schema
   */
  list = (): Promise<Project[]> => this.renderer.invoke('local-projects:list') as Promise<Project[]>

  /**
   * Get a single project
   */
  get = (id: string): Promise<Project | null> =>
    this.renderer.invoke('local-projects:get', id) as Promise<Project | null>

  /**
   * Create a new project
   */
  create = (project: Project): Promise<void> =>
    this.renderer.invoke('local-projects:create', project) as Promise<void>

  /**
   * Update a project
   */
  update = (project: Project): Promise<void> =>
    this.renderer.invoke('local-projects:update', project) as Promise<void>

  /**
   * Delete a project
   */
  delete = (id: string): Promise<void> =>
    this.renderer.invoke('local-projects:delete', id) as Promise<void>

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * List all sessions for a project
   */
  listSessions = (projectId: string): Promise<AgentSession[]> =>
    this.renderer.invoke('local-projects:list-sessions', projectId) as Promise<AgentSession[]>

  /**
   * Add or update a session for a project
   */
  addSession = (projectId: string, session: AgentSession): Promise<void> =>
    this.renderer.invoke('local-projects:add-session', projectId, session) as Promise<void>

  /**
   * Update a session
   */
  updateSession = (
    projectId: string,
    sessionId: string,
    updates: Partial<AgentSession>
  ): Promise<void> =>
    this.renderer.invoke('local-projects:update-session', projectId, sessionId, updates) as Promise<void>

  /**
   * Delete a session
   */
  deleteSession = (projectId: string, sessionId: string): Promise<void> =>
    this.renderer.invoke('local-projects:delete-session', projectId, sessionId) as Promise<void>
}
