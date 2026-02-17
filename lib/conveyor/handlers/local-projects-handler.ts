/**
 * Local Projects Handler
 *
 * IPC handler for local-first project management.
 * Stores project metadata in ~/.bfloat-ide/projects.json
 */

import { ipcMain } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import type { Project, AgentSession } from '@/app/types/project'

const BFLOAT_DIR = join(homedir(), '.bfloat-ide')
const PROJECTS_FILE = join(BFLOAT_DIR, 'projects.json')

async function ensureDir(): Promise<void> {
  if (!existsSync(BFLOAT_DIR)) {
    await mkdir(BFLOAT_DIR, { recursive: true })
  }
}

async function readProjects(): Promise<Project[]> {
  await ensureDir()

  if (!existsSync(PROJECTS_FILE)) {
    return []
  }

  try {
    const content = await readFile(PROJECTS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error('[LocalProjectsHandler] Failed to read projects:', error)
    return []
  }
}

async function writeProjects(projects: Project[]): Promise<void> {
  await ensureDir()
  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2))
}

export function registerLocalProjectsHandlers(): void {
  console.log('[LocalProjectsHandler] Registering handlers...')

  // List all projects
  ipcMain.handle('local-projects:list', async (): Promise<Project[]> => {
    console.log('[LocalProjectsHandler] list called')
    const projects = await readProjects()
    console.log('[LocalProjectsHandler] returning', projects.length, 'projects')
    return projects
  })

  // Get a single project
  ipcMain.handle('local-projects:get', async (_, id: string): Promise<Project | null> => {
    const projects = await readProjects()
    return projects.find((p) => p.id === id) || null
  })

  // Create a new project
  ipcMain.handle('local-projects:create', async (_, project: Project): Promise<void> => {
    console.log('[LocalProjectsHandler] create called with project:', project.id, project.title)
    const projects = await readProjects()
    projects.push(project)
    await writeProjects(projects)
    console.log('[LocalProjectsHandler] project created, total:', projects.length)
  })

  // Update a project
  ipcMain.handle('local-projects:update', async (_, project: Project): Promise<void> => {
    const projects = await readProjects()
    const index = projects.findIndex((p) => p.id === project.id)

    if (index === -1) {
      throw new Error(`Project not found: ${project.id}`)
    }

    projects[index] = project
    await writeProjects(projects)
  })

  // Delete a project
  ipcMain.handle('local-projects:delete', async (_, id: string): Promise<void> => {
    const projects = await readProjects()
    const filtered = projects.filter((p) => p.id !== id)
    await writeProjects(filtered)
  })

  // ============================================================================
  // Session Management
  // ============================================================================

  // List sessions for a project
  ipcMain.handle(
    'local-projects:list-sessions',
    async (_, projectId: string): Promise<AgentSession[]> => {
      const projects = await readProjects()
      const project = projects.find((p) => p.id === projectId)
      return project?.sessions || []
    }
  )

  // Add a session to a project
  ipcMain.handle(
    'local-projects:add-session',
    async (_, projectId: string, session: AgentSession): Promise<void> => {
      console.log('[LocalProjectsHandler] ========================================')
      console.log('[LocalProjectsHandler] ADD SESSION REQUEST')
      console.log('[LocalProjectsHandler] Project ID:', projectId)
      console.log('[LocalProjectsHandler] Session:', JSON.stringify(session, null, 2))
      console.log('[LocalProjectsHandler] ========================================')

      const projects = await readProjects()
      const index = projects.findIndex((p) => p.id === projectId)

      if (index === -1) {
        console.error('[LocalProjectsHandler] Project not found:', projectId)
        throw new Error(`Project not found: ${projectId}`)
      }

      console.log('[LocalProjectsHandler] Found project at index:', index)
      console.log('[LocalProjectsHandler] Project title:', projects[index].title)
      console.log('[LocalProjectsHandler] Existing sessions count:', projects[index].sessions?.length || 0)

      // Initialize sessions array if needed
      if (!projects[index].sessions) {
        projects[index].sessions = []
        console.log('[LocalProjectsHandler] Initialized empty sessions array')
      }

      // Check if session already exists (by sessionId)
      const existingIndex = projects[index].sessions!.findIndex(
        (s) => s.sessionId === session.sessionId
      )

      if (existingIndex >= 0) {
        // Update existing session
        projects[index].sessions![existingIndex] = session
        console.log('[LocalProjectsHandler] Updated existing session at index:', existingIndex)
      } else {
        // Add new session
        projects[index].sessions!.push(session)
        console.log('[LocalProjectsHandler] Added new session, total count:', projects[index].sessions!.length)
      }

      // Update project's updatedAt
      projects[index].updatedAt = new Date().toISOString()

      await writeProjects(projects)
      console.log('[LocalProjectsHandler] ========================================')
      console.log('[LocalProjectsHandler] SUCCESS - Session saved to projects.json')
      console.log('[LocalProjectsHandler] Session ID:', session.sessionId)
      console.log('[LocalProjectsHandler] Project ID:', projectId)
      console.log('[LocalProjectsHandler] ========================================')
    }
  )

  // Update a session
  ipcMain.handle(
    'local-projects:update-session',
    async (_, projectId: string, sessionId: string, updates: Partial<AgentSession>): Promise<void> => {
      const projects = await readProjects()
      const projectIndex = projects.findIndex((p) => p.id === projectId)

      if (projectIndex === -1) {
        throw new Error(`Project not found: ${projectId}`)
      }

      const sessions = projects[projectIndex].sessions || []
      const sessionIndex = sessions.findIndex((s) => s.sessionId === sessionId)

      if (sessionIndex === -1) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      // Merge updates
      sessions[sessionIndex] = { ...sessions[sessionIndex], ...updates }
      projects[projectIndex].sessions = sessions
      projects[projectIndex].updatedAt = new Date().toISOString()

      await writeProjects(projects)
      console.log('[LocalProjectsHandler] Updated session:', sessionId)
    }
  )

  // Delete a session
  ipcMain.handle(
    'local-projects:delete-session',
    async (_, projectId: string, sessionId: string): Promise<void> => {
      const projects = await readProjects()
      const projectIndex = projects.findIndex((p) => p.id === projectId)

      if (projectIndex === -1) {
        throw new Error(`Project not found: ${projectId}`)
      }

      const sessions = projects[projectIndex].sessions || []
      projects[projectIndex].sessions = sessions.filter((s) => s.sessionId !== sessionId)
      projects[projectIndex].updatedAt = new Date().toISOString()

      await writeProjects(projects)
      console.log('[LocalProjectsHandler] Deleted session:', sessionId, 'from project:', projectId)
    }
  )
}
