/**
 * Template Handler
 *
 * Handles copying project templates to initialize new projects.
 * Templates are bundled with the app in resources/templates/.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { handle } from '@/lib/main/shared'

// Template types mapped to folder names
type TemplateType = 'expo' | 'nextjs' | 'mobile' | 'web'

// Map app types to template folders
const TEMPLATE_MAP: Record<string, string> = {
  expo: 'expo-default',
  mobile: 'expo-default',
  nextjs: 'nextjs-default',
  vite: 'nextjs-default', // Use nextjs template for web apps
  web: 'nextjs-default',
  node: 'nextjs-default',
}

/**
 * Get the path to bundled templates
 * In development: resources/templates (relative to project root)
 * In production: extraResources/templates
 */
function getTemplatesBasePath(): string {
  if (app.isPackaged) {
    // In production, templates are in extraResources
    return path.join(process.resourcesPath, 'templates')
  } else {
    // In development with electron-vite, app.getAppPath() returns out/main/
    // We need to go up to find resources/templates
    const appPath = app.getAppPath()
    // Check if we're in the out/main directory (electron-vite dev mode)
    if (appPath.endsWith('out/main') || appPath.endsWith('out\\main')) {
      // Go up two levels to project root
      return path.join(appPath, '..', '..', 'resources', 'templates')
    }
    // Fallback for other dev scenarios
    return path.join(appPath, 'resources', 'templates')
  }
}

/**
 * Get the template path for a given app type
 */
function getTemplatePath(appType: string): string {
  const templateFolder = TEMPLATE_MAP[appType] || TEMPLATE_MAP.web
  return path.join(getTemplatesBasePath(), templateFolder)
}

/**
 * Copy a directory recursively
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })

  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Initialize a project directory from a template
 */
export async function initializeFromTemplate(
  projectPath: string,
  appType: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[TemplateHandler] initializeFromTemplate called:`, {
      projectPath,
      appType,
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    })

    const basePath = getTemplatesBasePath()
    const templatePath = getTemplatePath(appType)
    console.log(`[TemplateHandler] Template paths:`, {
      basePath,
      templatePath,
    })

    // Check if template exists
    try {
      await fs.access(templatePath)
      console.log(`[TemplateHandler] Template exists at ${templatePath}`)
    } catch (accessErr) {
      console.error(`[TemplateHandler] Template not found at ${templatePath}:`, accessErr)
      return { success: false, error: `Template not found for app type: ${appType} at ${templatePath}` }
    }

    // Check if project directory already has files
    try {
      const existingFiles = await fs.readdir(projectPath)
      if (existingFiles.length > 0 && existingFiles.some(f => f !== '.git')) {
        console.log(`[TemplateHandler] Project directory already has files, skipping template copy`)
        return { success: true }
      }
    } catch {
      // Directory doesn't exist or is empty, continue with template copy
    }

    console.log(`[TemplateHandler] Copying template from ${templatePath} to ${projectPath}`)

    // Ensure project directory exists
    await fs.mkdir(projectPath, { recursive: true })

    // Copy template files
    await copyDirectory(templatePath, projectPath)

    console.log(`[TemplateHandler] Template initialized successfully`)
    return { success: true }
  } catch (error) {
    console.error(`[TemplateHandler] Failed to initialize template:`, error)
    return { success: false, error: String(error) }
  }
}

/**
 * Get list of available templates
 */
async function listTemplates(): Promise<{ id: string; name: string; type: string }[]> {
  try {
    const templatesPath = getTemplatesBasePath()
    const entries = await fs.readdir(templatesPath, { withFileTypes: true })

    const templates: { id: string; name: string; type: string }[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Read launch.json to get template type
        try {
          const launchPath = path.join(templatesPath, entry.name, '.bfloat-ide', 'launch.json')
          const launchContent = await fs.readFile(launchPath, 'utf-8')
          const launchConfig = JSON.parse(launchContent)

          templates.push({
            id: entry.name,
            name: entry.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            type: launchConfig.type || 'web',
          })
        } catch {
          // No launch.json, skip this template
        }
      }
    }

    return templates
  } catch (error) {
    console.error(`[TemplateHandler] Failed to list templates:`, error)
    return []
  }
}

export function registerTemplateHandlers(): void {
  // Initialize project from template
  handle(
    'template:initialize',
    async (config: { projectPath: string; appType: string }) => {
      return initializeFromTemplate(config.projectPath, config.appType)
    }
  )

  // List available templates
  handle('template:list', async () => {
    return listTemplates()
  })

  // Get template path for app type
  handle('template:get-path', async (appType: string) => {
    return getTemplatePath(appType)
  })

  console.log('[TemplateHandler] Registered template handlers')
}
