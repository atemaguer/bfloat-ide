import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { handle } from '@/lib/main/shared'

// Get the local network IP address
const getLocalNetworkIP = (): string | null => {
  const interfaces = os.networkInterfaces()

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue

    for (const alias of iface) {
      // Look for IPv4, non-internal addresses
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address
      }
    }
  }

  return null
}

// Track project directories created by the app
const projectDirectories = new Map<string, string>()

// Get the .bfloat-ide directory path in the user's home directory
const getBfloatBasePath = (): string => {
  return path.join(os.homedir(), '.bfloat-ide')
}

export const registerFilesystemHandlers = () => {
  // Create a project directory in ~/.bfloat-ide
  handle('filesystem-create-temp-dir', (projectId: string): { success: boolean; path?: string; error?: string } => {
    try {
      // Create the .bfloat-ide directory in user's home if it doesn't exist
      const bfloatBase = getBfloatBasePath()

      // Ensure base .bfloat-ide directory exists
      if (!fs.existsSync(bfloatBase)) {
        fs.mkdirSync(bfloatBase, { recursive: true })
        console.log(`[Filesystem] Created .bfloat-ide directory: ${bfloatBase}`)
      }
      
      // Create project-specific directory
      const projectDir = path.join(bfloatBase, `project-${projectId}`)

      // Create directory if it doesn't exist, otherwise reuse existing
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true })
        console.log(`[Filesystem] Created project directory: ${projectDir}`)
      } else {
        console.log(`[Filesystem] Reusing existing project directory: ${projectDir}`)
      }

      // Store the path for later cleanup
      projectDirectories.set(projectId, projectDir)
      
      return { success: true, path: projectDir }
    } catch (error) {
      console.error(`[Filesystem] Failed to create project directory:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Write multiple files to a base path
  handle('filesystem-write-files', (basePath: string, files: Array<{ path: string; content: string }>): { success: boolean; error?: string } => {
    try {
      for (const file of files) {
        const filePath = path.join(basePath, file.path)
        const fileDir = path.dirname(filePath)
        
        // Ensure directory exists
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true })
        }
        
        // Write file content
        fs.writeFileSync(filePath, file.content, 'utf-8')
        console.log(`[Filesystem] Wrote file: ${filePath}`)
      }
      
      return { success: true }
    } catch (error) {
      console.error(`[Filesystem] Failed to write files:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Get the project path for a project
  handle('filesystem-get-temp-path', (projectId: string): string => {
    const existing = projectDirectories.get(projectId)
    if (existing) {
      return existing
    }
    // Return the expected path even if not created yet
    return path.join(getBfloatBasePath(), `project-${projectId}`)
  })

  // Clean up a project directory
  handle('filesystem-cleanup-temp-dir', (dirPath: string): { success: boolean; error?: string } => {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true })
        console.log(`[Filesystem] Cleaned up directory: ${dirPath}`)

        // Remove from tracking
        for (const [projectId, p] of projectDirectories.entries()) {
          if (p === dirPath) {
            projectDirectories.delete(projectId)
            break
          }
        }
      }
      return { success: true }
    } catch (error) {
      console.error(`[Filesystem] Failed to cleanup directory:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Get the local network IP address
  handle('filesystem-get-network-ip', (): string | null => {
    const ip = getLocalNetworkIP()
    console.log(`[Filesystem] Local network IP: ${ip || 'not found'}`)
    return ip
  })

  // Read a single file
  handle('filesystem-read-file', (filePath: string): { success: boolean; content?: string; error?: string } => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      console.log(`[Filesystem] Read file: ${filePath}`)
      return { success: true, content }
    } catch (error) {
      console.error(`[Filesystem] Failed to read file:`, error)
      return { success: false, error: String(error) }
    }
  })

  // Write a single file
  handle('filesystem-write-file', (filePath: string, content: string): { success: boolean; error?: string } => {
    try {
      // Ensure directory exists
      const fileDir = path.dirname(filePath)
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true })
      }

      fs.writeFileSync(filePath, content, 'utf-8')
      console.log(`[Filesystem] Wrote file: ${filePath}`)
      return { success: true }
    } catch (error) {
      console.error(`[Filesystem] Failed to write file:`, error)
      return { success: false, error: String(error) }
    }
  })
}

// Clean up all project directories on app quit
export const cleanupAllTempDirectories = () => {
  console.log(`[Filesystem] Cleaning up ${projectDirectories.size} project directories`)
  for (const [projectId, dirPath] of projectDirectories.entries()) {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true })
        console.log(`[Filesystem] Cleaned up: ${dirPath}`)
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
  projectDirectories.clear()
}

