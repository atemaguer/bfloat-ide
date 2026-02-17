import * as pty from 'node-pty'
import * as os from 'os'
import * as net from 'net'
import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { handle } from '@/lib/main/shared'
import {
  getInteractiveShellConfig,
  getShellPaths,
  isBundledShellAvailable,
  toUnixPath,
} from '@/lib/platform/shell'

// Track PTY instances by ID
type TerminalProcess = pty.IPty | ChildProcessWithoutNullStreams
const ptyProcesses = new Map<string, TerminalProcess>()
let ptyUnavailableReason: string | null = null

// Output buffering for MCP server read access
const terminalOutputBuffers = new Map<string, string>()
const MAX_OUTPUT_BUFFER = 20000

const appendTerminalOutput = (terminalId: string, data: string) => {
  const existing = terminalOutputBuffers.get(terminalId) || ''
  const next = (existing + data).slice(-MAX_OUTPUT_BUFFER)
  terminalOutputBuffers.set(terminalId, next)
}

const clearTerminalOutput = (terminalId: string) => {
  terminalOutputBuffers.delete(terminalId)
}

const isPtyProcess = (process: TerminalProcess): process is pty.IPty => {
  return typeof (process as pty.IPty).onData === 'function'
}

const getPtyUnavailableReason = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null
  const message = error.message || String(error)
  if (message.includes('pty.node') || message.includes('conpty.node')) return message
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_DLOPEN_FAILED') return message
  return null
}

// Check if a port is available
const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(port, '127.0.0.1')
    server.on('listening', () => {
      server.close()
      resolve(true)
    })
    server.on('error', () => {
      resolve(false)
    })
  })
}

// Find an available port within a range
// If startPort is taken, searches the entire range to find any available port
const findAvailablePort = async (
  startPort: number,
  endPort: number = startPort + 999, // Default to 1000 port range
  maxAttempts: number = 100
): Promise<number> => {
  const range = endPort - startPort + 1
  const actualMaxAttempts = Math.min(maxAttempts, range)

  // First try the start port
  if (await isPortAvailable(startPort)) {
    return startPort
  }

  // Then try sequential ports from startPort+1
  for (let i = 1; i < actualMaxAttempts; i++) {
    const port = startPort + i
    if (port > endPort) break
    if (await isPortAvailable(port)) {
      return port
    }
  }

  // If sequential search failed, try random ports in the range
  const triedPorts = new Set<number>()
  for (let attempts = 0; attempts < actualMaxAttempts; attempts++) {
    const port = startPort + Math.floor(Math.random() * range)
    if (triedPorts.has(port)) continue
    triedPorts.add(port)
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(`Could not find available port in range ${startPort}-${endPort}`)
}

/**
 * Build terminal environment with platform-specific variables.
 * Uses the shell config from the platform/shell module.
 */
const buildTerminalEnv = (shellConfig: ReturnType<typeof getInteractiveShellConfig>): Record<string, string> => {
  // Start with the shell config's environment
  const env: Record<string, string> = { ...shellConfig.env }

  // Add essential system variables
  const systemEnv = process.env as Record<string, string>
  env.USER = systemEnv.USER || systemEnv.USERNAME || ''
  env.SHELL = shellConfig.shellPath

  // Terminal configuration
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.SHLVL = '1'
  env.TERM_PROGRAM = 'Bfloat'
  env.PS1 = systemEnv.PS1 || '%n@%m %1~ %# '

  // Node.js paths (needed for npm/node commands)
  if (systemEnv.NVM_DIR) env.NVM_DIR = systemEnv.NVM_DIR
  if (systemEnv.NVM_BIN) env.NVM_BIN = systemEnv.NVM_BIN
  if (systemEnv.NODE_PATH) env.NODE_PATH = systemEnv.NODE_PATH

  // Editor preferences (non-sensitive)
  if (systemEnv.EDITOR) env.EDITOR = systemEnv.EDITOR
  if (systemEnv.VISUAL) env.VISUAL = systemEnv.VISUAL

  // Remove any problematic environment variables that might cause issues
  delete env.ELECTRON_RUN_AS_NODE
  delete env.TERM_SESSION_ID

  return env
}

export const createPtyTerminal = (
  terminalId: string,
  cwd?: string,
  envOverrides?: Record<string, string>
): { success: boolean; error?: string } => {
  try {
    // Check if terminal already exists
    if (ptyProcesses.has(terminalId)) {
      console.log(`[Terminal] Terminal ${terminalId} already exists, reusing`)
      return { success: true }
    }

    // Get shell configuration from platform module
    const shellConfig = getInteractiveShellConfig()
    let shell = shellConfig.shellPath
    let shellArgs = shellConfig.shellArgs

    // Validate and fallback working directory
    let workingDir = cwd || os.homedir()

    // Check if the working directory exists, fallback to home if not
    if (!fs.existsSync(workingDir)) {
      console.warn(`[Terminal] Working directory does not exist: ${workingDir}, falling back to home`)
      workingDir = os.homedir()
    }

    // Verify shell exists
    if (!fs.existsSync(shell)) {
      console.error(`[Terminal] Shell not found: ${shell}`)
      // Try fallback shells
      const fallbackShells =
        process.platform === 'darwin'
          ? ['/bin/zsh', '/bin/bash', '/bin/sh']
          : process.platform === 'win32'
            ? [process.env.COMSPEC || 'cmd.exe']
            : ['/bin/bash', '/bin/sh']

      let foundShell = false
      for (const fallback of fallbackShells) {
        if (fs.existsSync(fallback)) {
          console.log(`[Terminal] Using fallback shell: ${fallback}`)
          shell = fallback
          shellArgs = process.platform === 'win32' ? [] : ['-l']
          foundShell = true
          break
        }
      }

      if (!foundShell) {
        return { success: false, error: `No valid shell found. Tried: ${shell}, ${fallbackShells.join(', ')}` }
      }
    }

    const isBundledBash = shellConfig.isBundled
    console.log(`[Terminal] Creating PTY with shell: ${shell}, cwd: ${workingDir}, bundled: ${isBundledBash}`)

    // Build environment using shell config
    let env = buildTerminalEnv(shellConfig)

    // Apply env overrides (e.g. from MCP server)
    if (envOverrides) {
      Object.assign(env, envOverrides)
    }

    console.log(`[Terminal] Spawning shell with args: ${shellArgs.join(', ')}`)

    // For bundled bash on Windows, convert the working directory to Unix-style path
    if (isBundledBash && process.platform === 'win32') {
      // The CWD needs to be in Windows format for pty.spawn, but bash will handle it
      console.log(`[Terminal] Using bundled bash with Windows CWD: ${workingDir}`)
    }

    const spawnFallbackProcess = (): ChildProcessWithoutNullStreams => {
      if (process.platform === 'win32') {
        // Use cmd.exe with /Q (quiet echo) for fallback mode
        const fallbackShell = process.env.COMSPEC || 'cmd.exe'
        console.warn(`[Terminal] Falling back to ${fallbackShell} (non-PTY mode)`)
        shell = fallbackShell
        shellArgs = [] // cmd.exe will start interactively
        // Rebuild env without MSYS2 settings for cmd.exe
        env = {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>
      }
      const proc = spawn(shell, shellArgs, {
        cwd: workingDir,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // For Windows fallback, we need to handle stdin specially
      // Keep stdin open and handle newlines properly
      if (process.platform === 'win32' && proc.stdin) {
        proc.stdin.setDefaultEncoding('utf8')
      }

      return proc
    }

    let terminalProcess: TerminalProcess
    let usedFallback = false

    if (process.platform === 'win32' && ptyUnavailableReason) {
      usedFallback = true
      terminalProcess = spawnFallbackProcess()
    } else {
      try {
        terminalProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: workingDir,
          env,
          // Use conpty on Windows for better compatibility
          useConpty: process.platform === 'win32',
        })
      } catch (spawnError) {
        const disableReason = process.platform === 'win32' ? getPtyUnavailableReason(spawnError) : null
        if (process.platform === 'win32' && disableReason) {
          ptyUnavailableReason = disableReason
          console.warn(`[Terminal] node-pty unavailable, falling back to child_process: ${disableReason}`)
          usedFallback = true
          terminalProcess = spawnFallbackProcess()
        } else {
          console.error(`[Terminal] PTY spawn failed:`, spawnError)
          console.error(`[Terminal] Shell: ${shell}, CWD: ${workingDir}, Args: ${shellArgs.join(', ')}`)
          return { success: false, error: `Failed to spawn shell: ${spawnError}` }
        }
      }
    }

    console.log(
      `[Terminal] Terminal process created with pid: ${terminalProcess.pid ?? 'unknown'}${usedFallback ? ' (child_process fallback)' : ''}`
    )

    ptyProcesses.set(terminalId, terminalProcess)

    if (isPtyProcess(terminalProcess)) {
      terminalProcess.onData((data) => {
        appendTerminalOutput(terminalId, data)
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('terminal-data', terminalId, data)
          }
        })
      })

      terminalProcess.onExit(({ exitCode, signal }) => {
        console.log(`[Terminal] PTY ${terminalId} exited with code: ${exitCode}, signal: ${signal}`)
        ptyProcesses.delete(terminalId)
        clearTerminalOutput(terminalId)
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('terminal-exit', terminalId, exitCode)
          }
        })
      })
    } else {
      terminalProcess.stdout?.on('data', (data) => {
        appendTerminalOutput(terminalId, data.toString())
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('terminal-data', terminalId, data.toString())
          }
        })
      })

      terminalProcess.stderr?.on('data', (data) => {
        appendTerminalOutput(terminalId, data.toString())
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('terminal-data', terminalId, data.toString())
          }
        })
      })

      terminalProcess.on('error', (error) => {
        console.error(`[Terminal] Fallback process error:`, error)
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('terminal-data', terminalId, `\r\n[Terminal] ${String(error)}\r\n`)
          }
        })
      })

      terminalProcess.on('exit', (exitCode, signal) => {
        console.log(`[Terminal] Fallback process ${terminalId} exited with code: ${exitCode}, signal: ${signal}`)
        ptyProcesses.delete(terminalId)
        clearTerminalOutput(terminalId)
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('terminal-exit', terminalId, exitCode ?? 0)
          }
        })
      })
    }

    if (usedFallback) {
      const warning =
        '\r\n\x1b[33m[Terminal] Native PTY unavailable on this Windows build. Using limited shell mode.\x1b[0m\r\n'
      const windows = BrowserWindow.getAllWindows()
      windows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('terminal-data', terminalId, warning)
        }
      })
    }

    return { success: true }
  } catch (error) {
    console.error(`[Terminal] Failed to create PTY:`, error)
    return { success: false, error: String(error) }
  }
}

export const writeToTerminal = (terminalId: string, data: string): { success: boolean; error?: string } => {
  const ptyProcess = ptyProcesses.get(terminalId)
  if (ptyProcess) {
    try {
      if (isPtyProcess(ptyProcess)) {
        ptyProcess.write(data)
      } else {
        // Fallback mode using child_process
        if (ptyProcess.stdin && !ptyProcess.stdin.destroyed) {
          ptyProcess.stdin.write(data)
          // For Windows cmd.exe, we may need to flush
          if (process.platform === 'win32' && data.includes('\r')) {
            ptyProcess.stdin.uncork?.()
          }
        } else {
          console.warn(`[Terminal] stdin not available for fallback process ${terminalId}`)
          return { success: false, error: 'stdin not available' }
        }
      }
      return { success: true }
    } catch (error) {
      console.error(`[Terminal] Failed to write to PTY:`, error)
      return { success: false, error: String(error) }
    }
  }
  return { success: false, error: 'Terminal not found' }
}

export const resizeTerminal = (terminalId: string, cols: number, rows: number): { success: boolean; error?: string } => {
  const ptyProcess = ptyProcesses.get(terminalId)
  if (ptyProcess) {
    try {
      if (isPtyProcess(ptyProcess)) {
        ptyProcess.resize(cols, rows)
      }
      return { success: true }
    } catch (error) {
      console.error(`[Terminal] Failed to resize PTY:`, error)
      return { success: false, error: String(error) }
    }
  }
  return { success: false, error: 'Terminal not found' }
}

export const killTerminal = (terminalId: string): { success: boolean; error?: string } => {
  const ptyProcess = ptyProcesses.get(terminalId)
  if (ptyProcess) {
    try {
      console.log(`[Terminal] Killing terminal process ${terminalId}`)
      ptyProcess.kill()
      ptyProcesses.delete(terminalId)
      clearTerminalOutput(terminalId)
      return { success: true }
    } catch (error) {
      console.error(`[Terminal] Failed to kill PTY:`, error)
      return { success: false, error: String(error) }
    }
  }
  return { success: false, error: 'Terminal not found' }
}

export const readTerminalOutput = (terminalId: string, maxChars?: number): { success: boolean; output?: string; error?: string } => {
  if (!ptyProcesses.has(terminalId)) {
    return { success: false, error: 'Terminal not found' }
  }
  const output = terminalOutputBuffers.get(terminalId) || ''
  terminalOutputBuffers.set(terminalId, '')
  const trimmed = maxChars ? output.slice(-maxChars) : output
  return { success: true, output: trimmed }
}

export const registerTerminalHandlers = () => {
  // Log shell configuration on startup
  if (process.platform === 'win32') {
    const bundledAvailable = isBundledShellAvailable()
    const paths = getShellPaths()
    console.log(`[Terminal] Windows shell setup - bundled: ${bundledAvailable}`)
    console.log(`[Terminal] Shell paths: bash=${paths.bash}, git=${paths.git}`)
  }

  // Create a new PTY terminal
  handle('terminal-create', (terminalId: string, cwd?: string): { success: boolean; error?: string } => {
    return createPtyTerminal(terminalId, cwd)
  })

  // Write data to PTY
  handle('terminal-write', (terminalId: string, data: string): { success: boolean; error?: string } => {
    return writeToTerminal(terminalId, data)
  })

  // Resize PTY
  handle('terminal-resize', (terminalId: string, cols: number, rows: number): { success: boolean; error?: string } => {
    return resizeTerminal(terminalId, cols, rows)
  })

  // Kill/destroy PTY
  handle('terminal-kill', (terminalId: string): { success: boolean; error?: string } => {
    return killTerminal(terminalId)
  })

  // Get current working directory (home directory by default)
  handle('terminal-get-cwd', () => {
    return os.homedir()
  })

  // Check if a port is available
  handle('terminal-check-port', async (port: number): Promise<{ available: boolean; port: number }> => {
    const available = await isPortAvailable(port)
    return { available, port }
  })

  // Find an available port within a range
  // startPort: preferred starting port
  // endPort: maximum port to try (optional, defaults to startPort + 999)
  handle(
    'terminal-find-port',
    async (startPort: number, endPort?: number): Promise<{ success: boolean; port?: number; error?: string }> => {
      try {
        const port = await findAvailablePort(startPort, endPort)
        console.log(`[Terminal] Found available port: ${port} (searched from ${startPort})`)
        return { success: true, port }
      } catch (error) {
        console.error(`[Terminal] Failed to find available port:`, error)
        return { success: false, error: String(error) }
      }
    }
  )
}

// Clean up all PTY processes on app quit
export const cleanupTerminals = () => {
  console.log(`[Terminal] Cleaning up ${ptyProcesses.size} terminal processes`)
  ptyProcesses.forEach((ptyProcess, id) => {
    try {
      console.log(`[Terminal] Killing terminal process ${id}`)
      ptyProcess.kill()
    } catch {
      // Ignore errors during cleanup
    }
  })
  ptyProcesses.clear()
  terminalOutputBuffers.clear()
}
