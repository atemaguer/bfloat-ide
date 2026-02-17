/**
 * Platform Shell Utilities
 *
 * Provides a unified interface for shell operations across platforms.
 * On Windows, uses bundled MinGit/BusyBox to eliminate external dependencies.
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export interface ShellConfig {
  /** Path to the shell executable */
  shellPath: string
  /** Arguments to pass to the shell for login mode */
  shellArgs: string[]
  /** Environment variables to set */
  env: Record<string, string>
  /** Whether this is a bundled shell (vs system shell) */
  isBundled: boolean
}

export interface ShellPaths {
  /** Path to bash/sh for interactive terminal */
  bash: string
  /** Path to sh for script execution (may be BusyBox on Windows) */
  sh: string
  /** Path to git executable */
  git: string
  /** Base directory for bundled tools */
  vendorDir: string
}

/**
 * Get the vendor directory path based on whether we're in development or production
 */
function getVendorDir(): string {
  const isDev = !app.isPackaged

  if (isDev) {
    // Development: resources/vendor
    return path.join(app.getAppPath(), 'resources', 'vendor')
  } else {
    // Production: resources/vendor (inside asar or extraResources)
    return path.join(process.resourcesPath, 'vendor')
  }
}

/**
 * Get paths to bundled shell tools for Windows
 */
function getWindowsShellPaths(): ShellPaths {
  const vendorDir = path.join(getVendorDir(), 'win32')
  const mingitDir = path.join(vendorDir, 'mingit')

  return {
    bash: path.join(mingitDir, 'usr', 'bin', 'sh.exe'), // sh.exe is bash in MSYS2
    sh: path.join(vendorDir, 'busybox.exe'), // BusyBox for lightweight script execution
    git: path.join(mingitDir, 'cmd', 'git.exe'),
    vendorDir,
  }
}

/**
 * Get paths to system shell tools for Unix (macOS/Linux)
 */
function getUnixShellPaths(): ShellPaths {
  const isMac = process.platform === 'darwin'

  // Prefer zsh on macOS (default since Catalina), bash elsewhere
  const defaultShell = isMac ? '/bin/zsh' : '/bin/bash'
  const fallbackShell = '/bin/sh'

  const shellPath = fs.existsSync(defaultShell) ? defaultShell : fallbackShell

  return {
    bash: shellPath,
    sh: '/bin/sh',
    git: '/usr/bin/git', // Usually in PATH, but provide default
    vendorDir: '', // No vendor dir on Unix
  }
}

/**
 * Get shell paths for the current platform
 */
export function getShellPaths(): ShellPaths {
  if (process.platform === 'win32') {
    return getWindowsShellPaths()
  }
  return getUnixShellPaths()
}

/**
 * Check if bundled shell tools are available (Windows only)
 */
export function isBundledShellAvailable(): boolean {
  if (process.platform !== 'win32') {
    return false // Unix uses system shells
  }

  const paths = getWindowsShellPaths()
  return fs.existsSync(paths.bash) && fs.existsSync(paths.git)
}

/**
 * Get shell configuration for interactive terminal use
 */
export function getInteractiveShellConfig(): ShellConfig {
  const paths = getShellPaths()

  if (process.platform === 'win32') {
    const mingitDir = path.dirname(path.dirname(path.dirname(paths.bash)))

    // Set up MSYS2 environment for proper Unix emulation
    const msysEnv: Record<string, string> = {
      // MSYS2 configuration
      MSYSTEM: 'MINGW64',
      MSYS: 'winsymlinks:nativestrict',

      // Locale settings
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',

      // Add MinGit paths to PATH
      PATH: [
        path.join(mingitDir, 'cmd'),
        path.join(mingitDir, 'usr', 'bin'),
        path.join(mingitDir, 'mingw64', 'bin'),
        process.env.PATH || '',
      ].join(';'),

      // Home directory
      HOME: process.env.USERPROFILE || process.env.HOME || '',

      // Preserve important Windows env vars
      SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
      TEMP: process.env.TEMP || '',
      TMP: process.env.TMP || '',
    }

    return {
      shellPath: paths.bash,
      shellArgs: ['--login', '-i'],
      env: msysEnv,
      isBundled: true,
    }
  }

  // Unix configuration
  const isMac = process.platform === 'darwin'

  const unixEnv: Record<string, string> = {
    LANG: process.env.LANG || 'en_US.UTF-8',
    HOME: process.env.HOME || '',
    PATH: process.env.PATH || '',
    TERM: process.env.TERM || 'xterm-256color',
  }

  // macOS-specific env vars
  if (isMac) {
    if (process.env.TMPDIR) unixEnv.TMPDIR = process.env.TMPDIR
  }

  return {
    shellPath: paths.bash,
    shellArgs: ['-l'], // Login shell
    env: unixEnv,
    isBundled: false,
  }
}

/**
 * Get shell configuration for script execution (non-interactive)
 */
export function getScriptShellConfig(): ShellConfig {
  const paths = getShellPaths()

  if (process.platform === 'win32') {
    // Use BusyBox for lightweight script execution
    return {
      shellPath: paths.sh,
      shellArgs: ['sh'], // BusyBox applet name
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.USERPROFILE || '',
        TEMP: process.env.TEMP || '',
      },
      isBundled: true,
    }
  }

  return {
    shellPath: '/bin/sh',
    shellArgs: [],
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
    },
    isBundled: false,
  }
}

/**
 * Get the git executable path
 */
export function getGitPath(): string {
  const paths = getShellPaths()

  if (process.platform === 'win32' && fs.existsSync(paths.git)) {
    return paths.git
  }

  // On Unix or if bundled git not found, try system git
  return 'git' // Rely on PATH
}

/**
 * Convert Windows path to Unix-style path for use within MSYS2/MinGit
 * e.g., C:\Users\foo -> /c/Users/foo
 */
export function toUnixPath(windowsPath: string): string {
  if (process.platform !== 'win32') {
    return windowsPath
  }

  // Convert backslashes to forward slashes
  let unixPath = windowsPath.replace(/\\/g, '/')

  // Convert drive letter (C:/ -> /c/)
  const driveMatch = unixPath.match(/^([a-zA-Z]):\//)
  if (driveMatch) {
    unixPath = `/${driveMatch[1].toLowerCase()}${unixPath.slice(2)}`
  }

  return unixPath
}

/**
 * Convert Unix-style path back to Windows path
 * e.g., /c/Users/foo -> C:\Users\foo
 */
export function toWindowsPath(unixPath: string): string {
  if (process.platform !== 'win32') {
    return unixPath
  }

  // Check for /c/ style paths
  const driveMatch = unixPath.match(/^\/([a-zA-Z])\//)
  if (driveMatch) {
    return `${driveMatch[1].toUpperCase()}:${unixPath.slice(2).replace(/\//g, '\\')}`
  }

  return unixPath.replace(/\//g, '\\')
}

/**
 * Log diagnostic information about shell configuration
 */
export function logShellDiagnostics(): void {
  const paths = getShellPaths()
  const interactiveConfig = getInteractiveShellConfig()

  console.log('[Shell] Platform:', process.platform)
  console.log('[Shell] Bundled available:', isBundledShellAvailable())
  console.log('[Shell] Paths:', JSON.stringify(paths, null, 2))
  console.log('[Shell] Interactive config:', {
    shellPath: interactiveConfig.shellPath,
    shellArgs: interactiveConfig.shellArgs,
    isBundled: interactiveConfig.isBundled,
  })

  // Check file existence
  if (process.platform === 'win32') {
    console.log('[Shell] bash exists:', fs.existsSync(paths.bash))
    console.log('[Shell] sh exists:', fs.existsSync(paths.sh))
    console.log('[Shell] git exists:', fs.existsSync(paths.git))
  }
}
