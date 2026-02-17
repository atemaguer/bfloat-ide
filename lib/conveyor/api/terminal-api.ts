import { ConveyorApi } from '@/lib/preload/shared'

type DataCallback = (terminalId: string, data: string) => void
type ExitCallback = (terminalId: string, exitCode: number) => void

// Store callbacks globally so we can manage them
const dataCallbacks = new Map<string, DataCallback>()
const exitCallbacks = new Map<string, ExitCallback>()
let globalListenersInitialized = false

export class TerminalApi extends ConveyorApi {
  create = (terminalId: string, cwd?: string) => this.invoke('terminal-create', terminalId, cwd)
  write = (terminalId: string, data: string) => this.invoke('terminal-write', terminalId, data)
  resize = (terminalId: string, cols: number, rows: number) => this.invoke('terminal-resize', terminalId, cols, rows)
  kill = (terminalId: string) => this.invoke('terminal-kill', terminalId)
  getCwd = () => this.invoke('terminal-get-cwd')

  // Check if a specific port is available
  checkPort = (port: number): Promise<{ available: boolean; port: number }> =>
    this.invoke('terminal-check-port', port)

  // Find an available port within a range
  // startPort: preferred starting port (default: 3000)
  // endPort: maximum port to try (optional, defaults to startPort + 999)
  findAvailablePort = (startPort: number = 3000, endPort?: number): Promise<{ success: boolean; port?: number; error?: string }> =>
    this.invoke('terminal-find-port', startPort, endPort)
  
  /**
   * Execute a command in a terminal
   * This writes the command followed by a carriage return to simulate pressing Enter
   */
  runCommand = (terminalId: string, command: string) => {
    return this.write(terminalId, command + '\r')
  }

  /**
   * Execute a command and collect output until completion
   * Returns a promise that resolves with the command output
   */
  executeCommand = (terminalId: string, command: string): Promise<{ output: string; exitCode: number }> => {
    return new Promise((resolve) => {
      let output = ''
      let commandStarted = false
      
      // Create a unique marker to detect command completion
      const marker = `__CMD_DONE_${Date.now()}__`
      const fullCommand = `${command}; echo "${marker}$?"`
      
      const originalDataCallback = dataCallbacks.get(terminalId)
      
      const captureCallback: DataCallback = (tid, data) => {
        // Also call original callback to update UI
        if (originalDataCallback) {
          originalDataCallback(tid, data)
        }
        
        if (!commandStarted) {
          commandStarted = true
          return
        }
        
        // Check if output contains our marker
        if (data.includes(marker)) {
          const markerIndex = data.indexOf(marker)
          output += data.substring(0, markerIndex)
          
          // Extract exit code from after the marker
          const exitCodeStr = data.substring(markerIndex + marker.length).trim()
          const exitCode = parseInt(exitCodeStr, 10) || 0
          
          // Restore original callback
          if (originalDataCallback) {
            dataCallbacks.set(terminalId, originalDataCallback)
          }
          
          resolve({ output: output.trim(), exitCode })
        } else {
          output += data
        }
      }
      
      dataCallbacks.set(terminalId, captureCallback)
      this.write(terminalId, fullCommand + '\r')
    })
  }

  // Initialize global listeners once
  private initGlobalListeners = () => {
    if (globalListenersInitialized) return
    globalListenersInitialized = true

    this.renderer.on('terminal-data', (_, terminalId: string, data: string) => {
      const callback = dataCallbacks.get(terminalId)
      if (callback) {
        callback(terminalId, data)
      }
    })

    this.renderer.on('terminal-exit', (_, terminalId: string, exitCode: number) => {
      const callback = exitCallbacks.get(terminalId)
      if (callback) {
        callback(terminalId, exitCode)
      }
    })
  }

  // Register callback for specific terminal
  onData = (terminalId: string, callback: DataCallback) => {
    this.initGlobalListeners()
    dataCallbacks.set(terminalId, callback)
  }

  onExit = (terminalId: string, callback: ExitCallback) => {
    this.initGlobalListeners()
    exitCallbacks.set(terminalId, callback)
  }

  // Listen for agent-spawned terminal creation events
  onAgentTerminalCreated = (callback: (terminalId: string) => void): (() => void) => {
    const handler = (_: unknown, terminalId: string) => callback(terminalId)
    this.renderer.on('agent-terminal-created', handler)
    return () => this.renderer.removeListener('agent-terminal-created', handler)
  }

  // Listen for agent-closed terminal events
  onAgentTerminalClosed = (callback: (terminalId: string) => void): (() => void) => {
    const handler = (_: unknown, terminalId: string) => callback(terminalId)
    this.renderer.on('agent-terminal-closed', handler)
    return () => this.renderer.removeListener('agent-terminal-closed', handler)
  }

  // Listen for agent-triggered dev server restart events
  onRestartDevServer = (callback: () => void): (() => void) => {
    const handler = () => callback()
    this.renderer.on('restart-dev-server', handler)
    return () => this.renderer.removeListener('restart-dev-server', handler)
  }

  // Remove listeners for specific terminal
  removeListeners = (terminalId: string) => {
    dataCallbacks.delete(terminalId)
    exitCallbacks.delete(terminalId)
  }
}
