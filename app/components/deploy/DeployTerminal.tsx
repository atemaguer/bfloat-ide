import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { themeStore } from '@/app/stores/theme'
import { getDeployTerminalTheme } from '@/app/components/terminal/terminal-theme'
import { terminal } from '@/app/api/sidecar'
import '@xterm/xterm/css/xterm.css'

interface DeployTerminalProps {
  terminalId: string
  onReady?: () => void
  onOutput?: (data: string) => void
  onExit?: (exitCode: number) => void
  height?: number
}

// Track which terminals have been created
const createdTerminals = new Set<string>()

export function DeployTerminal({
  terminalId,
  onReady,
  onOutput,
  onExit,
  height = 300,
}: DeployTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isInitializedRef = useRef(false)
  const ptyCreatedRef = useRef(false)
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

    console.log(`[DeployTerminal] Initializing terminal: ${terminalId}`)
    isInitializedRef.current = true
    ptyCreatedRef.current = false

    const xterminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", "SF Mono", "Monaco", "Consolas", "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      theme: getDeployTerminalTheme(themeStore.resolvedTheme.getState()),
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    xterminal.loadAddon(fitAddon)
    xterminal.open(containerRef.current)

    terminalRef.current = xterminal
    fitAddonRef.current = fitAddon

    // Subscribe to theme changes
    const unsubTheme = themeStore.resolvedTheme.subscribe((resolved) => {
      if (terminalRef.current) {
        terminalRef.current.options.theme = getDeployTerminalTheme(resolved)
      }
    })

    // Set up listeners
    terminal.onData(terminalId, (id, data) => {
      if (id === terminalId && terminalRef.current) {
        terminalRef.current.write(data)
        onOutputRef.current?.(data)
      }
    })

    terminal.onExit(terminalId, (id, exitCode) => {
      console.log(`[DeployTerminal] Terminal ${id} exited with code: ${exitCode}`)
      if (id === terminalId && terminalRef.current) {
        terminalRef.current.writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m`)
      }
      createdTerminals.delete(terminalId)
      onExitRef.current?.(exitCode)
    })

    // Handle user input
    xterminal.onData((data) => {
      terminal.write(terminalId, data)
    })

    // Handle terminal resize
    xterminal.onResize(({ cols, rows }) => {
      terminal.resize(terminalId, cols, rows)
    })

    // PTY creation is deferred to the ResizeObserver callback (see below)

    return () => {
      console.log(`[DeployTerminal] Disposing terminal: ${terminalId}`)
      unsubTheme()
      terminal.removeListeners(terminalId)
      xterminal.dispose()
      isInitializedRef.current = false
    }
  }, [terminalId])

  // Handle container resize — also triggers initial PTY creation
  useEffect(() => {
    const createPtyIfNeeded = async () => {
      if (ptyCreatedRef.current || !fitAddonRef.current || !terminalRef.current) return

      const xterminal = terminalRef.current
      const fitAddon = fitAddonRef.current

      // Check container has real dimensions
      const container = containerRef.current
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) return

      fitAddon.fit()
      const cols = xterminal.cols
      const rows = xterminal.rows

      // Sanity check: don't create PTY with default/zero dimensions
      if (cols <= 1 || rows <= 1) return

      // Already tracked globally — skip
      if (createdTerminals.has(terminalId)) {
        ptyCreatedRef.current = true
        console.log(`[DeployTerminal] PTY already exists for: ${terminalId}, reconnecting`)
        terminal.resize(terminalId, cols, rows)
        onReadyRef.current?.()
        return
      }

      ptyCreatedRef.current = true
      createdTerminals.add(terminalId)
      console.log(`[DeployTerminal] Creating PTY with initial size: ${cols}x${rows}`)

      const result = await terminal.create(terminalId, undefined, cols, rows)

      if (result.success) {
        // Re-fit and sync in case container resized during PTY creation
        requestAnimationFrame(() => {
          if (fitAddonRef.current && terminalRef.current) {
            fitAddonRef.current.fit()
            terminal.resize(
              terminalId,
              terminalRef.current.cols,
              terminalRef.current.rows
            )
          }
        })
        onReadyRef.current?.()
      } else {
        if (terminalRef.current) {
          terminalRef.current.writeln(`\x1b[31mFailed to create terminal: ${result.error}\x1b[0m`)
        }
        createdTerminals.delete(terminalId)
        ptyCreatedRef.current = false
      }
    }

    const handleResize = () => {
      if (!ptyCreatedRef.current) {
        createPtyIfNeeded()
        return
      }
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
  }, [terminalId])

  const handleClick = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  return (
    <div
      className="rounded-lg overflow-hidden border border-input bg-background"
      style={{ height }}
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

export function killDeployTerminal(terminalId: string): void {
  console.log(`[DeployTerminal] Killing terminal: ${terminalId}`)
  createdTerminals.delete(terminalId)
  terminal.kill(terminalId)
}
