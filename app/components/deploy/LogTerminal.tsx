/**
 * LogTerminal - A read-only xterm.js terminal for displaying log output
 *
 * Unlike DeployTerminal, this doesn't create a PTY - it just renders
 * terminal output with proper ANSI code support (colors, formatting).
 */

import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { themeStore } from '@/app/stores/theme'
import { getLogTerminalTheme } from '@/app/components/terminal/terminal-theme'
import '@xterm/xterm/css/xterm.css'

interface LogTerminalProps {
  /** Log content to display - when this changes, new content is appended */
  logs: string
  /** Height of the terminal in pixels */
  height?: number
}

export function LogTerminal({ logs, height = 200 }: LogTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastLogsLengthRef = useRef(0)

  // Initialize terminal
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Wait for container to have dimensions before opening terminal
    const initTerminal = () => {
      // Check if container has dimensions
      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        // Retry after a short delay
        const retryTimeout = setTimeout(initTerminal, 50)
        return () => clearTimeout(retryTimeout)
      }

      const terminal = new XTerm({
        cursorBlink: false,
        cursorStyle: 'bar',
        disableStdin: true, // Read-only
        fontFamily: '"JetBrains Mono", "SF Mono", "Monaco", "Consolas", "Liberation Mono", monospace',
        fontSize: 12,
        lineHeight: 1.3,
        scrollback: 5000,
        theme: getLogTerminalTheme(themeStore.resolvedTheme.get()),
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(container)

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      // Subscribe to theme changes
      const unsubTheme = themeStore.resolvedTheme.subscribe((resolved) => {
        if (terminalRef.current) {
          terminalRef.current.options.theme = getLogTerminalTheme(resolved)
        }
      })

      // Store unsub for cleanup
      ;(terminal as any).__unsubTheme = unsubTheme

      requestAnimationFrame(() => {
        fitAddon.fit()
      })
    }

    // Use requestAnimationFrame to ensure container is laid out
    const rafId = requestAnimationFrame(initTerminal)

    return () => {
      cancelAnimationFrame(rafId)
      if (terminalRef.current) {
        ;(terminalRef.current as any).__unsubTheme?.()
        terminalRef.current.dispose()
        terminalRef.current = null
      }
    }
  }, [])

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

  // Write new log content when logs change
  useEffect(() => {
    if (!terminalRef.current || !logs) return

    // Only write the new content (delta)
    if (logs.length > lastLogsLengthRef.current) {
      const newContent = logs.slice(lastLogsLengthRef.current)
      terminalRef.current.write(newContent)
      lastLogsLengthRef.current = logs.length
    } else if (logs.length < lastLogsLengthRef.current) {
      // Logs were cleared, reset terminal
      terminalRef.current.clear()
      terminalRef.current.write(logs)
      lastLogsLengthRef.current = logs.length
    }
  }, [logs])

  return (
    <div
      className="rounded-b-lg overflow-hidden bg-background"
      style={{ height }}
      ref={containerRef}
    />
  )
}
