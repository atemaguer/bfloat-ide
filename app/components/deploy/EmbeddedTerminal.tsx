/**
 * Embedded Terminal Component
 *
 * A smaller, styled terminal for use within modals and wizards.
 * Used for interactive credential setup (Apple 2FA, etc).
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as TerminalIcon, Check, Loader2 } from 'lucide-react'

interface EmbeddedTerminalProps {
  terminalId: string
  projectPath: string
  command: string
  /** Pattern to detect when the command is complete */
  completionPattern?: RegExp
  /** Callback when completion pattern is detected */
  onComplete?: () => void
  /** Callback when an error is detected */
  onError?: (error: string) => void
  /** Height of the terminal (default: 200px) */
  height?: number
  /** Whether to auto-scroll to bottom */
  autoScroll?: boolean
}

export function EmbeddedTerminal({
  terminalId,
  projectPath,
  command,
  completionPattern,
  onComplete,
  onError,
  height = 200,
  autoScroll = true,
}: EmbeddedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [output, setOutput] = useState<string>('')
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const outputRef = useRef<string>('')

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [output, autoScroll])

  // Handle terminal output
  const handleOutput = useCallback(
    (id: string, data: string) => {
      if (id !== terminalId) return

      outputRef.current += data
      setOutput(outputRef.current)

      // Check for completion pattern
      if (completionPattern && completionPattern.test(outputRef.current)) {
        setIsComplete(true)
        onComplete?.()
      }

      // Check for error patterns
      const errorPatterns = [
        /Error:/i,
        /Authentication failed/i,
        /Invalid credentials/i,
        /FAILURE/i,
      ]

      for (const pattern of errorPatterns) {
        if (pattern.test(data)) {
          const errorMatch = data.match(/(?:Error:|error:)\s*(.+)/i)
          onError?.(errorMatch?.[1]?.trim() || 'An error occurred')
          break
        }
      }
    },
    [terminalId, completionPattern, onComplete, onError]
  )

  // Initialize terminal and run command
  useEffect(() => {
    let isMounted = true

    // Guard against missing projectPath
    if (!projectPath) {
      console.error('[EmbeddedTerminal] No project path provided')
      onError?.('No project path provided')
      return
    }

    // Guard against missing terminal API
    if (!window.conveyor?.terminal) {
      console.error('[EmbeddedTerminal] Terminal API not available')
      onError?.('Terminal API not available')
      return
    }

    console.log('[EmbeddedTerminal] Initializing with:', { terminalId, projectPath, command })

    // Set up output listener FIRST (before creating terminal to avoid race condition)
    window.conveyor.terminal.onData(terminalId, handleOutput)

    async function initTerminal() {
      try {
        // Create terminal
        const result = await window.conveyor.terminal.create(terminalId, projectPath)

        if (!result.success) {
          console.error('[EmbeddedTerminal] Failed to create terminal:', result.error)
          onError?.(result.error || 'Failed to create terminal')
          return
        }

        if (isMounted) {
          setIsRunning(true)
          // Run the command
          await window.conveyor.terminal.runCommand(terminalId, command)
        }
      } catch (error) {
        console.error('[EmbeddedTerminal] Error:', error)
        onError?.(error instanceof Error ? error.message : 'Failed to start terminal')
      }
    }

    initTerminal()

    // Cleanup
    return () => {
      isMounted = false
      try {
        window.conveyor.terminal.removeListeners(terminalId)
        window.conveyor.terminal.kill(terminalId)
      } catch {
        // Ignore cleanup errors
      }
    }
  }, [terminalId, projectPath, command, handleOutput, onError])

  return (
    <div className="rounded-lg border border-border bg-black overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border">
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Terminal</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && !isComplete && (
            <div className="flex items-center gap-1 text-xs text-yellow-500">
              <Loader2 size={12} className="animate-spin" />
              <span>Running</span>
            </div>
          )}
          {isComplete && (
            <div className="flex items-center gap-1 text-xs text-green-500">
              <Check size={12} />
              <span>Complete</span>
            </div>
          )}
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={containerRef}
        className="p-3 font-mono text-xs overflow-y-auto"
        style={{ height, backgroundColor: '#1e1e1e' }}
      >
        <pre className="whitespace-pre-wrap break-all text-gray-300">{output || 'Starting...'}</pre>
      </div>
    </div>
  )
}

/**
 * Interactive terminal that allows user input
 * Used for Apple 2FA and other interactive prompts
 */
interface InteractiveTerminalProps extends Omit<EmbeddedTerminalProps, 'command'> {
  command: string
  /** Patterns that indicate waiting for user input */
  inputPromptPatterns?: RegExp[]
  /** Callback when input is needed */
  onInputNeeded?: () => void
}

export function InteractiveTerminal({
  terminalId,
  projectPath,
  command,
  completionPattern,
  inputPromptPatterns = [],
  onComplete,
  onError,
  onInputNeeded,
  height = 250,
}: InteractiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [output, setOutput] = useState<string>('')
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [waitingForInput, setWaitingForInput] = useState(false)
  const outputRef = useRef<string>('')

  // Default input prompts
  const defaultInputPrompts = [
    /Enter.*code/i,
    /Enter.*password/i,
    /Enter.*2FA/i,
    /Verification code/i,
    /\? /,
    /\(y\/n\)/i,
  ]

  const allInputPrompts = [...defaultInputPrompts, ...inputPromptPatterns]

  // Auto-scroll effect
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [output])

  // Focus input when waiting
  useEffect(() => {
    if (waitingForInput && inputRef.current) {
      inputRef.current.focus()
    }
  }, [waitingForInput])

  // Handle terminal output
  const handleOutput = useCallback(
    (id: string, data: string) => {
      if (id !== terminalId) return

      outputRef.current += data
      setOutput(outputRef.current)

      // Check for input prompts
      for (const pattern of allInputPrompts) {
        if (pattern.test(data)) {
          setWaitingForInput(true)
          onInputNeeded?.()
          break
        }
      }

      // Check for completion pattern
      if (completionPattern && completionPattern.test(outputRef.current)) {
        setIsComplete(true)
        setWaitingForInput(false)
        onComplete?.()
      }

      // Check for error patterns
      const errorPatterns = [/Error:/i, /Authentication failed/i, /FAILURE/i]

      for (const pattern of errorPatterns) {
        if (pattern.test(data)) {
          const errorMatch = data.match(/(?:Error:|error:)\s*(.+)/i)
          onError?.(errorMatch?.[1]?.trim() || 'An error occurred')
          break
        }
      }
    },
    [terminalId, completionPattern, allInputPrompts, onComplete, onError, onInputNeeded]
  )

  // Send input to terminal
  const sendInput = useCallback(
    async (text: string) => {
      try {
        await window.conveyor.terminal.runCommand(terminalId, text)
        setInput('')
        setWaitingForInput(false)
      } catch (error) {
        console.error('[InteractiveTerminal] Error sending input:', error)
      }
    },
    [terminalId]
  )

  // Handle input submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (input.trim()) {
        sendInput(input)
      }
    },
    [input, sendInput]
  )

  // Initialize terminal and run command
  useEffect(() => {
    let isMounted = true

    // Guard against missing projectPath
    if (!projectPath) {
      console.error('[InteractiveTerminal] No project path provided')
      onError?.('No project path provided')
      return
    }

    // Guard against missing terminal API
    if (!window.conveyor?.terminal) {
      console.error('[InteractiveTerminal] Terminal API not available')
      onError?.('Terminal API not available')
      return
    }

    console.log('[InteractiveTerminal] Initializing with:', { terminalId, projectPath, command })

    // Set up output listener FIRST (before creating terminal to avoid race condition)
    window.conveyor.terminal.onData(terminalId, handleOutput)

    async function initTerminal() {
      try {
        // Verify the directory exists before trying to create terminal
        if (window.conveyor?.filesystem) {
          const checkResult = await window.conveyor.filesystem.readFile(`${projectPath}/package.json`)
          console.log('[InteractiveTerminal] Directory check:', { exists: checkResult.success, projectPath })
        }

        console.log('[InteractiveTerminal] Creating terminal...')
        // Try to create terminal - if it fails with the project path, the error will be caught
        let result = await window.conveyor.terminal.create(terminalId, projectPath)
        let useHomeFallback = false

        // If creation failed, try with no specific cwd (will use home directory)
        if (!result.success && result.error?.includes('posix_spawnp')) {
          console.log('[InteractiveTerminal] Retrying with home directory...')
          result = await window.conveyor.terminal.create(terminalId)
          useHomeFallback = true
        }
        console.log('[InteractiveTerminal] Create result:', result)

        if (!result.success) {
          console.error('[InteractiveTerminal] Failed to create terminal:', result.error)
          onError?.(result.error || 'Failed to create terminal')
          return
        }

        if (isMounted) {
          setIsRunning(true)
          // If we fell back to home directory, prepend cd to the command
          const finalCommand = useHomeFallback
            ? `cd "${projectPath}" && ${command}`
            : command
          await window.conveyor.terminal.runCommand(terminalId, finalCommand)
        }
      } catch (error) {
        console.error('[InteractiveTerminal] Error:', error)
        onError?.(error instanceof Error ? error.message : 'Failed to start terminal')
      }
    }

    initTerminal()

    return () => {
      isMounted = false
      try {
        window.conveyor.terminal.removeListeners(terminalId)
        window.conveyor.terminal.kill(terminalId)
      } catch {
        // Ignore cleanup errors
      }
    }
  }, [terminalId, projectPath, command, handleOutput, onError])

  return (
    <div className="rounded-lg border border-border bg-black overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border">
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Interactive Terminal</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && !isComplete && !waitingForInput && (
            <div className="flex items-center gap-1 text-xs text-yellow-500">
              <Loader2 size={12} className="animate-spin" />
              <span>Running</span>
            </div>
          )}
          {waitingForInput && (
            <div className="flex items-center gap-1 text-xs text-blue-500">
              <span>Waiting for input</span>
            </div>
          )}
          {isComplete && (
            <div className="flex items-center gap-1 text-xs text-green-500">
              <Check size={12} />
              <span>Complete</span>
            </div>
          )}
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={containerRef}
        className="p-3 font-mono text-xs overflow-y-auto"
        style={{ height, backgroundColor: '#1e1e1e' }}
      >
        <pre className="whitespace-pre-wrap break-all text-gray-300">{output || 'Starting...'}</pre>
      </div>

      {/* Input area */}
      {waitingForInput && !isComplete && (
        <form onSubmit={handleSubmit} className="flex border-t border-border">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter your response..."
            className="flex-1 px-3 py-2 bg-black text-white text-sm font-mono focus:outline-none placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </div>
  )
}
