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

    requestAnimationFrame(() => {
      fitAddon.fit()
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

    // Create PTY
    if (!createdTerminals.has(terminalId)) {
      createdTerminals.add(terminalId)
      terminal.create(terminalId).then((result) => {
        if (result.success) {
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
        }
      })
    }

    return () => {
      console.log(`[DeployTerminal] Disposing terminal: ${terminalId}`)
      unsubTheme()
      terminal.removeListeners(terminalId)
      xterminal.dispose()
      isInitializedRef.current = false
    }
  }, [terminalId])

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
