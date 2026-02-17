/**
 * LocalProjectsStore - Local-first project management
 *
 * Stores project metadata in ~/.bfloat-ide/projects.json
 * No backend server required - all operations are local.
 */

import { atom, map, computed } from 'nanostores'
import type { Project, AppType } from '@/app/types/project'

// Generate a unique project ID
function generateProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Generate a project title from prompt
function generateTitle(prompt: string): string {
  // Take first sentence or first 50 chars
  const firstSentence = prompt.split(/[.!?]/)[0]
  const title = firstSentence.length > 50 ? firstSentence.substring(0, 47) + '...' : firstSentence
  return title || 'Untitled Project'
}

class LocalProjectsStore {
  // Project list
  projects = map<Record<string, Project>>({})

  // Loading state
  isLoading = atom(false)

  // Computed: sorted project list
  sortedProjects = computed([this.projects], (projects): Project[] => {
    return Object.values(projects).sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime()
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime()
      return dateB - dateA
    })
  })

  /**
   * Load projects from local storage via IPC
   */
  async load(): Promise<void> {
    this.isLoading.set(true)
    try {
      const projects = await window.conveyor.localProjects.list()
      const projectMap: Record<string, Project> = {}
      for (const project of projects) {
        projectMap[project.id] = project
      }
      this.projects.set(projectMap)
    } catch (error) {
      console.error('[LocalProjectsStore] Failed to load projects:', error)
    } finally {
      this.isLoading.set(false)
    }
  }

  /**
   * Get a single project
   */
  get(id: string): Project | undefined {
    return this.projects.get()[id]
  }

  /**
   * Create a new project from a prompt
   * @param prompt - The project description/prompt
   * @param appType - The type of app (mobile, web, etc.)
   * @param customTitle - Optional title (if provided, skips title generation)
   */
  async createFromPrompt(prompt: string, appType: AppType, customTitle?: string): Promise<Project> {
    const id = generateProjectId()
    const title = customTitle || generateTitle(prompt)
    const now = new Date().toISOString()

    const project: Project = {
      id,
      title,
      description: prompt,
      appType,
      createdAt: now,
      updatedAt: now,
      sourceUrl: null,
    }

    // Save to IPC storage
    await window.conveyor.localProjects.create(project)

    // Update local state
    const current = { ...this.projects.get() }
    current[id] = project
    this.projects.set(current)

    return project
  }

  /**
   * Import a project from GitHub
   */
  async importFromGitHub(repoUrl: string, appType: AppType = 'web'): Promise<Project> {
    const id = generateProjectId()

    // Extract repo name from URL
    const urlParts = repoUrl.replace(/\.git$/, '').split('/')
    const repoName = urlParts[urlParts.length - 1]
    const owner = urlParts[urlParts.length - 2]
    const title = repoName || 'Imported Project'
    const now = new Date().toISOString()

    const project: Project = {
      id,
      title,
      description: `Imported from ${owner}/${repoName}`,
      appType,
      createdAt: now,
      updatedAt: now,
      sourceUrl: repoUrl,
    }

    // Save to IPC storage
    await window.conveyor.localProjects.create(project)

    // Update local state
    const current = { ...this.projects.get() }
    current[id] = project
    this.projects.set(current)

    return project
  }

  /**
   * Import a project from local folder
   */
  async importFromLocal(folderPath: string, appType: AppType = 'web'): Promise<Project> {
    const id = generateProjectId()

    // Extract folder name from path
    const pathParts = folderPath.split(/[/\\]/)
    const folderName = pathParts[pathParts.length - 1]
    const title = folderName || 'Local Project'
    const now = new Date().toISOString()

    const project: Project = {
      id,
      title,
      description: `Imported from ${folderPath}`,
      appType,
      createdAt: now,
      updatedAt: now,
      sourceUrl: folderPath, // For local projects, sourceUrl is the local path
      localPath: folderPath,
    }

    // Save to IPC storage
    await window.conveyor.localProjects.create(project)

    // Update local state
    const current = { ...this.projects.get() }
    current[id] = project
    this.projects.set(current)

    return project
  }

  /**
   * Update a project
   */
  async update(id: string, updates: Partial<Project>): Promise<void> {
    const current = { ...this.projects.get() }
    const project = current[id]

    if (!project) {
      throw new Error(`Project not found: ${id}`)
    }

    const updated: Project = {
      ...project,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    // Save to IPC storage
    await window.conveyor.localProjects.update(updated)

    // Update local state
    current[id] = updated
    this.projects.set(current)
  }

  /**
   * Delete a project
   */
  async delete(id: string): Promise<void> {
    // Delete from IPC storage
    await window.conveyor.localProjects.delete(id)

    // Update local state
    const current = { ...this.projects.get() }
    delete current[id]
    this.projects.set(current)
  }
}

export const localProjectsStore = new LocalProjectsStore()
