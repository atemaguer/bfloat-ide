/**
 * websocket.ts — Authenticated WebSocket client for the Bfloat sidecar.
 *
 * Features:
 *  - Automatic Basic-auth handshake via URL query parameter (browser WebSocket
 *    constructors cannot set arbitrary headers, so the password is sent as
 *    ?password=<uuid> which the sidecar accepts as an alternative to the
 *    Authorization header).
 *  - Typed event-emitter interface for incoming messages.
 *  - Automatic reconnection with exponential back-off and jitter.
 *  - JSON framing: outgoing messages are JSON.stringify'd; incoming messages
 *    are JSON.parse'd and forwarded to typed listeners.
 *
 * Usage:
 *   const ws = new SidecarWebSocket("ws://127.0.0.1:4000/terminal/abc/stream")
 *   ws.on("message", (data) => console.log(data))
 *   ws.on("close", () => console.log("closed"))
 *   ws.connect()
 *   ws.send({ type: "input", data: "ls -la\r" })
 *   ws.close()
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageListener<T> = (data: T) => void
type CloseListener = (code: number, reason: string) => void
type ErrorListener = (event: Event) => void
type OpenListener = () => void

export interface SidecarWebSocketOptions {
  /**
   * Maximum number of automatic reconnection attempts.
   * Set to 0 to disable auto-reconnect entirely.
   * @default 10
   */
  maxReconnects?: number

  /**
   * Initial delay (ms) before the first reconnect attempt.
   * Doubles on each subsequent attempt, capped at maxReconnectDelay.
   * @default 200
   */
  reconnectDelay?: number

  /**
   * Maximum reconnect delay in milliseconds.
   * @default 10_000
   */
  maxReconnectDelay?: number

  /**
   * Fraction of the delay added as random jitter (0–1).
   * Helps stagger reconnects from multiple clients.
   * @default 0.2
   */
  reconnectJitter?: number
}

// ---------------------------------------------------------------------------
// SidecarWebSocket
// ---------------------------------------------------------------------------

/**
 * A managed WebSocket connection to the Bfloat sidecar.
 *
 * Call `connect()` to open the connection.  The socket will automatically
 * reconnect unless `close()` is called explicitly or the maximum retry count
 * is exceeded.
 */
export class SidecarWebSocket<
  TIncoming = unknown,
  TOutgoing = unknown,
> {
  private readonly url: string
  private readonly options: Required<SidecarWebSocketOptions>

  private socket: WebSocket | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false

  // Event listener maps
  private readonly messageListeners = new Set<MessageListener<TIncoming>>()
  private readonly closeListeners = new Set<CloseListener>()
  private readonly errorListeners = new Set<ErrorListener>()
  private readonly openListeners = new Set<OpenListener>()

  constructor(url: string, options: SidecarWebSocketOptions = {}) {
    this.url = url
    this.options = {
      maxReconnects: options.maxReconnects ?? 10,
      reconnectDelay: options.reconnectDelay ?? 200,
      maxReconnectDelay: options.maxReconnectDelay ?? 10_000,
      reconnectJitter: options.reconnectJitter ?? 0.2,
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return // already connected or connecting
    }

    this.intentionallyClosed = false
    this.openSocket()
  }

  /**
   * Close the WebSocket and stop any pending reconnect timers.
   * After calling this, the socket will not reconnect automatically.
   */
  close(code = 1000, reason = "Client closed"): void {
    this.intentionallyClosed = true
    this.clearReconnectTimer()

    if (this.socket) {
      try {
        this.socket.close(code, reason)
      } catch {
        // ignore — socket may already be in CLOSING/CLOSED state
      }
      this.socket = null
    }
  }

  /** Whether the underlying WebSocket is currently open. */
  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  // --------------------------------------------------------------------------
  // Messaging
  // --------------------------------------------------------------------------

  /**
   * Send a message to the sidecar.  The value is JSON-serialised before
   * transmission.
   *
   * @throws If the socket is not currently open.
   */
  send(data: TOutgoing): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open — cannot send message")
    }
    this.socket.send(JSON.stringify(data))
  }

  /**
   * Send raw text (no JSON serialisation).  Use for binary protocols or
   * when the sidecar expects a plain string.
   */
  sendRaw(data: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open — cannot send message")
    }
    this.socket.send(data)
  }

  // --------------------------------------------------------------------------
  // Event subscriptions
  // --------------------------------------------------------------------------

  /** Subscribe to parsed incoming messages. Returns an unsubscribe function. */
  on(event: "message", listener: MessageListener<TIncoming>): () => void
  /** Subscribe to close events. Returns an unsubscribe function. */
  on(event: "close", listener: CloseListener): () => void
  /** Subscribe to error events. Returns an unsubscribe function. */
  on(event: "error", listener: ErrorListener): () => void
  /** Subscribe to the open/connect event. Returns an unsubscribe function. */
  on(event: "open", listener: OpenListener): () => void

  on(
    event: "message" | "close" | "error" | "open",
    listener: MessageListener<TIncoming> | CloseListener | ErrorListener | OpenListener,
  ): () => void {
    switch (event) {
      case "message":
        this.messageListeners.add(listener as MessageListener<TIncoming>)
        return () => this.messageListeners.delete(listener as MessageListener<TIncoming>)
      case "close":
        this.closeListeners.add(listener as CloseListener)
        return () => this.closeListeners.delete(listener as CloseListener)
      case "error":
        this.errorListeners.add(listener as ErrorListener)
        return () => this.errorListeners.delete(listener as ErrorListener)
      case "open":
        this.openListeners.add(listener as OpenListener)
        return () => this.openListeners.delete(listener as OpenListener)
    }
  }

  /** Remove all registered listeners. */
  removeAllListeners(): void {
    this.messageListeners.clear()
    this.closeListeners.clear()
    this.errorListeners.clear()
    this.openListeners.clear()
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private openSocket(): void {
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempts = 0
      for (const listener of this.openListeners) {
        try {
          listener()
        } catch (err) {
          console.error("[SidecarWebSocket] open listener threw:", err)
        }
      }
    }

    socket.onmessage = (event: MessageEvent) => {
      const raw = String(event.data)
      let parsed: TIncoming
      try {
        const candidate = JSON.parse(raw) as unknown
        // Preserve primitive payloads (e.g. "1") as raw text so terminal
        // output/input echo is not coerced into non-string values.
        parsed = (candidate !== null && typeof candidate === "object"
          ? candidate
          : raw) as TIncoming
      } catch {
        // Non-JSON frame — deliver the raw string cast to TIncoming.
        parsed = raw as TIncoming
      }

      for (const listener of this.messageListeners) {
        try {
          listener(parsed)
        } catch (err) {
          console.error("[SidecarWebSocket] message listener threw:", err)
        }
      }
    }

    socket.onerror = (event: Event) => {
      for (const listener of this.errorListeners) {
        try {
          listener(event)
        } catch (err) {
          console.error("[SidecarWebSocket] error listener threw:", err)
        }
      }
    }

    socket.onclose = (event: CloseEvent) => {
      this.socket = null

      for (const listener of this.closeListeners) {
        try {
          listener(event.code, event.reason)
        } catch (err) {
          console.error("[SidecarWebSocket] close listener threw:", err)
        }
      }

      if (!this.intentionallyClosed) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.options.maxReconnects === 0) return
    if (this.reconnectAttempts >= this.options.maxReconnects) {
      console.warn(
        `[SidecarWebSocket] Max reconnects (${this.options.maxReconnects}) reached. Giving up.`,
      )
      return
    }

    const base = Math.min(
      this.options.reconnectDelay * 2 ** this.reconnectAttempts,
      this.options.maxReconnectDelay,
    )
    const jitter = base * this.options.reconnectJitter * Math.random()
    const delay = Math.round(base + jitter)

    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionallyClosed) {
        this.openSocket()
      }
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
