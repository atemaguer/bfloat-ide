import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef, useMemo } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronUp, Terminal as TerminalIcon, Plus, X } from 'lucide-react'

import { workbenchStore } from '@/app/stores/workbench'
import type { Project } from '@/app/types/project'
import { getLaunchConfig, detectLaunchConfig, buildFullCommand } from '@/lib/launch'
import type { LaunchConfig } from '@/app/types/launch'
import { DEFAULT_CONFIGS } from '@/app/types/launch'
import { EditorPanel } from '@/app/components/editor/EditorPanel'
import { Preview } from '@/app/components/preview/Preview'
import { Terminal, killTerminal } from '@/app/components/terminal'
import { ConvexDashboard } from '@/app/components/project/ConvexDashboard'
import { ConvexIntegration } from '@/app/components/integrations/ConvexIntegration'
import { ProjectSettings } from '@/app/components/project/ProjectSettings'
import { PaymentsOverview } from '@/app/components/payments/PaymentsOverview'
import { AppTypeProvider } from '@/app/contexts/AppTypeContext'
import { terminal, filesystem, aiAgent, projectSync, projectFiles, secrets as secretsApi } from '@/app/api/sidecar'
import {
  getConvexDashboardConfigFromSecrets,
  getConvexSecretStatusFromSecrets,
  type SecretEntry,
} from '@/app/lib/integrations/convex'
import './styles.css'

// Export interface for external access to workbench terminal commands
export interface WorkbenchHandle {
  runCommand: (command: string, terminalId?: string) => Promise<void>
  openTerminal: () => void
  getActiveTerminalId: () => string
}

// Sync status from projectStore for progressive loading
type SyncStatus = 'idle' | 'opening' | 'ready' | 'error'

interface WorkbenchProps {
  project: Project
  hasConvexIntegration?: boolean
  convexDeploymentKey?: string | null
  convexUrl?: string | null
  convexDeployment?: string | null
  onRefreshPreviewReady?: (refreshFn: () => void) => void
  gitProjectPath?: string | null  // Pre-cloned git repo path from agent
  syncStatus?: SyncStatus  // For progressive loading - show loading states per-tab
}

export const Workbench = forwardRef<WorkbenchHandle, WorkbenchProps>(function Workbench(
  {
    project,
    hasConvexIntegration,
    convexDeploymentKey,
    convexUrl,
    convexDeployment,
    onRefreshPreviewReady: _onRefreshPreviewReady,
    gitProjectPath,
    syncStatus = 'ready',
  }: WorkbenchProps,
  ref
) {
  // Check if files are still loading (progressive loading)
  const isFilesLoading = syncStatus === 'opening' || syncStatus === 'idle'
  // Get shared state from store (tabs are now in titlebar)
  const activeTab = useStore(workbenchStore.activeTab)
  const isChatCollapsed = useStore(workbenchStore.isChatCollapsed)
  const selectedFile = useStore(workbenchStore.selectedFile)
  const currentDocument = useStore(workbenchStore.currentDocument)
  const unsavedFiles = useStore(workbenchStore.unsavedFiles)
  const files = useStore(workbenchStore.files)
  const chatStreaming = useStore(workbenchStore.chatStreaming)
  const secretsVersion = useStore(workbenchStore.secretsVersion)

  // Raw app type from database - normalization happens in AppTypeContext
  const rawAppType = project.appType || 'mobile'
  // Keep local appType and isWebApp for use within this component
  // (can't use hooks in callbacks or useEffects that run before render)
  const appType = rawAppType === 'nextjs' || rawAppType === 'vite' || rawAppType === 'node' || rawAppType === 'web' ? 'web' : 'mobile'
  const isWebApp = appType === 'web'

  // Log app type for debugging
  useEffect(() => {
    console.log('[Workbench] App type from project:', project.appType, '→ using:', appType)
  }, [appType, project.appType])

  // Port ranges for dev servers - ports are dynamically selected at runtime
  // Using higher port ranges that are typically not in use to avoid conflicts
  // Web apps: 9000-9999, Mobile/Expo apps: 19000-19999
  const PORT_RANGES = {
    web: { start: 9000, end: 9999 },
    mobile: { start: 19000, end: 19999 },
  } as const
  const portRange = isWebApp ? PORT_RANGES.web : PORT_RANGES.mobile
  const actualPortRef = useRef<number>(portRange.start)

  // Dev server state
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const prevActiveTabRef = useRef(activeTab)
  const [serverStatus, setServerStatus] = useState<'starting' | 'running' | 'error'>('starting')

  // Shared state
  const [expoUrl, setExpoUrl] = useState('')
  const [projectSecrets, setProjectSecrets] = useState<SecretEntry[]>([])
  const terminalOutputBuffer = useRef('')
  const devServerTerminalIdRef = useRef<string | null>(null)
  const portConflictRef = useRef(false)

  // Terminal panel state
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(280)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(280)

  // Multiple terminals state
  interface TerminalTab {
    id: string
    name: string
  }
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    { id: 'terminal-1', name: 'Terminal' }
  ])
  const [activeTerminalId, setActiveTerminalId] = useState('terminal-1')
  const activeTerminalIdRef = useRef(activeTerminalId)
  activeTerminalIdRef.current = activeTerminalId
  const terminalCountRef = useRef(1)
  const agentTerminalCountRef = useRef(0)
  const terminalReadyRef = useRef<Set<string>>(new Set())
  const terminalExitedRef = useRef<Set<string>>(new Set())
  const terminalFirstOutputRef = useRef<Set<string>>(new Set())
  const shellReadyResolversRef = useRef<Map<string, () => void>>(new Map())

  // Re-mount the preview iframe when switching back to the preview tab.
  // Browsers may discard invisible cross-origin iframe content, causing a
  // black screen when the tab becomes visible again.
  useEffect(() => {
    const wasAway = prevActiveTabRef.current !== 'preview'
    prevActiveTabRef.current = activeTab

    if (activeTab === 'preview' && wasAway && previewUrl) {
      setPreviewRefreshKey(k => k + 1)
    }
  }, [activeTab, previewUrl])

  // Mark terminal as ready when it's initialized
  const handleTerminalReady = useCallback((terminalId: string) => {
    console.log(`[Workbench] Terminal ${terminalId} is ready`)
    terminalReadyRef.current.add(terminalId)
    // Clear exited state when terminal becomes ready again
    terminalExitedRef.current.delete(terminalId)
  }, [])

  // Handle terminal exit - clear ready state so we know the terminal is no longer usable
  const handleTerminalExit = useCallback((terminalId: string, exitCode: number) => {
    console.log(`[Workbench] Terminal ${terminalId} exited with code: ${exitCode}`)
    terminalReadyRef.current.delete(terminalId)
    terminalExitedRef.current.add(terminalId)
  }, [])

  // Wait for a specific terminal to be ready
  const waitForTerminalReady = useCallback((terminalId: string, maxWaitMs = 10000): Promise<boolean> => {
    return new Promise((resolve) => {
      if (terminalReadyRef.current.has(terminalId)) {
        resolve(true)
        return
      }

      const startTime = Date.now()
      const checkInterval = setInterval(() => {
        if (terminalReadyRef.current.has(terminalId)) {
          clearInterval(checkInterval)
          resolve(true)
        } else if (Date.now() - startTime > maxWaitMs) {
          clearInterval(checkInterval)
          console.warn(`[Workbench] Terminal ${terminalId} did not become ready within ${maxWaitMs}ms`)
          resolve(false)
        }
      }, 100)
    })
  }, [])

  // Wait for the shell to emit its first output (prompt), indicating it's ready for input
  const waitForShellReady = useCallback((terminalId: string, maxWaitMs = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      if (terminalFirstOutputRef.current.has(terminalId)) {
        resolve(true)
        return
      }

      const timeout = setTimeout(() => {
        shellReadyResolversRef.current.delete(terminalId)
        console.warn(`[Workbench] Shell for ${terminalId} did not produce output within ${maxWaitMs}ms`)
        resolve(false)
      }, maxWaitMs)

      shellReadyResolversRef.current.set(terminalId, () => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }, [])

  const addTerminalTab = useCallback(() => {
    terminalCountRef.current += 1
    const newId = `terminal-${terminalCountRef.current}`
    const newTab: TerminalTab = {
      id: newId,
      name: `Terminal ${terminalCountRef.current}`
    }
    setTerminalTabs(prev => [...prev, newTab])
    setActiveTerminalId(newId)
  }, [])

  // Create or reuse a "Deploy" terminal tab
  const createDeployTerminal = useCallback((): string => {
    const deployTabId = 'terminal-deploy'

    setTerminalTabs(prev => {
      // Check if Deploy tab already exists
      const existingTab = prev.find(tab => tab.id === deployTabId)
      if (existingTab) {
        return prev
      }
      // Create new Deploy tab
      return [...prev, { id: deployTabId, name: 'Deploy' }]
    })

    // Make it active
    setActiveTerminalId(deployTabId)

    // Also open the terminal panel
    setIsTerminalOpen(true)

    return deployTabId
  }, [])

  // Handle terminal output to extract Expo URL and detect dev server status
  const handleTerminalOutput = useCallback((data: string) => {
    // Mark shell as ready on first output (the shell prompt)
    const currentTerminalId = activeTerminalIdRef.current
    if (!terminalFirstOutputRef.current.has(currentTerminalId)) {
      terminalFirstOutputRef.current.add(currentTerminalId)
      console.log(`[Workbench] Shell first output detected for ${currentTerminalId}`)
      const resolver = shellReadyResolversRef.current.get(currentTerminalId)
      if (resolver) {
        shellReadyResolversRef.current.delete(currentTerminalId)
        resolver()
      }
    }

    // Helper function to strip ANSI escape codes (needed for colored terminal output)
    const stripAnsi = (str: string) => {
      return str
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
        .replace(/\[\d+m/g, '') // Remaining color codes
        .replace(/\r/g, '') // Carriage returns
    }

    // Accumulate output in buffer (strip ANSI for cleaner matching)
    const cleanData = stripAnsi(data)
    terminalOutputBuffer.current += cleanData

    // Detect Expo port fallback — "Something is already running on port 19000"
    // When this happens, clear the stale port so the fallback doesn't use it
    const portConflict = cleanData.match(/already running on port (\d+)/i)
      || terminalOutputBuffer.current.match(/already running on port (\d+)/i)
    if (portConflict) {
      portConflictRef.current = true
    }

    // Parse "Starting Metro on port XXXXX" to update actualPortRef after a port switch
    const metroPortMatch = cleanData.match(/Starting Metro on port (\d+)/i)
      || terminalOutputBuffer.current.match(/Starting Metro on port (\d+)/i)
    if (metroPortMatch) {
      actualPortRef.current = parseInt(metroPortMatch[1], 10)
      portConflictRef.current = false
    }

    // Look for Expo URL in the output for QR codes (native devices)
    // Matches:
    // - exp://192.168.1.12:19000 (Expo Go format)
    // - exp+appname://expo-development-client/?url=... (Development build format)
    if (!expoUrl) {
      // Try development client format first (exp+name://expo-development-client/?url=...)
      const devClientMatch = terminalOutputBuffer.current.match(/exp\+[\w-]+:\/\/expo-development-client\/\?url=[^\s]+/)
      if (devClientMatch) {
        const detectedUrl = devClientMatch[0]
        console.log('[Workbench] Detected Expo Dev Client URL:', detectedUrl)
        setExpoUrl(detectedUrl)
      } else {
        // Fallback to Expo Go format (exp://IP:PORT)
        const expUrlMatch = terminalOutputBuffer.current.match(/exp:\/\/[\w.-]+:\d+/)
        if (expUrlMatch) {
          const detectedUrl = expUrlMatch[0]
          console.log('[Workbench] Detected Expo URL:', detectedUrl)
          setExpoUrl(detectedUrl)
        }
      }
    }

    // Dev server detection - parse actual URL/port from terminal output
    // Detect when "Local: http://localhost:PORT" appears - this is the definitive signal

    // For Expo: always check for the authoritative "Web is waiting on" URL.
    // This can appear AFTER an initial generic URL was already detected, so we
    // allow it to override the current previewUrl to ensure the correct port.
    const expoWebUrlInData = cleanData.match(/Web is waiting on https?:\/\/localhost:(\d+)/i)
    if (expoWebUrlInData) {
      const webPort = parseInt(expoWebUrlInData[1], 10)
      const webUrl = `http://localhost:${webPort}`
      if (webUrl !== previewUrl) {
        console.log('[Workbench] Expo Web URL detected:', webUrl, '(overriding previous:', previewUrl || 'none', ')')
        actualPortRef.current = webPort
        portConflictRef.current = false
        setPreviewUrl(webUrl)
        setServerStatus('running')
      }
    }

    if (!previewUrl) {
      const expoWebUrlInBuffer = terminalOutputBuffer.current.match(/Web is waiting on https?:\/\/localhost:(\d+)/i)
      const expoWebMatch = expoWebUrlInData || expoWebUrlInBuffer

      // Also look for Vite/Next.js "Local:" pattern specifically
      const localUrlInData = cleanData.match(/Local:\s*https?:\/\/localhost:(\d+)/i)
      const localUrlInBuffer = terminalOutputBuffer.current.match(/Local:\s*https?:\/\/localhost:(\d+)/i)
      const localUrlMatch = localUrlInData || localUrlInBuffer

      // Generic localhost URL fallback
      const urlInData = cleanData.match(/https?:\/\/localhost:(\d+)\/?/i)
      const urlInBuffer = terminalOutputBuffer.current.match(/https?:\/\/localhost:(\d+)\/?/i)

      // Prefer specific matches: Expo Web URL > Local: URL > generic URL
      const urlMatch = expoWebMatch || localUrlMatch || urlInData || urlInBuffer

      // Trigger on: seeing a localhost URL AND any server ready indicator
      // Includes patterns for: Vite/Next.js ("Local:"), Expo ("waiting on", "Press j"), general ("ready", "started")
      const hasReadyIndicator =
        cleanData.includes('Local:') ||
        cleanData.includes('ready') ||
        cleanData.includes('Ready') ||
        cleanData.includes('started') ||
        cleanData.includes('listening') ||
        cleanData.includes('waiting on') || // Expo: "Web is waiting on http://localhost:PORT"
        cleanData.includes('Press j') || // Expo menu shown = bundler ready
        cleanData.includes('Press r') || // Expo menu shown = bundler ready
        cleanData.includes('open debugger') || // Expo menu
        terminalOutputBuffer.current.includes('Local:') ||
        terminalOutputBuffer.current.includes('waiting on') ||
        terminalOutputBuffer.current.includes('Press j')

      if (urlMatch && hasReadyIndicator) {
        const detectedPort = parseInt(urlMatch[1], 10)
        actualPortRef.current = detectedPort
        const detectedUrl = `http://localhost:${detectedPort}`
        console.log('[Workbench] Dev server detected at:', detectedUrl, expoWebMatch ? '(Expo Web)' : localUrlMatch ? '(Local:)' : '(generic)')
        setPreviewUrl(detectedUrl)
        setServerStatus('running')
      } else if (!urlMatch && hasReadyIndicator) {
        // Fallback: If we see ready indicators (like Expo menu) but no URL was found,
        // use the port we assigned when launching the dev server
        // This handles cases where Expo doesn't print the web URL clearly
        const isExpoReady =
          terminalOutputBuffer.current.includes('Press j') ||
          terminalOutputBuffer.current.includes('open debugger') ||
          terminalOutputBuffer.current.includes('Logs for your project')

        if (isExpoReady && actualPortRef.current > 0 && !portConflictRef.current) {
          const fallbackUrl = `http://localhost:${actualPortRef.current}`
          console.log('[Workbench] Dev server ready (using assigned port):', fallbackUrl)
          setPreviewUrl(fallbackUrl)
          setServerStatus('running')
        }
      }
    }

    // Detect server errors - only actual failures, not warnings
    // Only set error if server hasn't successfully started yet
    if (serverStatus !== 'running') {
      if (cleanData.includes('EADDRINUSE') || cleanData.includes('Error: listen EADDRINUSE') || cleanData.includes('bundler has encountered an error') || cleanData.includes('Error: ')) {
        console.error('[Workbench] Dev server error detected')
        setServerStatus('error')
      }
    }

    // Detect bundler errors for auto-fix (only when not streaming)
    // Only capture errors when the AI is NOT currently making changes
    if (!chatStreaming && serverStatus === 'running') {
        // Get recent output for error detection (buffer is already clean)
        const recentOutput = terminalOutputBuffer.current.slice(-4000)

        // Check for various error patterns in the clean output
        const hasModuleError = cleanData.includes('Unable to resolve module') || cleanData.includes('could not be found')
        const hasBundlingError = cleanData.includes('Bundling failed') || cleanData.includes('error: ')
        const hasSyntaxError = cleanData.includes('SyntaxError:') || cleanData.includes('Unexpected token')
        const hasTypeError = cleanData.includes('TypeError:')
        const hasReferenceError = cleanData.includes('ReferenceError:')
        const hasImportError = cleanData.includes('Cannot find module') || cleanData.includes('Module not found')

        if (hasModuleError || hasBundlingError || hasSyntaxError || hasTypeError || hasReferenceError || hasImportError) {
          // Try to extract a clean, structured error message
          let errorMessage = ''

          // Pattern 1: "Unable to resolve module X from Y: Z could not be found..."
          const moduleResolveMatch = recentOutput.match(/Unable to resolve module ['"]?([^'":\s]+)['"]? from ([^:]+):[^]*?could not be found[^]*?(?=\n\n|\n[A-Z]|$)/i)
          if (moduleResolveMatch) {
            const moduleName = moduleResolveMatch[1]
            const fromFile = moduleResolveMatch[2].split('/').slice(-2).join('/') // Last 2 path segments
            errorMessage = `Unable to resolve module '${moduleName}' from ${fromFile}. The module could not be found in the project or node_modules.`
          }

          // Pattern 2: "SyntaxError: ..." or "TypeError: ..."
          if (!errorMessage) {
            const syntaxMatch = recentOutput.match(/(SyntaxError|TypeError|ReferenceError):\s*([^\n]+)/)
            if (syntaxMatch) {
              errorMessage = `${syntaxMatch[1]}: ${syntaxMatch[2].trim()}`

              // Try to find the file location
              const fileMatch = recentOutput.match(/at\s+([^\s]+\.(tsx?|jsx?|js|ts))[:(\s]/)
              if (fileMatch) {
                const fileName = fileMatch[1].split('/').slice(-2).join('/')
                errorMessage += ` in ${fileName}`
              }
            }
          }

          // Pattern 3: "error: ..." from bundler
          if (!errorMessage) {
            const bundlerErrorMatch = recentOutput.match(/error:\s*([^\n]+(?:\n[^\n]+)?)/i)
            if (bundlerErrorMatch) {
              errorMessage = bundlerErrorMatch[1].trim().replace(/\s+/g, ' ')
            }
          }

          // Pattern 4: Module not found / Cannot find module
          if (!errorMessage) {
            const cannotFindMatch = recentOutput.match(/(?:Cannot find module|Module not found)[:\s]*['"]?([^'":\n]+)['"]?/i)
            if (cannotFindMatch) {
              errorMessage = `Module not found: '${cannotFindMatch[1].trim()}'`
            }
          }

          // Fallback: Extract around error keywords
          if (!errorMessage) {
            const errorPrefixes = ['Unable to resolve', 'SyntaxError', 'TypeError', 'ReferenceError', 'Error:', 'error:']
            for (const prefix of errorPrefixes) {
              const idx = recentOutput.lastIndexOf(prefix)
              if (idx !== -1) {
                // Extract up to the next double newline or 500 chars
                const endIdx = Math.min(
                  recentOutput.indexOf('\n\n', idx) !== -1 ? recentOutput.indexOf('\n\n', idx) : idx + 500,
                  idx + 500
                )
                errorMessage = recentOutput.slice(idx, endIdx).trim().replace(/\s+/g, ' ')
                break
              }
            }
          }

          // Clean up and validate the error message
          if (errorMessage && errorMessage.length > 20) {
            // Remove any remaining noise
            errorMessage = errorMessage
              .replace(/^\s*>\s*/gm, '') // Remove line prefixes like "> "
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim()

            // Limit length but try to keep complete sentences
            if (errorMessage.length > 500) {
              const cutoff = errorMessage.lastIndexOf('.', 500)
              errorMessage = errorMessage.slice(0, cutoff > 200 ? cutoff + 1 : 500) + '...'
            }

            const currentError = workbenchStore.promptError.getState()
            // Avoid setting duplicate errors
            if (!currentError || !currentError.includes(errorMessage.slice(0, 50))) {
              console.log('[Workbench] Detected bundler error:', errorMessage.slice(0, 100))
              workbenchStore.setPromptError(errorMessage)
            }
          }
        }
      }

    // Keep buffer size reasonable (last 5000 chars)
    if (terminalOutputBuffer.current.length > 5000) {
      terminalOutputBuffer.current = terminalOutputBuffer.current.slice(-5000)
    }
  }, [expoUrl, previewUrl, serverStatus, isWebApp, chatStreaming])

  const closeTerminalTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Kill the PTY process
    killTerminal(tabId)

    setTerminalTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId)
      // If we're closing the active tab, switch to another one
      if (activeTerminalId === tabId && newTabs.length > 0) {
        const closedIndex = prev.findIndex(t => t.id === tabId)
        const newActiveIndex = Math.min(closedIndex, newTabs.length - 1)
        setActiveTerminalId(newTabs[newActiveIndex].id)
      }
      // If no tabs left, close the panel
      if (newTabs.length === 0) {
        setIsTerminalOpen(false)
        // Reset with a new terminal for next time
        terminalCountRef.current = 1
        return [{ id: 'terminal-1', name: 'Terminal' }]
      }
      return newTabs
    })
  }, [activeTerminalId])

  // Terminal resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartY.current = e.clientY
    resizeStartHeight.current = terminalHeight
  }, [terminalHeight])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = resizeStartY.current - e.clientY
      const newHeight = Math.min(Math.max(resizeStartHeight.current + deltaY, 150), window.innerHeight - 200)
      setTerminalHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  /**
   * Run a command in the terminal programmatically
   * Opens the terminal panel if not already open
   */
  const runCommand = useCallback(async (command: string, terminalId?: string) => {
    // Open terminal if not open
    if (!isTerminalOpen) {
      setIsTerminalOpen(true)
    }
    
    const targetTerminalId = terminalId || activeTerminalId
    
    // Small delay to ensure terminal is ready
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Use the terminal API to run the command
    await terminal.runCommand(targetTerminalId, command)
  }, [isTerminalOpen, activeTerminalId])

  // Register the runCommand function with the workbench store for global access
  useEffect(() => {
    workbenchStore.registerTerminalRunner(runCommand)
    workbenchStore.registerDeployTerminalFunctions({
      createDeployTerminal,
      openTerminal: () => setIsTerminalOpen(true),
    })
    return () => {
      workbenchStore.unregisterTerminalRunner()
    }
  }, [runCommand, createDeployTerminal])

  // Auto-create/remove tabs when the agent spawns or kills terminal sessions
  useEffect(() => {
    const cleanupCreated = terminal.onAgentTerminalCreated((terminalId: string) => {
      agentTerminalCountRef.current += 1
      const count = agentTerminalCountRef.current
      const name = count === 1 ? 'Agent' : `Agent ${count}`

      setTerminalTabs(prev => {
        if (prev.find(tab => tab.id === terminalId)) return prev
        return [...prev, { id: terminalId, name }]
      })
      setActiveTerminalId(terminalId)
      setIsTerminalOpen(true)
    })

    const cleanupClosed = terminal.onAgentTerminalClosed((terminalId: string) => {
      setTerminalTabs(prev => {
        const newTabs = prev.filter(t => t.id !== terminalId)
        if (newTabs.length === prev.length) return prev

        setActiveTerminalId(current => {
          if (current === terminalId && newTabs.length > 0) {
            return newTabs[newTabs.length - 1].id
          }
          return current
        })

        if (newTabs.length === 0) {
          setIsTerminalOpen(false)
          terminalCountRef.current = 1
          return [{ id: 'terminal-1', name: 'Terminal' }]
        }
        return newTabs
      })
    })

    return () => {
      cleanupCreated()
      cleanupClosed()
    }
  }, [])

  // Listen for agent-triggered dev server restart events
  const handleRestartServerRef = useRef<() => void>()
  useEffect(() => {
    const cleanup = terminal.onRestartDevServer(() => {
      handleRestartServerRef.current?.()
    })
    return cleanup
  }, [])

  // Track the temp directory path for the current project
  const tempDirPathRef = useRef<string | null>(null)

  // When project loads: create temp folder, write files, and run expo
  const lastProjectId = useRef<string | null>(null)
  const setupInitiatedRef = useRef(false)
  const filesSnapshotRef = useRef<typeof files | null>(null)

  useEffect(() => {
    // Only run when project changes (new project loaded) AND files are available AND AI is done
    console.log('[Workbench] Auto-run useEffect triggered', {
      projectId: project?.id,
      fileCount: Object.keys(files).length,
      updateInProgress: project?.updateInProgress,
      setupInitiated: setupInitiatedRef.current,
      lastProjectId: lastProjectId.current,
      gitProjectPath,
    })

    if (!project?.id) {
      console.log('[Workbench] No project ID, returning early')
      return
    }

    // Check if this is a new project
    const isNewProject = project.id !== lastProjectId.current

    // All projects are managed by projectStore — wait for the path to be available
    if (!gitProjectPath) {
      console.log('[Workbench] Waiting for project path from projectStore...')
      return
    }

    // Check if we have files to work with
    const fileCount = Object.keys(files).length
    if (fileCount === 0) {
      console.log('[Workbench] Waiting for files to be loaded...')
      return
    }

    // Reset setup state when project changes
    if (isNewProject) {
      setupInitiatedRef.current = false
      filesSnapshotRef.current = null
      lastProjectId.current = project.id

      // Reset preview state to prevent showing old project's content
      console.log('[Workbench] New project detected, resetting preview state')
      setPreviewUrl('')
      setServerStatus('starting')
      setExpoUrl('')
      terminalOutputBuffer.current = ''
      actualPortRef.current = portRange.start
      portConflictRef.current = false

      // Cleanup old project's temp directory if it exists
      if (tempDirPathRef.current) {
        console.log('[Workbench] Cleaning up temp directory for previous project')
        filesystem.cleanupTempDir(tempDirPathRef.current).catch(err =>
          console.error('[Workbench] Error cleaning up temp directory:', err)
        )
        tempDirPathRef.current = null
        workbenchStore.projectPath.setState(null, true)
      }
    }

    // Prevent running multiple times for the same project
    // setupInitiatedRef is set synchronously (line 679) so it alone prevents re-entry,
    // even before the async workbenchStore.projectPath.setState() has landed.
    console.log('[Workbench] Setup check:', { setupInitiated: setupInitiatedRef.current, fileCount })
    if (setupInitiatedRef.current) {
      console.log('[Workbench] Setup already initiated for this project, skipping')
      return
    }

    // Take a snapshot of files to prevent re-running when files object reference changes
    filesSnapshotRef.current = files
    setupInitiatedRef.current = true

    // Open terminal and start dev server setup
    setIsTerminalOpen(true)
    console.log(`[Workbench] Starting setup for project: ${project.id} with ${fileCount} files`)

    // Capture values at the time of setup to avoid dependency issues
    const capturedTerminalId = activeTerminalId
    const capturedWaitForReady = waitForTerminalReady

    // Helper function to run the dev server (used by both git and temp directory flows)
    const runDevServer = async (projectDir: string, launchConfig: LaunchConfig) => {
      console.log(`[Workbench] Waiting for terminal ${capturedTerminalId} to be ready...`)
      const isReady = await capturedWaitForReady(capturedTerminalId)

      if (!isReady) {
        console.warn('[Workbench] Terminal not ready after timeout, trying anyway...')
        await new Promise(resolve => setTimeout(resolve, 1500))
      } else {
        console.log(`[Workbench] Terminal ${capturedTerminalId} is ready!`)
      }

      // Wait for shell to emit its first output (prompt) before sending commands
      console.log('[Workbench] Waiting for shell prompt output...')
      const shellReady = await waitForShellReady(capturedTerminalId, 5000)
      if (shellReady) {
        console.log(`[Workbench] Shell prompt detected for ${capturedTerminalId}`)
      } else {
        console.warn('[Workbench] Shell prompt not detected within timeout, proceeding anyway')
      }

      // Check if terminal has exited
      if (terminalExitedRef.current.has(capturedTerminalId)) {
        console.error('[Workbench] Terminal exited unexpectedly during setup.')
        return
      }

      // Dynamically find an available port within the appropriate range
      // Use launch config type (more accurate than database appType)
      const isWebProject = launchConfig.type === 'web'
      const range = isWebProject ? { start: 9000, end: 9999 } : { start: 19000, end: 19999 }
      let actualPort = range.start

      try {
        const portResult = await terminal.findAvailablePort(range.start, range.end)
        if (portResult?.success && portResult.port) {
          actualPort = portResult.port
          console.log(`[Workbench] Using dynamically assigned port: ${actualPort}`)
        } else {
          console.warn(`[Workbench] Could not find available port, falling back to ${range.start}`)
        }
      } catch (error) {
        console.warn(`[Workbench] Error finding available port:`, error)
      }

      // Build command from launch config
      const command = buildFullCommand(launchConfig, projectDir, actualPort)
      console.log(`[Workbench] Running ${launchConfig.type} command:`, command)

      // Store the actual port for preview URL
      actualPortRef.current = actualPort

      // Track which terminal is running the dev server (for sending keypresses like 'i' for iOS)
      devServerTerminalIdRef.current = capturedTerminalId

      const result = await terminal.runCommand(capturedTerminalId, command)
      if (result && !result.success) {
        console.error('[Workbench] Failed to run command:', result.error)
      } else {
        console.log('[Workbench] Command sent successfully')
      }
    }

    const setupProjectAndRunExpo = async () => {
      // Wait for React to render the terminal panel before proceeding
      // This ensures the Terminal component has mounted
      await new Promise(resolve => setTimeout(resolve, 300))

      console.log(`[Workbench] Using project path: ${gitProjectPath}`)
      tempDirPathRef.current = gitProjectPath
      workbenchStore.projectPath.setState(gitProjectPath, true)

      // Get launch config from project files, or auto-detect from package.json
      let launchConfig = getLaunchConfig(files)
      if (!launchConfig) {
        // Try to detect from package.json (more accurate than database appType)
        launchConfig = detectLaunchConfig(files)
      }
      if (!launchConfig) {
        // Final fallback to database appType
        console.log('[Workbench] Using fallback defaults for appType:', appType)
        launchConfig = {
          type: appType,
          ...DEFAULT_CONFIGS[appType],
        }
      }
      console.log('[Workbench] Using launch config:', launchConfig)

      // Cache launch config in projects.json (fire-and-forget)
      window.conveyor?.localProjects?.updateLaunchConfig?.(project.id, launchConfig).catch(() => {})

      await runDevServer(gitProjectPath, launchConfig)
    }

    setupProjectAndRunExpo().catch((error) => {
      console.error('[Workbench] Error in setupProjectAndRunExpo:', error)
    })

    // No cleanup needed here - cleanup happens when detecting a new project above
    // This ensures temp directory persists across tab switches and re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.updateInProgress, Object.keys(files).length, gitProjectPath])
  // Note: Using files.length instead of files object to detect when files are loaded
  // project?.updateInProgress is included so auto-run triggers when AI finishes generating
  // gitProjectPath is included so projects wait for projectStore to resolve the path
  // activeTerminalId and waitForTerminalReady are captured at setup time
  // setupInitiatedRef prevents re-running after initial setup

  // Track previous streaming state for auto-refresh
  const prevChatStreamingRef = useRef(chatStreaming)

  // Auto-refresh preview when streaming ends (agent finishes making changes)
  useEffect(() => {
    const wasStreaming = prevChatStreamingRef.current
    const isNowDone = wasStreaming && !chatStreaming

    // Update the ref for next comparison
    prevChatStreamingRef.current = chatStreaming

    if (isNowDone && previewUrl) {
      console.log('[Workbench] Chat streaming ended, refreshing preview...')
      // Small delay to ensure files are written to disk
      setTimeout(() => {
        setPreviewRefreshKey(k => k + 1)
      }, 500)
    }
  }, [chatStreaming, previewUrl])

  // Expose methods via ref for external access
  useImperativeHandle(ref, () => ({
    runCommand,
    openTerminal: () => setIsTerminalOpen(true),
    getActiveTerminalId: () => activeTerminalId,
  }), [runCommand, activeTerminalId])

  // Track terminal tabs in a ref so we can clean them up on unmount
  const terminalTabsRef = useRef(terminalTabs)
  useEffect(() => {
    terminalTabsRef.current = terminalTabs
  }, [terminalTabs])

  // Track mount time to avoid cleanup during React StrictMode's quick remount
  const mountTimeRef = useRef(Date.now())
  useEffect(() => {
    mountTimeRef.current = Date.now()
  }, [])

  // Clean up any stale terminal sessions from a previous crash
  useEffect(() => {
    terminal.killAll().catch((err: unknown) =>
      console.warn('[Workbench] Failed to clean up stale sessions:', err)
    )
  }, [])

  // Cleanup temp directory and kill all terminal sessions when workbench unmounts (user exits to landing page)
  useEffect(() => {
    return () => {
      // Always reset setup refs so the next mount can re-run auto-setup.
      // This is safe even during StrictMode's quick remount.
      setupInitiatedRef.current = false
      devServerTerminalIdRef.current = null
      terminalFirstOutputRef.current.clear()
      shellReadyResolversRef.current.clear()

      // Don't cleanup if we haven't been mounted for at least 1 second
      // This prevents React StrictMode's double-mount from killing terminals
      const mountDuration = Date.now() - mountTimeRef.current
      if (mountDuration < 1000) {
        console.log(`[Workbench] Skipping cleanup - component was only mounted for ${mountDuration}ms (StrictMode?)`)
        return
      }

      console.log(`[Workbench] Running cleanup after ${mountDuration}ms`)

      // Kill all terminal sessions (including dev server)
      terminalTabsRef.current.forEach(tab => {
        try {
          killTerminal(tab.id)
        } catch (err) {
          console.error(`[Workbench] Error killing terminal ${tab.id}:`, err)
        }
      })

      // Cleanup temp directory (only for legacy non-git projects)
      // Git-based projects are managed by projectStore and should NOT be deleted here
      if (tempDirPathRef.current) {
        // Check if this is a git project path (managed by projectStore)
        const isGitProject = tempDirPathRef.current.includes('/.bfloat-ide/projects/')
        if (!isGitProject) {
          filesystem.cleanupTempDir(tempDirPathRef.current)
            .catch(err => console.error('[Workbench] Error cleaning up temp directory:', err))
        }
        workbenchStore.projectPath.setState(null, true)
      }
    }
  }, [])


  const onEditorChange = useCallback((_path: string, value: string) => {
    workbenchStore.setCurrentDocumentContent(value)
  }, [])

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath)
  }, [])

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch((err) => {
      console.error('Failed to save file:', err)
    })
  }, [])

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument()
  }, [])

  const handleRefresh = useCallback(() => {
    if (previewUrl) {
      setPreviewRefreshKey(k => k + 1)
    }
  }, [previewUrl])

  // Handle errors from the preview iframe (LogBox, error overlay, etc.)
  // This captures clean error messages from the UI instead of raw terminal output
  const handlePreviewError = useCallback((error: string) => {
    console.log('[Workbench] Preview error received:', error)
    // Only set the error if not currently streaming (to avoid interrupting AI work)
    if (!chatStreaming) {
      workbenchStore.setPromptError(error)
    }
  }, [chatStreaming])

  // Expose preview URL to main process for MCP screenshot tool
  useEffect(() => {
    ;(window as any).__bfloatPreviewUrl = previewUrl
    return () => {
      ;(window as any).__bfloatPreviewUrl = ''
    }
  }, [previewUrl])

  // Handle screenshot from Preview component — add to chat as pending attachment
  const handleScreenshot = useCallback((dataUrl: string) => {
    workbenchStore.pendingScreenshot.setState(dataUrl, true)
    // Ensure chat panel is visible so the attachment can be consumed
    workbenchStore.setIsChatCollapsed(false)
  }, [])

  // Launch app in iOS Simulator (sends 'i' to Expo dev server)
  const handleLaunchIOSSimulator = useCallback(() => {
    const terminalId = devServerTerminalIdRef.current
    if (terminalId) {
      console.log('[Workbench] Launching iOS Simulator...')
      terminal.write(terminalId, 'i')
    } else {
      console.warn('[Workbench] Cannot launch iOS Simulator - no dev server terminal')
    }
  }, [])

  // Restart the dev server (kill current process and re-run)
  const handleRestartServer = useCallback(async () => {
    const terminalId = devServerTerminalIdRef.current
    if (!terminalId) {
      console.warn('[Workbench] Cannot restart server - no dev server terminal')
      return
    }

    console.log('[Workbench] Restarting dev server...')

    // Reset state
    setPreviewUrl('')
    setServerStatus('starting')
    setExpoUrl('')
    terminalOutputBuffer.current = ''

    // Send Ctrl+C to kill the current process
    terminal.write(terminalId, '\x03')

    // Wait for the process to be interrupted
    await new Promise(resolve => setTimeout(resolve, 500))

    // Find the project directory
    const projectDir = tempDirPathRef.current || workbenchStore.projectPath.getState()
    if (!projectDir) {
      console.error('[Workbench] Cannot restart server - no project directory')
      setServerStatus('error')
      return
    }

    // Re-detect launch config
    let launchConfig = getLaunchConfig(files)
    if (!launchConfig) {
      launchConfig = detectLaunchConfig(files)
    }
    if (!launchConfig) {
      launchConfig = {
        type: appType,
        ...DEFAULT_CONFIGS[appType],
      }
    }

    // Cache launch config in projects.json (fire-and-forget)
    window.conveyor?.localProjects?.updateLaunchConfig?.(project.id, launchConfig).catch(() => {})

    // Find a new available port
    const isWebProject = launchConfig.type === 'web'
    const range = isWebProject ? { start: 9000, end: 9999 } : { start: 19000, end: 19999 }
    let actualPort = range.start

    try {
      const portResult = await terminal.findAvailablePort(range.start, range.end)
      if (portResult?.success && portResult.port) {
        actualPort = portResult.port
      }
    } catch (error) {
      console.warn('[Workbench] Error finding available port:', error)
    }

    actualPortRef.current = actualPort

    // Build and run the command
    const command = buildFullCommand(launchConfig, projectDir, actualPort)
    console.log('[Workbench] Restarting with command:', command)

    const result = await terminal.runCommand(terminalId, command)
    if (result && !result.success) {
      console.error('[Workbench] Failed to restart dev server:', result.error)
      setServerStatus('error')
    }
  }, [files, appType])

  // Keep ref in sync so the IPC listener always calls the latest version
  handleRestartServerRef.current = handleRestartServer

  // Launch app in Android Emulator (sends 'a' to Expo dev server)
  const handleLaunchAndroidEmulator = useCallback(() => {
    const terminalId = devServerTerminalIdRef.current
    if (terminalId) {
      console.log('[Workbench] Launching Android Emulator...')
      terminal.write(terminalId, 'a')
    } else {
      console.warn('[Workbench] Cannot launch Android Emulator - no dev server terminal')
    }
  }, [])

  // Keep secrets in sync so Convex dashboard state reflects current credentials.
  useEffect(() => {
    if (!project.id) {
      setProjectSecrets([])
      return
    }

    let isCancelled = false

    secretsApi
      .readSecrets(project.id)
      .then((result) => {
        if (isCancelled || result.error || !result.secrets) return
        setProjectSecrets(result.secrets)
      })
      .catch(() => {})

    return () => {
      isCancelled = true
    }
  }, [project.id, secretsVersion, activeTab])

  const convexSecretStatus = useMemo(
    () => getConvexSecretStatusFromSecrets(projectSecrets, appType),
    [projectSecrets, appType]
  )

  const convexDashboardConfig = useMemo(() => {
    const fromSecrets = getConvexDashboardConfigFromSecrets(projectSecrets, appType)
    if (fromSecrets) return fromSecrets
    if (convexDeploymentKey && convexUrl && convexDeployment) {
      return {
        deployKey: convexDeploymentKey,
        deploymentUrl: convexUrl,
        deploymentName: convexDeployment,
      }
    }
    return null
  }, [projectSecrets, appType, convexDeploymentKey, convexUrl, convexDeployment])


  // Calculate slide position based on tab
  const tabOrder = ['editor', 'preview', 'database', 'payments', 'settings']
  const getSlidePosition = (tab: string) => {
    const currentIndex = tabOrder.indexOf(activeTab)
    const targetIndex = tabOrder.indexOf(tab)

    if (currentIndex === -1 || targetIndex === -1) return '100%'
    if (tab === activeTab) return '0%'
    if (targetIndex < currentIndex) return '-100%'
    return '100%'
  }

  return (
    <AppTypeProvider rawAppType={rawAppType}>
    <div className="workbench">
      {/* Main Content Area with Terminal */}
      <div className="workbench-main">
        {/* Workbench Content */}
        <div className="workbench-content" style={{ flex: isTerminalOpen ? `1 1 calc(100% - ${terminalHeight}px)` : '1 1 100%' }}>
          {isChatCollapsed ? (
            // Side by side layout when chat is collapsed
            <div className="workbench-split">
              <div className="workbench-split-editor">
                <EditorPanel
                  files={files}
                  selectedFile={selectedFile}
                  currentDocument={currentDocument}
                  unsavedFiles={unsavedFiles}
                  onFileSelect={onFileSelect}
                  onEditorChange={onEditorChange}
                  onFileSave={onFileSave}
                  onFileReset={onFileReset}
                  projectName={project.title}
                  isLoading={isFilesLoading}
                />
              </div>
              <div className="workbench-split-preview">
                <Preview
                  previewUrl={previewUrl}
                  serverStatus={serverStatus}
                  isTerminalOpen={isTerminalOpen}
                  terminalHeight={terminalHeight}
                  onRefresh={handleRefresh}
                  onRestartServer={handleRestartServer}
                  expoUrl={expoUrl}
                  appType={appType}
                  projectTitle={project.title}
                  onError={handlePreviewError}
                  onLaunchIOSSimulator={handleLaunchIOSSimulator}
                  onLaunchAndroidEmulator={handleLaunchAndroidEmulator}
                  onScreenshot={handleScreenshot}
                  refreshKey={previewRefreshKey}
                />
              </div>
            </div>
          ) : (
            // Animated tab switching
            <div className="workbench-tabs-content">
              {/* Database Tab */}
              {activeTab === 'database' && (
                <div className="workbench-tab-panel settings">
                  {convexDashboardConfig ? (
                    <ConvexDashboard
                      deployKey={convexDashboardConfig.deployKey}
                      deploymentUrl={convexDashboardConfig.deploymentUrl}
                      deploymentName={convexDashboardConfig.deploymentName}
                      isVisible={true}
                      onStatusChange={(status) => {
                        if (status !== 'error') return
                        console.warn('[Workbench] Convex dashboard entered error state')
                      }}
                      onError={(reason) => {
                        console.warn('[Workbench] Convex dashboard error:', reason)
                      }}
                      onOpenSettings={() => {
                        workbenchStore.setActiveTab('settings')
                      }}
                      onOpenExternal={() => {
                        window.open(
                          `https://dashboard.convex.dev/d/${convexDashboardConfig.deploymentName}`,
                          '_blank',
                          'noopener,noreferrer'
                        )
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                      {convexSecretStatus.hasUrl && !convexSecretStatus.hasDeployKey && (
                        <div className="max-w-md px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
                          Convex URL found, but `CONVEX_DEPLOY_KEY` is missing. Add it in Settings to load the Convex dashboard.
                        </div>
                      )}
                      <ConvexIntegration
                        isConnected={hasConvexIntegration || false}
                        onConnect={() => {
                          workbenchStore.setActiveTab('settings')
                          workbenchStore.setPendingIntegrationConnect({
                            integrationId: 'convex',
                            source: 'workbench',
                          })
                        }}
                        onDisconnect={async () => {
                          console.log('[Workbench] Convex disconnect requested (local-first mode)')
                          window.location.reload()
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Payments Tab */}
              {activeTab === 'payments' && (
                <div className="workbench-tab-panel settings">
                  <PaymentsOverview project={project} />
                </div>
              )}

              {/* Editor Tab */}
              <motion.div
                className="workbench-tab-panel"
                initial={false}
                animate={{
                  x: getSlidePosition('editor'),
                  opacity: activeTab === 'editor' ? 1 : 0,
                }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              >
                <EditorPanel
                  files={files}
                  selectedFile={selectedFile}
                  currentDocument={currentDocument}
                  unsavedFiles={unsavedFiles}
                  onFileSelect={onFileSelect}
                  onEditorChange={onEditorChange}
                  onFileSave={onFileSave}
                  onFileReset={onFileReset}
                  projectName={project.title}
                  isLoading={isFilesLoading}
                />
              </motion.div>

              {/* Preview Tab */}
              <motion.div
                className="workbench-tab-panel"
                initial={false}
                animate={{
                  x: getSlidePosition('preview'),
                  opacity: activeTab === 'preview' ? 1 : 0,
                }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              >
                <Preview
                  previewUrl={previewUrl}
                  serverStatus={serverStatus}
                  isTerminalOpen={isTerminalOpen}
                  terminalHeight={terminalHeight}
                  onRefresh={handleRefresh}
                  onRestartServer={handleRestartServer}
                  expoUrl={expoUrl}
                  appType={appType}
                  projectTitle={project.title}
                  onError={handlePreviewError}
                  onLaunchIOSSimulator={handleLaunchIOSSimulator}
                  onLaunchAndroidEmulator={handleLaunchAndroidEmulator}
                  onScreenshot={handleScreenshot}
                  refreshKey={previewRefreshKey}
                />
              </motion.div>

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="workbench-tab-panel settings">
                  <ProjectSettings project={project} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Terminal Panel */}
        <motion.div
          className="workbench-terminal-panel"
          initial={{ height: 0 }}
          animate={{ height: isTerminalOpen ? terminalHeight : 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          style={{ overflow: 'hidden' }}
        >
              {/* Invisible resize handle */}
              <div
                className="workbench-terminal-resize-handle"
                onMouseDown={handleResizeStart}
              />
              <div className="workbench-terminal-header">
                <div className="workbench-terminal-tabs">
                  <button
                    className="workbench-terminal-toggle"
                    onClick={() => setIsTerminalOpen(false)}
                    title="Collapse terminal"
                  >
                    <ChevronDown size={12} />
                  </button>
                  {terminalTabs.map((tab) => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={activeTerminalId === tab.id}
                      className={`workbench-terminal-tab ${activeTerminalId === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveTerminalId(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setActiveTerminalId(tab.id)
                        }
                      }}
                    >
                      <TerminalIcon size={10} />
                      <span>{tab.name}</span>
                      {terminalTabs.length > 1 && (
                        <span
                          className="workbench-terminal-tab-close"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => closeTerminalTab(tab.id, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              closeTerminalTab(tab.id, e as any)
                            }
                          }}
                          title="Close terminal"
                        >
                          <X size={9} />
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    className="workbench-terminal-add"
                    onClick={addTerminalTab}
                    title="New terminal"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="workbench-terminal-actions">
                  <button
                    className="workbench-terminal-action"
                    onClick={() => setIsTerminalOpen(false)}
                    title="Close panel"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="workbench-terminal-content">
                {terminalTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="workbench-terminal-instance"
                    style={{
                      display: 'flex',
                      visibility: activeTerminalId === tab.id ? 'visible' : 'hidden',
                      position: activeTerminalId === tab.id ? 'relative' : 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    }}
                  >
                    <Terminal
                      terminalId={tab.id}
                      onReady={() => handleTerminalReady(tab.id)}
                      onOutput={activeTerminalId === tab.id ? handleTerminalOutput : undefined}
                      onExit={(exitCode) => handleTerminalExit(tab.id, exitCode)}
                    />
                  </div>
                ))}
              </div>
        </motion.div>
      </div>

      {/* Bottom Bar with Terminal Toggle - only show when terminal is closed */}
      {!isTerminalOpen && (
        <div className="workbench-bottombar">
          <button
            className="workbench-bottombar-btn"
            onClick={() => setIsTerminalOpen(true)}
            title="Show terminal"
          >
            <TerminalIcon size={12} />
            <span>Terminal</span>
            <ChevronUp size={10} />
          </button>
        </div>
      )}
    </div>
    </AppTypeProvider>
  )
})
