import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { themeStore } from '@/app/stores/theme'
import { getTerminalTheme } from './terminal-theme'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

interface TerminalProps {
  terminalId: string
  onReady?: () => void
  onOutput?: (data: string) => void
  onExit?: (exitCode: number) => void
}

// Track which terminals have been created to avoid recreating on HMR
const createdTerminals = new Set<string>()
// Track terminals that are currently being killed to avoid race conditions
const pendingKillTerminals = new Set<string>()

export function Terminal({ terminalId, onReady, onOutput, onExit }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isInitializedRef = useRef(false)
  const onOutputRef = useRef(onOutput)
  const onReadyRef = useRef(onReady)
  const onExitRef = useRef(onExit)

  // Keep refs up to date
  useEffect(() => {
    onOutputRef.current = onOutput
  }, [onOutput])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return

    console.log(`[Terminal UI] Initializing terminal: ${terminalId}`)
    isInitializedRef.current = true

    // Create xterm instance with refined theme
    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", "Monaco", "Consolas", monospace',
      fontSize: 13,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.45,
      letterSpacing: 0.5,
      theme: getTerminalTheme(themeStore.resolvedTheme.getState()),
      allowProposedApi: true,
    })

    // Create fit addon
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    // Open terminal in container
    terminal.open(containerRef.current)

    // Store refs
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Subscribe to theme changes
    const unsubTheme = themeStore.resolvedTheme.subscribe((resolved) => {
      if (terminalRef.current) {
        terminalRef.current.options.theme = getTerminalTheme(resolved)
      }
    })

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit()
      console.log(`[Terminal UI] Terminal fitted: ${terminal.cols}x${terminal.rows}`)
    })

    // Set up listeners BEFORE creating PTY to capture all output
    console.log(`[Terminal UI] Setting up data listener for: ${terminalId}`)
    window.conveyor.terminal.onData(terminalId, (id, data) => {
      if (id === terminalId && terminalRef.current) {
        terminalRef.current.write(data)
        // Call onOutput callback for monitoring terminal output using ref
        onOutputRef.current?.(data)
      }
    })

    window.conveyor.terminal.onExit(terminalId, (id, exitCode) => {
      console.log(`[Terminal UI] Terminal ${id} exited with code: ${exitCode}`)
      if (id === terminalId && terminalRef.current) {
        terminalRef.current.writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m`)
      }
      createdTerminals.delete(terminalId)
      // Notify parent component that terminal has exited
      onExitRef.current?.(exitCode)
    })

    // Handle user input - send to PTY
    terminal.onData((data) => {
      window.conveyor.terminal.write(terminalId, data)
    })

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      window.conveyor.terminal.resize(terminalId, cols, rows)
    })

    // Create PTY only if not already created and not being killed
    const shouldCreatePty = !createdTerminals.has(terminalId)

    // Wait if terminal is currently being killed to avoid race conditions
    const waitForKillComplete = async () => {
      if (pendingKillTerminals.has(terminalId)) {
        console.log(`[Terminal UI] Waiting for pending kill of ${terminalId} to complete...`)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    if (shouldCreatePty) {
      console.log(`[Terminal UI] Creating PTY for: ${terminalId}`)
      createdTerminals.add(terminalId)

      waitForKillComplete().then(() => window.conveyor.terminal.create(terminalId)).then((result) => {
        console.log(`[Terminal UI] PTY create result:`, result)
        if (result.success) {
          // Send initial size after a small delay to ensure PTY is ready
          requestAnimationFrame(() => {
            if (fitAddonRef.current && terminalRef.current) {
              fitAddonRef.current.fit()
              const cols = terminalRef.current.cols
              const rows = terminalRef.current.rows
              console.log(`[Terminal UI] Sending initial resize: ${cols}x${rows}`)
              window.conveyor.terminal.resize(terminalId, cols, rows)
            }
          })
          onReadyRef.current?.()
        } else {
          if (terminalRef.current) {
            terminalRef.current.writeln(`\x1b[31mFailed to create terminal: ${result.error}\x1b[0m`)
          }
          createdTerminals.delete(terminalId)
        }
      })
    } else {
      console.log(`[Terminal UI] PTY already exists for: ${terminalId}, reconnecting`)
      // PTY exists, just resize and call onReady
      requestAnimationFrame(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          window.conveyor.terminal.resize(terminalId, terminalRef.current.cols, terminalRef.current.rows)
        }
        onReadyRef.current?.()
      })
    }

    // Cleanup - only dispose xterm UI, don't kill PTY
    return () => {
      console.log(`[Terminal UI] Disposing xterm UI for: ${terminalId}`)
      unsubTheme()
      window.conveyor.terminal.removeListeners(terminalId)
      terminal.dispose()
      isInitializedRef.current = false
      // Don't kill PTY here - it will be killed when the tab is closed
    }
  }, [terminalId])
  // Note: onOutput and onReady are intentionally not in deps to avoid re-initializing terminal

  // Handle container resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Focus terminal on click
  const handleClick = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  return (
    <div
      className="xterm-container"
      ref={containerRef}
      role="button"
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick()
        }
      }}
    />
  )
}

// Export function to kill terminal when tab is closed
export function killTerminal(terminalId: string) {
  console.log(`[Terminal UI] Killing terminal: ${terminalId}`)
  // Mark as pending kill to prevent race conditions with creation
  pendingKillTerminals.add(terminalId)
  createdTerminals.delete(terminalId)
  window.conveyor.terminal.kill(terminalId)
  // Clear pending kill after a short delay
  setTimeout(() => {
    pendingKillTerminals.delete(terminalId)
  }, 500)
}
