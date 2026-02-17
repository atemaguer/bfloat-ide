/**
 * PTY State Machine
 *
 * Manages PTY process state with debounced prompt detection.
 * Uses raw buffer accumulation (proven reliable) instead of xterm-headless
 * to avoid async race conditions during multi-chunk writes.
 */

import { EventEmitter } from 'events'
import * as pty from 'node-pty'
import { PromptClassifier, type PromptType, type ClassificationResult } from './prompt-classifier'

export type PtyState =
  | 'idle'
  | 'running'
  | 'waiting_apple_id'
  | 'waiting_password'
  | 'waiting_2fa'
  | 'waiting_menu'
  | 'waiting_unknown'
  | 'complete'
  | 'error'

export interface PtyStateManagerOptions {
  /** Milliseconds of debounce before checking for prompt (default: 100) */
  promptCheckDelay?: number
  /** Max characters to keep in output buffer for prompt detection (default: 2000) */
  bufferSize?: number
  /** Minimum confidence for auto-responding to prompts (default: 0.8) */
  autoResponseThreshold?: number
}

export interface PromptDetectedEvent {
  type: PromptType
  confidence: number
  tail: string
  classification: ClassificationResult
}

export interface PtyStateManagerEvents {
  'state-change': (state: PtyState, previousState: PtyState) => void
  'prompt-detected': (event: PromptDetectedEvent) => void
  'data': (data: string) => void
  'exit': (exitCode: number) => void
  'error': (error: Error) => void
}

export class PtyStateManager extends EventEmitter {
  private state: PtyState = 'idle'
  private ptyProcess: pty.IPty | null = null
  private outputBuffer: string = ''
  private lastOutputTime: number = 0
  private promptCheckTimer: NodeJS.Timeout | null = null
  private classifier: PromptClassifier
  private disposed: boolean = false

  private readonly promptCheckDelay: number
  private readonly bufferSize: number
  private readonly autoResponseThreshold: number

  constructor(options: PtyStateManagerOptions = {}) {
    super()
    this.promptCheckDelay = options.promptCheckDelay ?? 100
    this.bufferSize = options.bufferSize ?? 2000
    this.autoResponseThreshold = options.autoResponseThreshold ?? 0.8
    this.classifier = new PromptClassifier()
  }

  /**
   * Start a PTY process with the given command
   */
  spawn(
    command: string,
    args: string[],
    options: {
      cwd?: string
      env?: Record<string, string>
      cols?: number
      rows?: number
    }
  ): void {
    if (this.ptyProcess) {
      this.kill()
    }

    this.disposed = false
    this.outputBuffer = ''
    this.lastOutputTime = Date.now()
    this.setState('running')

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
    const shellArgs = process.platform === 'win32'
      ? ['-Command', `${command} ${args.join(' ')}`]
      : ['-c', `${command} ${args.join(' ')}`]

    try {
      this.ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 40,
        cwd: options.cwd,
        env: {
          ...process.env as Record<string, string>,
          ...options.env,
          TERM: 'xterm-256color',
        },
      })

      this.ptyProcess.onData((data) => {
        if (this.disposed) return
        this.handleData(data)
      })

      this.ptyProcess.onExit(({ exitCode }) => {
        if (this.disposed) return
        this.handleExit(exitCode)
      })
    } catch (error) {
      this.setState('error')
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Write input to the PTY process
   */
  write(data: string): void {
    if (this.ptyProcess && !this.disposed) {
      this.ptyProcess.write(data)
      // Reset to running after input
      if (this.state.startsWith('waiting_')) {
        this.setState('running')
      }
    }
  }

  /**
   * Kill the PTY process
   */
  kill(): void {
    this.disposed = true
    this.clearPromptCheckTimer()

    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill()
      } catch {
        // Ignore kill errors
      }
      this.ptyProcess = null
    }

    this.outputBuffer = ''
  }

  /**
   * Get current state
   */
  getState(): PtyState {
    return this.state
  }

  /**
   * Get the output buffer tail for context
   */
  getOutputTail(length: number = 500): string {
    return this.outputBuffer.slice(-length)
  }

  /**
   * Clear the output buffer (call after handling a prompt to prevent re-detection)
   */
  clearBuffer(): void {
    this.outputBuffer = ''
  }

  /**
   * Check if the process is in a waiting state
   */
  isWaiting(): boolean {
    return this.state.startsWith('waiting_')
  }

  /**
   * Handle incoming PTY data
   */
  private handleData(data: string): void {
    this.lastOutputTime = Date.now()

    // Accumulate raw data in buffer
    this.outputBuffer += data

    // Trim buffer if too large
    if (this.outputBuffer.length > this.bufferSize) {
      this.outputBuffer = this.outputBuffer.slice(-this.bufferSize)
    }

    // Emit raw data for logging
    this.emit('data', data)

    // Schedule prompt check with debounce
    this.schedulePromptCheck()
  }

  /**
   * Handle PTY exit
   */
  private handleExit(exitCode: number): void {
    this.clearPromptCheckTimer()

    // Check buffer for success indicators
    const isSuccess = /available on TestFlight|Successfully submitted|submission.*successful/i.test(
      this.outputBuffer
    )

    if (isSuccess || exitCode === 0) {
      this.setState('complete')
    } else {
      this.setState('error')
    }

    this.emit('exit', exitCode)
    this.ptyProcess = null
  }

  /**
   * Schedule a debounced prompt check
   */
  private schedulePromptCheck(): void {
    this.clearPromptCheckTimer()

    this.promptCheckTimer = setTimeout(() => {
      if (!this.disposed) {
        this.checkForPrompt()
      }
    }, this.promptCheckDelay)
  }

  /**
   * Clear the prompt check timer
   */
  private clearPromptCheckTimer(): void {
    if (this.promptCheckTimer) {
      clearTimeout(this.promptCheckTimer)
      this.promptCheckTimer = null
    }
  }

  /**
   * Check output tail for prompt patterns after debounce
   */
  private checkForPrompt(): void {
    const tail = this.outputBuffer.slice(-500)
    const classification = this.classifier.classify(tail)

    // Map classification to state
    const stateMap: Record<PromptType, PtyState> = {
      apple_id: 'waiting_apple_id',
      password: 'waiting_password',
      '2fa': 'waiting_2fa',
      menu: 'waiting_menu',
      yes_no: 'waiting_unknown', // Generic prompts go to unknown
      unknown: 'waiting_unknown',
    }

    const newState = stateMap[classification.type]

    // Only emit if we detect a waiting state
    // Lower threshold (0.3) for unknown to catch more stuck states
    if (classification.type !== 'unknown' || classification.confidence > 0.3) {
      this.setState(newState)

      this.emit('prompt-detected', {
        type: classification.type,
        confidence: classification.confidence,
        tail,
        classification,
      })
    }
  }

  /**
   * Update state and emit change event
   */
  private setState(newState: PtyState): void {
    if (newState !== this.state) {
      const previousState = this.state
      this.state = newState
      this.emit('state-change', newState, previousState)
    }
  }

  /**
   * Type-safe event subscription
   */
  on<K extends keyof PtyStateManagerEvents>(
    event: K,
    listener: PtyStateManagerEvents[K]
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  emit<K extends keyof PtyStateManagerEvents>(
    event: K,
    ...args: Parameters<PtyStateManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args)
  }
}
