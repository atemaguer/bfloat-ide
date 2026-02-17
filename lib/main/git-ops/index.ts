import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

const execAsync = promisify(exec)

// Get git access token from environment (for authenticated git operations)
const GIT_ACCESS_TOKEN = process.env.GIT_ACCESS_TOKEN || ''

/**
 * Add authentication token to git URL if needed
 * For HTTPS URLs, embeds the token. For SSH URLs, returns as-is.
 */
function addAuthToken(url: string): string {
  if (!GIT_ACCESS_TOKEN) {
    return url
  }

  try {
    const urlObj = new URL(url)
    // Only modify HTTPS URLs
    if (urlObj.protocol === 'https:') {
      return `${urlObj.protocol}//${GIT_ACCESS_TOKEN}@${urlObj.host}${urlObj.pathname}`
    }
  } catch {
    // URL parsing failed, return as-is
  }

  return url
}

/**
 * Get authenticated URL for git operations (push, pull, clone)
 */
function getAuthUrl(url: string): string {
  return addAuthToken(url)
}

export interface FileChange {
  path: string
  content?: string
  type: 'write' | 'delete'
}

export interface GitOps {
  projectPath: string
  remoteUrl: string

  /** Clone the repository to projectPath */
  clone(): Promise<void>

  /** Initialize a new git repository, stage all files, and make an initial commit */
  initRepo(commitMessage?: string): Promise<void>

  /** Pull latest changes with rebase */
  pull(): Promise<void>

  /** Write a file to the project */
  writeFile(filePath: string, content: string | Buffer): Promise<void>

  /** Read a file from the project */
  readFile(filePath: string): Promise<string>

  /** Read a binary file from the project */
  readBinaryFile(filePath: string): Promise<Buffer>

  /** Delete a file from the project */
  deleteFile(filePath: string): Promise<void>

  /** Stage all changes, commit, and push */
  commitAndPush(message: string): Promise<void>

  /** Create a tag and push it */
  tag(name: string): Promise<void>

  /** List all tracked files */
  listFiles(): Promise<string[]>

  /** Check if project is already cloned */
  isCloned(): Promise<boolean>

  /** Get current branch */
  getCurrentBranch(): Promise<string>

  /** Check if there are uncommitted changes */
  hasChanges(): Promise<boolean>
}

export function createGitOps(projectPath: string, remoteUrl: string): GitOps {
  const git = (cmd: string) => execAsync(`git -C "${projectPath}" ${cmd}`)

  return {
    projectPath,
    remoteUrl,

    async clone() {
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(projectPath), { recursive: true })
      const authUrl = getAuthUrl(remoteUrl)
      await execAsync(`git clone "${authUrl}" "${projectPath}"`)
      console.log(`[GitOps] Cloned ${remoteUrl} to ${projectPath}`)

      // Set the remote URL with auth for subsequent operations
      await execAsync(`git -C "${projectPath}" remote set-url origin "${authUrl}"`)
    },

    async initRepo(commitMessage = 'Initial commit from template') {
      // Ensure project directory exists
      await fs.mkdir(projectPath, { recursive: true })

      // Configure a temporary git user identity for the initial commit if not set
      const gitUserName = await execAsync('git config --global user.name').then(
        ({ stdout }) => stdout.trim(),
        () => ''
      )
      const gitUserEmail = await execAsync('git config --global user.email').then(
        ({ stdout }) => stdout.trim(),
        () => ''
      )

      await execAsync(`git -C "${projectPath}" init`)
      console.log(`[GitOps] Initialized git repository at ${projectPath}`)

      // Set local identity if global one is not configured
      if (!gitUserName) {
        await git('config user.name "bfloat"')
      }
      if (!gitUserEmail) {
        await git('config user.email "bfloat@local"')
      }

      await git('add -A')

      // Check if there are any files to commit
      const { stdout: status } = await git('status --porcelain')
      if (status.trim()) {
        const escapedMessage = commitMessage.replace(/"/g, '\\"')
        await git(`commit -m "${escapedMessage}"`)
        console.log(`[GitOps] Created initial commit: ${commitMessage}`)
      } else {
        console.log(`[GitOps] No files to commit after template initialization`)
      }
    },

    async pull() {
      try {
        await git('pull --rebase')
        console.log(`[GitOps] Pulled latest changes`)
      } catch (error) {
        // If rebase fails, try regular pull
        console.warn(`[GitOps] Rebase failed, trying regular pull`)
        await git('pull')
      }
    },

    async writeFile(filePath: string, content: string | Buffer) {
      const fullPath = path.join(projectPath, filePath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })

      if (Buffer.isBuffer(content)) {
        await fs.writeFile(fullPath, content)
      } else {
        await fs.writeFile(fullPath, content, 'utf-8')
      }
      console.log(`[GitOps] Wrote file: ${filePath}`)
    },

    async readFile(filePath: string) {
      const fullPath = path.join(projectPath, filePath)
      return fs.readFile(fullPath, 'utf-8')
    },

    async readBinaryFile(filePath: string) {
      const fullPath = path.join(projectPath, filePath)
      return fs.readFile(fullPath)
    },

    async deleteFile(filePath: string) {
      const fullPath = path.join(projectPath, filePath)
      await fs.unlink(fullPath)
      console.log(`[GitOps] Deleted file: ${filePath}`)
    },

    async commitAndPush(message: string) {
      await git('add -A')

      // Check if there's anything to commit
      const { stdout: status } = await git('status --porcelain')
      if (!status.trim()) {
        console.log(`[GitOps] Nothing to commit`)
        return
      }

      // Escape message for shell
      const escapedMessage = message.replace(/"/g, '\\"')
      await git(`commit -m "${escapedMessage}"`)

      // For push, use authenticated URL by setting the remote
      const authUrl = getAuthUrl(remoteUrl)
      await git(`push "${authUrl}"`)
      console.log(`[GitOps] Committed and pushed: ${message}`)
    },

    async tag(name: string) {
      await git(`tag "${name}"`)
      const authUrl = getAuthUrl(remoteUrl)
      await git(`push "${authUrl}" --tags`)
      console.log(`[GitOps] Created and pushed tag: ${name}`)
    },

    async listFiles() {
      const { stdout } = await git('ls-files')
      return stdout
        .trim()
        .split('\n')
        .filter((f) => f.length > 0)
    },

    async isCloned() {
      try {
        await fs.access(path.join(projectPath, '.git'))
        return true
      } catch {
        return false
      }
    },

    async getCurrentBranch() {
      const { stdout } = await git('rev-parse --abbrev-ref HEAD')
      return stdout.trim()
    },

    async hasChanges() {
      const { stdout } = await git('status --porcelain')
      return stdout.trim().length > 0
    },
  }
}
