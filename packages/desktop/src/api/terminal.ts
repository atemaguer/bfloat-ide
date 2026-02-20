/**
 * terminal.ts — Terminal API client for the Bfloat sidecar.
 *
 * Mirrors the existing Electron TerminalApi surface so that renderer code
 * can be migrated with minimal changes:
 *
 *   // Before (Electron):
 *   window.conveyor.terminal.create(id, cwd)
 *
 *   // After (Tauri):
 *   api.terminal.create(id, cwd)
 *
 * HTTP routes expected on the sidecar:
 *   POST   /api/terminal/create          — create a session
 *   DELETE /api/terminal/:id             — kill a session
 *   POST   /api/terminal/:id/resize      — resize the PTY
 *   POST   /api/terminal/:id/write       — write data to the PTY
 *   GET    /api/terminal/sessions        — list active sessions
 *   GET    /api/terminal/:id/cwd         — get working directory
 *   GET    /api/terminal/check-port      — check if a port is available
 *   GET    /api/terminal/find-port       — find an available port
 *   WS     /api/terminal/ws/:id          — stream PTY I/O
 */

import type { HttpClient } from "./client"
import { SidecarWebSocket } from "./websocket"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalCreateOptions {
  /** Stable identifier for the terminal session (caller-provided). */
  terminalId: string
  /** Working directory to start the shell in. */
  cwd?: string
}

export interface TerminalCreateResult {
  success: boolean
  error?: string
}

export interface TerminalWriteResult {
  success: boolean
  error?: string
}

export interface TerminalResizeResult {
  success: boolean
  error?: string
}

export interface TerminalKillResult {
  success: boolean
  error?: string
}

export interface TerminalSession {
  terminalId: string
  pid?: number
  cwd?: string
}

export interface TerminalListResult {
  sessions: TerminalSession[]
}

export interface CheckPortResult {
  available: boolean
  port: number
}

export interface FindPortResult {
  success: boolean
  port?: number
  error?: string
}

/** Messages sent from the sidecar over the terminal stream WebSocket. */
export type TerminalStreamMessage =
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number }

/** Messages the client sends to the sidecar over the terminal stream WebSocket. */
export type TerminalStreamCommand =
  | { type: "write"; data: string }
  | { type: "resize"; cols: number; rows: number }

// ---------------------------------------------------------------------------
// TerminalApi
// ---------------------------------------------------------------------------

export class TerminalApi {
  constructor(
    private readonly http: HttpClient,
  ) {}

  // --------------------------------------------------------------------------
  // Session lifecycle
  // --------------------------------------------------------------------------

  /**
   * Create a new terminal session.
   *
   * @param terminalId  Caller-assigned identifier (used as the session key).
   * @param cwd         Starting working directory (defaults to home directory).
   */
  async create(
    terminalId: string,
    cwd?: string,
  ): Promise<TerminalCreateResult> {
    try {
      await this.http.post<{
        id: string
        isPty: boolean
        cols: number
        rows: number
        shell: string
        cwd: string
      }>("/api/terminal/create", {
        id: terminalId,
        cwd,
      })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Kill a terminal session.
   *
   * @param terminalId  Identifier returned from `create()`.
   */
  async kill(terminalId: string): Promise<TerminalKillResult> {
    try {
      await this.http.delete<{ ok: boolean }>(
        `/api/terminal/${encodeURIComponent(terminalId)}`,
      )
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * List all active terminal sessions.
   */
  async list(): Promise<TerminalListResult> {
    return this.http.get<TerminalListResult>("/api/terminal/sessions")
  }

  // --------------------------------------------------------------------------
  // PTY control
  // --------------------------------------------------------------------------

  /**
   * Write raw data to a terminal's stdin.
   *
   * @param terminalId  Session identifier.
   * @param data        Raw bytes/string to write (e.g. a command + "\r").
   */
  async write(terminalId: string, data: string): Promise<TerminalWriteResult> {
    try {
      await this.http.post<{ ok: boolean }>(
        `/api/terminal/${encodeURIComponent(terminalId)}/write`,
        { data },
      )
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Resize the PTY associated with a terminal session.
   *
   * @param terminalId  Session identifier.
   * @param cols        New number of columns.
   * @param rows        New number of rows.
   */
  async resize(
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<TerminalResizeResult> {
    try {
      await this.http.post<{ ok: boolean }>(
        `/api/terminal/${encodeURIComponent(terminalId)}/resize`,
        { cols, rows },
      )
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // --------------------------------------------------------------------------
  // Working directory
  // --------------------------------------------------------------------------

  /**
   * Get the current working directory of a terminal session.
   * Falls back to the system default working directory when no terminalId is
   * provided.
   */
  async getCwd(terminalId?: string): Promise<string> {
    if (terminalId) {
      const result = await this.http.get<{ cwd: string }>(
        `/api/terminal/${encodeURIComponent(terminalId)}/cwd`,
      )
      return result.cwd
    }

    const result = await this.http.get<{ cwd: string }>("/api/terminal/cwd")
    return result.cwd
  }

  // --------------------------------------------------------------------------
  // Port utilities
  // --------------------------------------------------------------------------

  /**
   * Check whether a specific port is free on the host machine.
   *
   * @param port  Port number to check.
   */
  async checkPort(port: number): Promise<CheckPortResult> {
    return this.http.get<CheckPortResult>(
      `/api/terminal/check-port?port=${port}`,
    )
  }

  /**
   * Find an available TCP port within a range.
   *
   * @param startPort  Preferred starting port (default: 3000).
   * @param endPort    Upper bound (inclusive).  Defaults to startPort + 999.
   */
  async findAvailablePort(
    startPort: number = 3000,
    endPort?: number,
  ): Promise<FindPortResult> {
    const params = new URLSearchParams({ startPort: String(startPort) })
    if (endPort !== undefined) params.set("endPort", String(endPort))
    return this.http.get<FindPortResult>(`/api/terminal/find-port?${params}`)
  }

  // --------------------------------------------------------------------------
  // Streaming I/O
  // --------------------------------------------------------------------------

  /**
   * Open a bidirectional WebSocket stream for a terminal session.
   *
   * Incoming messages from the sidecar carry PTY output (`type: "data"`) and
   * exit notifications (`type: "exit"`).  Outgoing messages can write data to
   * the PTY or resize it.
   *
   * The caller is responsible for calling `ws.connect()` after subscribing to
   * events, and `ws.close()` when the session ends.
   *
   * @example
   *   const ws = api.terminal.connect("my-terminal-id")
   *   ws.on("message", (msg) => {
   *     if (msg.type === "data") term.write(msg.data)
   *     if (msg.type === "exit") handleExit(msg.exitCode)
   *   })
   *   ws.connect()
   *
   * @param terminalId  Session identifier.
   */
  connect(
    terminalId: string,
  ): SidecarWebSocket<TerminalStreamMessage, TerminalStreamCommand> {
    const wsUrl = this.http.wsUrl(
      `/api/terminal/ws/${encodeURIComponent(terminalId)}`,
    )
    return new SidecarWebSocket<TerminalStreamMessage, TerminalStreamCommand>(
      wsUrl,
    )
  }

  // --------------------------------------------------------------------------
  // Convenience helpers (parity with the Electron TerminalApi)
  // --------------------------------------------------------------------------

  /**
   * Execute a command in a terminal by writing it followed by a carriage return.
   * Equivalent to pressing Enter in the shell.
   */
  async runCommand(terminalId: string, command: string): Promise<TerminalWriteResult> {
    return this.write(terminalId, command + "\r")
  }
}
