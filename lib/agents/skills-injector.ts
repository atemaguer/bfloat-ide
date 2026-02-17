/**
 * SkillsInjector - Injects bundled skills into project directories
 *
 * Skills are bundled with the Electron app and injected locally into projects.
 * This ensures proprietary skills are never committed to git (they're gitignored).
 */

import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'

// Logging prefix
const LOG_PREFIX = '[SkillsInjector]'

// Version file name for tracking skill updates
const VERSION_FILE = '.bfloat-skills-version'

interface SkillsVersion {
  version: string
  updatedAt: string
  skills: {
    claude: string[]
    codex: string[]
  }
}

/**
 * Get the path to bundled skills in app resources
 */
function getBundledSkillsPath(): string {
  // In development, resources are relative to the lib/agents directory
  // In production (packaged app), they're in the resources folder
  const devPath = path.join(__dirname, '../../resources/skills')
  const prodPath = path.join(process.resourcesPath || '', 'skills')

  // Check which path exists
  if (existsSync(devPath)) {
    console.log(`${LOG_PREFIX} Using development skills path: ${devPath}`)
    return devPath
  }

  console.log(`${LOG_PREFIX} Using production skills path: ${prodPath}`)
  return prodPath
}

/**
 * Read the bundled skills version
 */
async function getBundledVersion(): Promise<SkillsVersion | null> {
  const skillsPath = getBundledSkillsPath()
  const versionPath = path.join(skillsPath, 'version.json')

  try {
    const content = await fs.readFile(versionPath, 'utf-8')
    return JSON.parse(content) as SkillsVersion
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to read bundled version:`, error)
    return null
  }
}

/**
 * Read the project's installed skills version
 */
async function getProjectVersion(projectPath: string): Promise<string | null> {
  const versionPath = path.join(projectPath, '.claude', VERSION_FILE)

  try {
    const content = await fs.readFile(versionPath, 'utf-8')
    return content.trim()
  } catch {
    return null
  }
}

/**
 * Copy a directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })

  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Check if skills need to be injected or updated
 */
export async function needsSkillsInjection(projectPath: string): Promise<boolean> {
  const bundledVersion = await getBundledVersion()
  if (!bundledVersion) {
    console.log(`${LOG_PREFIX} No bundled skills found`)
    return false
  }

  const projectVersion = await getProjectVersion(projectPath)

  if (!projectVersion) {
    console.log(`${LOG_PREFIX} No skills installed in project - injection needed`)
    return true
  }

  if (projectVersion !== bundledVersion.version) {
    console.log(`${LOG_PREFIX} Skills version mismatch: project=${projectVersion}, bundled=${bundledVersion.version}`)
    return true
  }

  console.log(`${LOG_PREFIX} Skills are up to date (version ${projectVersion})`)
  return false
}

/**
 * Claude Code settings to allow npm/bun commands to run without permission prompts.
 * These settings configure the sandbox to exclude package managers (which need network access)
 * and auto-allow common development commands.
 */
const CLAUDE_SETTINGS = {
  permissions: {
    allow: [
      // Package managers
      'Bash(npm install *)',
      'Bash(npm run *)',
      'Bash(npm uninstall *)',
      'Bash(npm ci*)',
      'Bash(npx *)',
      'Bash(bun install *)',
      'Bash(bun run *)',
      'Bash(bun add *)',
      'Bash(bun remove *)',
      'Bash(bunx *)',
      'Bash(yarn install *)',
      'Bash(yarn add *)',
      'Bash(yarn remove *)',
      'Bash(pnpm install *)',
      'Bash(pnpm add *)',
      'Bash(pnpm remove *)',
      'Bash(pnpm run *)',
      // npx wrappers (explicit)
      'Bash(npx expo *)',
      'Bash(npx convex *)',
      'Bash(npx eas *)',
      // Common dev commands
      'Bash(git *)',
      'Bash(expo *)',
      'Bash(eas *)',
      // Build tools
      'Bash(tsc *)',
      'Bash(node *)',
      // File system
      'Bash(mkdir *)',
      'Bash(ls *)',
      'Bash(cat *)',
      'Bash(find *)',
      'Bash(grep *)',
      // Core tools
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      // Skills and subagents
      'Skill(*)',
      'Task',
    ],
  },
  sandbox: {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    // Commands that need network access must run outside the sandbox
    excludedCommands: ['npm', 'npx', 'bun', 'bunx', 'yarn', 'pnpm', 'git', 'expo', 'eas'],
  },
}

/**
 * Inject skills into a project directory
 */
export async function injectSkills(projectPath: string): Promise<void> {
  console.log(`${LOG_PREFIX} Injecting skills into: ${projectPath}`)

  const skillsPath = getBundledSkillsPath()
  const bundledVersion = await getBundledVersion()

  if (!bundledVersion) {
    console.error(`${LOG_PREFIX} No bundled skills version found`)
    return
  }

  // Ensure .claude directory exists
  const claudeDir = path.join(projectPath, '.claude')
  await fs.mkdir(claudeDir, { recursive: true })

  // Inject Claude settings.local.json for permissions
  // Always overwrite to ensure latest permissions are applied
  const settingsPath = path.join(claudeDir, 'settings.local.json')
  console.log(`${LOG_PREFIX} Writing Claude settings.local.json with latest permissions...`)
  await fs.writeFile(settingsPath, JSON.stringify(CLAUDE_SETTINGS, null, 2), 'utf-8')
  console.log(`${LOG_PREFIX} Claude settings written`)

  // Clean stale skills before copying
  const claudeSkillsDest = path.join(projectPath, '.claude', 'skills')
  const codexSkillsDest = path.join(projectPath, '.agents', 'skills')

  await fs.rm(claudeSkillsDest, { recursive: true, force: true })
  await fs.rm(codexSkillsDest, { recursive: true, force: true })

  // Inject Claude skills (selective copy from version.json list)
  // Flatten nested paths (e.g. "convex/setup" → "convex-setup") so Claude Code
  // discovers them — it only looks one level deep inside .claude/skills/.
  console.log(`${LOG_PREFIX} Copying Claude skills...`)
  for (const skillName of bundledVersion.skills.claude) {
    const src = path.join(skillsPath, skillName)
    const flatName = skillName.replace(/\//g, '-')
    const dest = path.join(claudeSkillsDest, flatName)
    if (existsSync(src)) {
      await copyDir(src, dest)
    } else {
      console.warn(`${LOG_PREFIX} Claude skill not found: ${skillName}`)
    }
  }
  console.log(`${LOG_PREFIX} Claude skills copied: ${bundledVersion.skills.claude.join(', ')}`)

  // Inject Codex skills (selective copy from version.json list)
  console.log(`${LOG_PREFIX} Copying Codex skills...`)
  for (const skillName of bundledVersion.skills.codex) {
    const src = path.join(skillsPath, skillName)
    const flatName = skillName.replace(/\//g, '-')
    const dest = path.join(codexSkillsDest, flatName)
    if (existsSync(src)) {
      await copyDir(src, dest)
    } else {
      console.warn(`${LOG_PREFIX} Codex skill not found: ${skillName}`)
    }
  }
  console.log(`${LOG_PREFIX} Codex skills copied: ${bundledVersion.skills.codex.join(', ')}`)

  // Write version marker file
  const versionPath = path.join(projectPath, '.claude', VERSION_FILE)
  await fs.writeFile(versionPath, bundledVersion.version, 'utf-8')
  console.log(`${LOG_PREFIX} Version marker written: ${bundledVersion.version}`)

  console.log(`${LOG_PREFIX} Skills injection complete`)
}

/**
 * Main entry point - inject skills if needed
 */
export async function ensureSkillsInjected(projectPath: string): Promise<void> {
  try {
    if (await needsSkillsInjection(projectPath)) {
      await injectSkills(projectPath)
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to inject skills:`, error)
    // Don't throw - skills injection failure shouldn't block project opening
  }
}
