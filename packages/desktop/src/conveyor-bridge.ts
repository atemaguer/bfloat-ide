/**
 * conveyor-bridge.ts — Compatibility shim: window.conveyor → Tauri / SidecarApi
 *
 * This file creates a `window.conveyor` object whose shape is identical to the
 * Electron conveyor API so that every existing React component that calls
 * `window.conveyor.<api>.<method>(...)` continues to work without modification.
 *
 * Architecture:
 *   Terminal, Filesystem, AIAgent  →  delegate to getSidecarApiSync().*
 *   Window                         →  Tauri APIs + browser document.execCommand
 *   ProjectSync, ProjectFiles,
 *   Deploy, Secrets, Provider,
 *   LocalProjects, Template        →  HTTP calls via getSidecarApiSync().http
 *   Screenshot                     →  stub (requires @tauri-apps/plugin-screenshot,
 *                                      not yet available)
 *
 * Usage (in entry.tsx, after initialiseSidecarApi()):
 *   import { initConveyorBridge } from './conveyor-bridge'
 *   initConveyorBridge()
 */

// The interface declarations in this file are intentional type documentation
// for method signatures that bridge to stub implementations.  TypeScript may
// flag some as "unused" because they appear only in type positions inside
// object literals — suppress those false positives here.
/* eslint-disable @typescript-eslint/no-unused-vars */

import { getCurrentWindow } from "@tauri-apps/api/window"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener"
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog"
import { type as osType } from "@tauri-apps/plugin-os"
import { getSidecarApiSync } from "./api"
import { addDeepLinkListener } from "./entry"

// ---------------------------------------------------------------------------
// Shared types re-declared locally so the bridge file is self-contained
// (avoids importing from the lib/ monorepo paths that only exist in Electron)
// ---------------------------------------------------------------------------

type UnsubscribeFn = () => void

// ProviderApi types
type ProviderType = "anthropic" | "openai" | "expo"

interface OAuthTokens {
  type: "oauth"
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  scopes?: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
  userId?: string
  username?: string
}

interface ProviderAuthState {
  anthropic: OAuthTokens | null
  openai: OAuthTokens | null
  expo: OAuthTokens | null
}

interface AuthStatus {
  authenticated: boolean
  providers: ProviderType[]
}

interface ConnectResult {
  success: boolean
  exitCode: number
  authenticated: boolean
  providers?: ProviderType[]
  output?: string
  tokenSaved?: boolean
}

interface GitBashSelectionResult {
  success: boolean
  path?: string
  error?: string
}

// Used as parameter type in providerBridge.connectExpo
interface ExpoCredentials {
  username: string
  password: string
  otp?: string
}

interface ExpoConnectResult {
  success: boolean
  exitCode: number
  authenticated: boolean
  username?: string
  error?: string
  output?: string
}

interface ExpoAuthStatus {
  authenticated: boolean
  userId?: string
  username?: string
}

interface DisconnectResult {
  success: boolean
  exitCode: number
}

interface CliInstalledResult {
  installed: boolean
  path?: string
}

// DeployApi types
interface SaveASCApiKeyArgs {
  projectPath: string
  keyId: string
  issuerId: string
  keyContent: string
}

interface SaveASCApiKeyResult {
  success: boolean
  keyPath?: string
  error?: string
}

interface CheckASCApiKeyResult {
  configured: boolean
  keyId?: string
  issuerId?: string
  keyPath?: string
}

type IOSBuildStep = "init" | "credentials" | "build" | "submit" | "complete" | "error"

interface IOSBuildProgress {
  step: IOSBuildStep
  message: string
  percent: number
  logs?: string
  buildUrl?: string
  error?: string
}

interface IOSBuildArgs {
  projectPath: string
  skipCredentials?: boolean
}

interface IOSBuildResult {
  success: boolean
  buildUrl?: string
  error?: string
  needsOtp?: boolean
}

interface IOSBuildInteractiveArgs {
  projectPath: string
  appleId: string
  password: string
}

type PromptType = "apple_id" | "password" | "2fa" | "menu" | "yes_no" | "unknown"

interface HumanizedPromptOption {
  label: string
  value: string
  recommended?: boolean
}

interface HumanizedPrompt {
  title: string
  description: string
  options: HumanizedPromptOption[]
  rawPrompt?: string
}

interface InteractiveAuthEvent {
  type: PromptType
  confidence: number
  context: string
  suggestion?: string
  humanized?: HumanizedPrompt
}

interface AppleSessionInfo {
  exists: boolean
  appleId?: string
  ageInDays?: number
  isValid?: boolean
  statusMessage?: string
}

interface AppleSessionsResult {
  sessions: AppleSessionInfo[]
  hasValidSession: boolean
}

// ProjectFilesApi types
type ProjectStatus = "idle" | "cloning" | "ready" | "error"

interface FileNode {
  path: string
  type: "file" | "directory"
  size?: number
  modifiedAt?: number
}

interface FileContent {
  path: string
  content: string
  isBinary: boolean
}

interface ProjectState {
  projectId: string
  projectPath: string
  status: ProjectStatus
  error?: string
  fileTree: FileNode[]
}

interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir"
  path: string
  projectId: string
}

// ProjectSyncApi types
interface FileChange {
  type: "write" | "delete"
  path: string
  content?: string
}

interface ProjectSyncFileChangeEventData {
  projectId: string
  type: string
  path: string
  relativePath: string
}

interface ProjectSyncErrorEventData {
  projectId: string
  error: string
}

// SecretsApi types
interface Secret {
  key: string
  value: string
}

interface SecretsReadResult {
  secrets: Secret[]
  error?: string
}

interface SecretOperationResult {
  success: boolean
  error?: string
}

// LocalProjectsApi types  — use `unknown` for Project/AgentSession since we
// don't want a hard import across packages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocalProject = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentSession = any

// ---------------------------------------------------------------------------
// Helper: stub factory
// ---------------------------------------------------------------------------

/**
 * Returns a function that logs a "not yet implemented" warning and resolves to
 * the provided default value.  Used only for APIs that cannot be backed by HTTP
 * calls yet (e.g. Screenshot which requires a native plugin not yet available).
 */
function stub<T>(methodPath: string, defaultValue: T): (...args: unknown[]) => Promise<T> {
  return (..._args: unknown[]) => {
    console.warn(`[conveyor-bridge] ${methodPath} not yet implemented in Tauri`)
    return Promise.resolve(defaultValue)
  }
}

// ---------------------------------------------------------------------------
// Helper: authenticated EventSource factory
// ---------------------------------------------------------------------------

/**
 * Creates a native browser EventSource connected to the sidecar at the given
 * path.  The sidecar password is appended as a query parameter (matching the
 * same pattern used by wsUrl() in the HttpClient) because the browser
 * EventSource constructor cannot set custom request headers.
 *
 * Returns the EventSource instance so the caller can attach handlers and close
 * it when no longer needed.
 */
function createAuthenticatedEventSource(path: string): EventSource {
  const api = getSidecarApiSync()
  // Re-use the wsUrl helper which already knows how to encode the password and
  // construct the full URL — we just swap the ws:// scheme back to http://.
  const wsUrl = api.http.wsUrl(path)
  const httpUrl = wsUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://")
  return new EventSource(httpUrl)
}

// ---------------------------------------------------------------------------
// Zoom level management (shared between webZoomIn / webZoomOut / webActualSize)
// ---------------------------------------------------------------------------

let _currentZoom = 1.0
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3.0

// ---------------------------------------------------------------------------
// Window API bridge
// ---------------------------------------------------------------------------

export const windowBridge = {
  // ---- Window chrome -------------------------------------------------------

  windowInit: async (): Promise<{ width: number; height: number; minimizable: boolean; maximizable: boolean; platform: string }> => {
    const win = getCurrentWindow()
    const [minimizable, maximizable] = await Promise.all([
      win.isMinimizable(),
      win.isMaximizable(),
    ])

    // Map Tauri OS type names to Electron's process.platform values
    const os = osType()
    let platform: string
    switch (os) {
      case "macos":
        platform = "darwin"
        break
      case "windows":
        platform = "win32"
        break
      default:
        platform = "linux"
        break
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight,
      minimizable,
      maximizable,
      platform,
    }
  },

  windowIsMinimizable: async (): Promise<boolean> => {
    const win = getCurrentWindow()
    return win.isMinimizable()
  },

  windowIsMaximizable: async (): Promise<boolean> => {
    const win = getCurrentWindow()
    return win.isMaximizable()
  },

  windowMinimize: async (): Promise<void> => {
    const win = getCurrentWindow()
    await win.minimize()
  },

  windowMaximize: async (): Promise<void> => {
    const win = getCurrentWindow()
    await win.maximize()
  },

  windowClose: async (): Promise<void> => {
    const win = getCurrentWindow()
    await win.close()
  },

  windowMaximizeToggle: async (): Promise<void> => {
    const win = getCurrentWindow()
    const isMax = await win.isMaximized()
    if (isMax) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
  },

  windowIsFullscreen: async (): Promise<boolean> => {
    const win = getCurrentWindow()
    return win.isFullscreen()
  },

  /**
   * Subscribe to fullscreen changes.
   * Returns an unsubscribe function matching the Electron conveyor contract.
   */
  onFullscreenChange: (callback: (isFullscreen: boolean) => void): UnsubscribeFn => {
    let unlisten: UnsubscribeFn | null = null

    getCurrentWindow()
      .onResized(async () => {
        try {
          const isFullscreen = await getCurrentWindow().isFullscreen()
          callback(isFullscreen)
        } catch {
          // Ignore errors during teardown
        }
      })
      .then((fn) => {
        unlisten = fn
      })
      .catch((err) => {
        console.warn("[conveyor-bridge] onFullscreenChange setup error:", err)
      })

    return () => {
      if (unlisten) unlisten()
    }
  },

  /** @deprecated background-color changes are no-ops in Tauri. */
  windowSetBackgroundColor: (_color: string): Promise<void> => {
    // Tauri does not expose a direct equivalent; the background is controlled
    // by the HTML/CSS layer.  Intentionally a no-op.
    return Promise.resolve()
  },

  // ---- External links ------------------------------------------------------

  webOpenUrl: async (url: string): Promise<void> => {
    await tauriOpenUrl(url)
  },

  // ---- Zoom ----------------------------------------------------------------

  webActualSize: async (): Promise<void> => {
    _currentZoom = 1.0
    try {
      const wv = getCurrentWebviewWindow()
      await wv.setZoom(_currentZoom)
    } catch (err) {
      console.warn("[conveyor-bridge] webActualSize: setZoom failed:", err)
    }
  },

  webZoomIn: async (): Promise<void> => {
    _currentZoom = Math.min(_currentZoom + ZOOM_STEP, ZOOM_MAX)
    try {
      const wv = getCurrentWebviewWindow()
      await wv.setZoom(_currentZoom)
    } catch (err) {
      console.warn("[conveyor-bridge] webZoomIn: setZoom failed:", err)
    }
  },

  webZoomOut: async (): Promise<void> => {
    _currentZoom = Math.max(_currentZoom - ZOOM_STEP, ZOOM_MIN)
    try {
      const wv = getCurrentWebviewWindow()
      await wv.setZoom(_currentZoom)
    } catch (err) {
      console.warn("[conveyor-bridge] webZoomOut: setZoom failed:", err)
    }
  },

  // ---- DevTools ------------------------------------------------------------

  /** No-op in production Tauri builds.  DevTools are toggled via the Tauri
   *  inspector shortcut (Cmd/Ctrl+Shift+I) or the `inspect` CLI flag. */
  webToggleDevtools: (): Promise<void> => {
    return Promise.resolve()
  },

  // ---- Reload --------------------------------------------------------------

  webReload: (): Promise<void> => {
    window.location.reload()
    return Promise.resolve()
  },

  webForceReload: (): Promise<void> => {
    window.location.reload()
    return Promise.resolve()
  },

  // ---- Fullscreen ----------------------------------------------------------

  webToggleFullscreen: async (): Promise<void> => {
    const win = getCurrentWindow()
    const isFullscreen = await win.isFullscreen()
    await win.setFullscreen(!isFullscreen)
  },

  // ---- Clipboard / editing -------------------------------------------------

  webUndo: (): Promise<void> => {
    document.execCommand("undo")
    return Promise.resolve()
  },

  webRedo: (): Promise<void> => {
    document.execCommand("redo")
    return Promise.resolve()
  },

  webCut: (): Promise<void> => {
    document.execCommand("cut")
    return Promise.resolve()
  },

  webCopy: (): Promise<void> => {
    document.execCommand("copy")
    return Promise.resolve()
  },

  webPaste: (): Promise<void> => {
    document.execCommand("paste")
    return Promise.resolve()
  },

  webDelete: (): Promise<void> => {
    document.execCommand("delete")
    return Promise.resolve()
  },

  webSelectAll: (): Promise<void> => {
    document.execCommand("selectAll")
    return Promise.resolve()
  },
}

// ---------------------------------------------------------------------------
// Terminal API bridge  →  getSidecarApiSync().terminal.*
// ---------------------------------------------------------------------------

type TerminalDataCallback = (terminalId: string, data: string) => void
type TerminalExitCallback = (terminalId: string, exitCode: number) => void

// Module-level maps that mirror the Electron pattern of storing per-terminal
// callbacks.  The Tauri bridge uses SidecarWebSocket events instead of IPC.
const _termDataCallbacks = new Map<string, TerminalDataCallback>()
const _termExitCallbacks = new Map<string, TerminalExitCallback>()

// Agent terminal event emitters (no native Tauri equivalent yet — stubbed).
const _agentTerminalCreatedListeners = new Set<(id: string) => void>()
const _agentTerminalClosedListeners = new Set<(id: string) => void>()
const _restartDevServerListeners = new Set<() => void>()

export const terminalBridge = {
  create: async (terminalId: string, cwd?: string) => {
    const result = await getSidecarApiSync().terminal.create(terminalId, cwd)
    // After creation, ensure the WebSocket stream is (re-)established.
    // _ensureTerminalStream may have been called before create() returned,
    // in which case the initial WS was closed by the sidecar (session did not
    // exist yet).  Deleting the stale entry allows a fresh connection.
    const existingWs = _terminalStreams.get(terminalId)
    if (existingWs && !existingWs.isConnected) {
      existingWs.close()
      _terminalStreams.delete(terminalId)
    }
    // Open a new WS if needed (also handles the first-time case when onData
    // was called before create).
    if (_termDataCallbacks.has(terminalId) || _termExitCallbacks.has(terminalId)) {
      _ensureTerminalStream(terminalId)
    }
    return result
  },

  write: (terminalId: string, data: string) =>
    getSidecarApiSync().terminal.write(terminalId, data),

  resize: (terminalId: string, cols: number, rows: number) =>
    getSidecarApiSync().terminal.resize(terminalId, cols, rows),

  kill: (terminalId: string) =>
    getSidecarApiSync().terminal.kill(terminalId),

  killAll: async () => {
    const api = getSidecarApiSync()
    const { sessions } = await api.terminal.list()
    await Promise.allSettled(sessions.map((session) => api.terminal.kill(session.terminalId)))
    return { success: true }
  },

  getCwd: (terminalId?: string) =>
    getSidecarApiSync().terminal.getCwd(terminalId),

  checkPort: (port: number) =>
    getSidecarApiSync().terminal.checkPort(port),

  findAvailablePort: (startPort: number = 3000, endPort?: number) =>
    getSidecarApiSync().terminal.findAvailablePort(startPort, endPort),

  runCommand: (terminalId: string, command: string) =>
    getSidecarApiSync().terminal.runCommand(terminalId, command),

  /**
   * executeCommand — mirrors the Electron implementation.
   *
   * Writes the command with a unique marker, then opens a WebSocket stream and
   * collects output until the marker is echoed back, resolving with
   * `{ output, exitCode }`.
   */
  executeCommand: (
    terminalId: string,
    command: string,
  ): Promise<{ output: string; exitCode: number }> => {
    return new Promise((resolve) => {
      const api = getSidecarApiSync()
      let output = ""
      let commandStarted = false
      const marker = `__CMD_DONE_${Date.now()}__`
      const fullCommand = `${command}; echo "${marker}$?"`

      const ws = api.terminal.connect(terminalId)

      ws.on("message", (msg: unknown) => {
        // Sidecar sends raw strings for PTY output, JSON objects for control frames.
        let data: string | null = null

        if (typeof msg === "string") {
          data = msg
        } else if (msg && typeof msg === "object" && (msg as Record<string, unknown>).type === "exit") {
          // Process exited while we were waiting — resolve with what we have
          const exitCode = ((msg as Record<string, unknown>).code as number) ?? 1
          ws.close()
          resolve({ output: output.trim(), exitCode })
          return
        }

        if (data === null) return // skip non-data frames (connected, error, etc.)

        // Also forward to any registered data callbacks (so the UI keeps
        // receiving output while we capture).
        const existingCb = _termDataCallbacks.get(terminalId)
        if (existingCb) existingCb(terminalId, data)

        if (!commandStarted) {
          commandStarted = true
          return
        }

        if (data.includes(marker)) {
          const markerIndex = data.indexOf(marker)
          output += data.substring(0, markerIndex)
          const exitCodeStr = data
            .substring(markerIndex + marker.length)
            .trim()
          const exitCode = parseInt(exitCodeStr, 10) || 0
          ws.close()
          resolve({ output: output.trim(), exitCode })
        } else {
          output += data
        }
      })

      ws.connect()

      // Write the command after the socket is open.
      api.terminal.write(terminalId, fullCommand + "\r").catch((err) => {
        console.warn("[conveyor-bridge] executeCommand write error:", err)
      })
    })
  },

  /**
   * onData — register a callback for PTY output from a specific terminal.
   *
   * Opens a SidecarWebSocket if one is not yet open for this terminal.  The
   * bridge maintains one WS per terminal per renderer lifetime so callbacks
   * added later still receive all output.
   */
  onData: (terminalId: string, callback: TerminalDataCallback): void => {
    _termDataCallbacks.set(terminalId, callback)
    _ensureTerminalStream(terminalId)
  },

  /** Register a callback for terminal exit events. */
  onExit: (terminalId: string, callback: TerminalExitCallback): void => {
    _termExitCallbacks.set(terminalId, callback)
    _ensureTerminalStream(terminalId)
  },

  /** Remove all callbacks registered for a terminal. */
  removeListeners: (terminalId: string): void => {
    _termDataCallbacks.delete(terminalId)
    _termExitCallbacks.delete(terminalId)
    const ws = _terminalStreams.get(terminalId)
    if (ws) {
      ws.close()
      _terminalStreams.delete(terminalId)
    }
  },

  /**
   * onAgentTerminalCreated
   * The sidecar will need to emit an event when it spawns a terminal on behalf
   * of an agent session.  For now we expose the subscription surface.
   */
  onAgentTerminalCreated: (callback: (terminalId: string) => void): UnsubscribeFn => {
    _agentTerminalCreatedListeners.add(callback)
    return () => _agentTerminalCreatedListeners.delete(callback)
  },

  /**
   * onAgentTerminalClosed
   */
  onAgentTerminalClosed: (callback: (terminalId: string) => void): UnsubscribeFn => {
    _agentTerminalClosedListeners.add(callback)
    return () => _agentTerminalClosedListeners.delete(callback)
  },

  /**
   * onRestartDevServer
   */
  onRestartDevServer: (callback: () => void): UnsubscribeFn => {
    _restartDevServerListeners.add(callback)
    return () => _restartDevServerListeners.delete(callback)
  },
}

// ---------------------------------------------------------------------------
// Per-terminal WebSocket stream management
// ---------------------------------------------------------------------------

// We keep at most one active stream per terminal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _terminalStreams = new Map<string, any>()

function _ensureTerminalStream(terminalId: string): void {
  if (_terminalStreams.has(terminalId)) return

  try {
    const ws = getSidecarApiSync().terminal.connect(terminalId)

    ws.on("message", (msg: unknown) => {
      // The sidecar terminal WebSocket protocol sends:
      //   - Raw strings for PTY output data
      //   - JSON objects for control frames: { type: "connected"|"exit"|"error", ... }
      // SidecarWebSocket JSON-parses when possible; raw strings arrive as-is.

      if (typeof msg === "string") {
        // Raw PTY output — forward to data callback
        const cb = _termDataCallbacks.get(terminalId)
        if (cb) cb(terminalId, msg)
      } else if (msg && typeof msg === "object") {
        const frame = msg as Record<string, unknown>
        if (frame.type === "exit") {
          const cb = _termExitCallbacks.get(terminalId)
          if (cb) cb(terminalId, (frame.code as number) ?? 0)
          _terminalStreams.delete(terminalId)
        }
        // "connected" and "error" control frames are informational — no action needed
      }
    })

    ws.on("error", (err) => {
      console.warn(`[conveyor-bridge] terminal stream error (${terminalId}):`, err)
      _terminalStreams.delete(terminalId)
    })

    ws.connect()
    _terminalStreams.set(terminalId, ws)
  } catch (err) {
    console.warn(`[conveyor-bridge] _ensureTerminalStream failed (${terminalId}):`, err)
  }
}

// ---------------------------------------------------------------------------
// Filesystem API bridge  →  getSidecarApiSync().filesystem.*
// ---------------------------------------------------------------------------

export const filesystemBridge = {
  createTempDir: (projectId: string) =>
    getSidecarApiSync().filesystem.createTempDir(projectId),

  writeFiles: (basePath: string, files: Array<{ path: string; content: string }>) =>
    getSidecarApiSync().filesystem.writeFiles(basePath, files),

  getTempPath: (projectId: string) =>
    getSidecarApiSync().filesystem.getTempPath(projectId),

  cleanupTempDir: (dirPath: string) =>
    getSidecarApiSync().filesystem.cleanupTempDir(dirPath),

  getNetworkIP: () =>
    getSidecarApiSync().filesystem.getNetworkIP(),

  readFile: (path: string) =>
    getSidecarApiSync().filesystem.read(path),

  writeFile: (path: string, content: string) =>
    getSidecarApiSync().filesystem.write(path, content),
}

// ---------------------------------------------------------------------------
// AI Agent API bridge  →  getSidecarApiSync().agent.*
// ---------------------------------------------------------------------------

// We need to map the Electron "onStreamMessage" pattern (IPC channel callbacks)
// to the Tauri SidecarWebSocket pattern.  We keep a registry of open agent
// stream sockets keyed by streamChannel so the same stream can be shared by
// multiple subscribers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _agentStreams = new Map<string, { ws: any; callbacks: Set<(msg: any) => void> }>()

/**
 * Translate a sidecar AgentFrame into the AgentMessage shape expected by
 * the React app (lib/conveyor/schemas/ai-agent-schema.ts).
 *
 * AgentFrame: { type, sessionId, seq, ts, payload }
 * AgentMessage: { type, content, metadata?: { seq, timestamp, tokens, cost } }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _translateAgentFrame(raw: unknown, sessionId: string): any {
  if (!raw || typeof raw !== "object") return raw

  const frame = raw as Record<string, unknown>

  // Pass through frames that already look like AgentMessage (have `content` field)
  if ("content" in frame && !("payload" in frame)) return frame

  // Pass through stream_end / connected / cancelled as-is (UI checks type only)
  const frameType = frame.type as string
  if (frameType === "stream_end" || frameType === "connected" || frameType === "cancelled") {
    return frame
  }

  // Build metadata from frame envelope
  const metadata: Record<string, unknown> = {}
  if (typeof frame.seq === "number") metadata.seq = frame.seq
  if (typeof frame.ts === "string") metadata.timestamp = new Date(frame.ts as string).getTime()

  const payload = (frame.payload ?? {}) as Record<string, unknown>

  // Map payload → content based on frame type
  let content: unknown

  switch (frameType) {
    case "text":
    case "reasoning":
      // payload: { delta: string }
      content = (payload.delta as string) ?? ""
      break

    case "tool_call":
      // payload: { callId, name, input, status }
      // AgentMessage expects: { id, name, input, status }
      content = {
        id: payload.callId ?? payload.id ?? "",
        name: payload.name ?? "",
        input: payload.input ?? {},
        status: payload.status ?? "running",
      }
      break

    case "tool_result":
      // payload: { callId, name, output, isError }
      content = {
        callId: payload.callId ?? "",
        name: payload.name ?? "",
        output: payload.output ?? "",
        isError: payload.isError ?? false,
      }
      break

    case "error":
      // payload: { code, message, recoverable }
      content = {
        code: payload.code ?? "unknown",
        message: payload.message ?? "Unknown error",
        recoverable: payload.recoverable ?? false,
      }
      break

    case "init":
      // payload: { realSessionId, model, availableTools, provider }
      // AgentMessage expects: { sessionId, availableTools, model }
      content = {
        sessionId: (payload.realSessionId as string) ?? sessionId,
        availableTools: payload.availableTools ?? [],
        model: payload.model ?? "",
      }
      break

    case "done":
      // payload: { result?, interrupted, totalTokens?, totalCostUsd? }
      // AgentMessage expects: { sessionId, result?, interrupted }
      content = {
        sessionId,
        result: payload.result,
        interrupted: payload.interrupted ?? false,
      }
      if (typeof payload.totalTokens === "number") metadata.tokens = payload.totalTokens
      if (typeof payload.totalCostUsd === "number") metadata.cost = payload.totalCostUsd
      break

    default:
      // Unknown frame type — pass payload through as content
      content = payload
      break
  }

  return {
    type: frameType,
    content,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

export const aiAgentBridge = {
  // Provider management
  getProviders: () =>
    getSidecarApiSync().agent.getProviders(),

  getAuthenticatedProviders: () =>
    getSidecarApiSync().agent.getAuthenticatedProviders(),

  isAuthenticated: (providerId: "claude" | "codex") =>
    getSidecarApiSync().agent.isAuthenticated(providerId),

  getModels: (providerId: "claude" | "codex") =>
    getSidecarApiSync().agent.getModels(providerId),

  setDefaultProvider: (providerId: "claude" | "codex") =>
    getSidecarApiSync().agent.setDefaultProvider(providerId),

  getDefaultProvider: () =>
    getSidecarApiSync().agent.getDefaultProvider(),

  // Session management
  createSession: (options: Parameters<ReturnType<typeof getSidecarApiSync>["agent"]["createSession"]>[0]) =>
    getSidecarApiSync().agent.createSession(options),

  prompt: (sessionId: string, message: string) =>
    getSidecarApiSync().agent.prompt(sessionId, message),

  interrupt: (sessionId: string) =>
    getSidecarApiSync().agent.interrupt(sessionId),

  getSessionState: (sessionId: string) =>
    getSidecarApiSync().agent.getSessionState(sessionId),

  getActiveSessions: () =>
    getSidecarApiSync().agent.getActiveSessions(),

  terminateSession: (sessionId: string) =>
    getSidecarApiSync().agent.terminateSession(sessionId),

  terminateAllSessions: async () => {
    const api = getSidecarApiSync()
    const sessions = await api.agent.getActiveSessions()
    await Promise.allSettled(sessions.map((session) => api.agent.terminateSession(session.id)))
    return { success: true }
  },

  // Streaming — maps the Electron "channel string + callback" pattern to
  // a SidecarWebSocket opened against the session stream URL.
  onStreamMessage: (
    streamChannel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (message: any) => void,
  ): UnsubscribeFn => {
    // streamChannel in the Electron world is both the channel name and the
    // session ID used to address the WebSocket.  In the sidecar API the
    // sessionId IS the stream key, so we use streamChannel directly as the
    // sessionId for connectStream().
    const sessionId = streamChannel

    let entry = _agentStreams.get(sessionId)
    if (!entry) {
      const ws = getSidecarApiSync().agent.connectStream(sessionId)

      entry = { ws, callbacks: new Set() }
      _agentStreams.set(sessionId, entry)

      ws.on("message", (msg: unknown) => {
        // The sidecar sends AgentFrame objects:
        //   { type, sessionId, seq, ts, payload }
        // The React app expects AgentMessage objects:
        //   { type, content, metadata?: { seq, timestamp, tokens, cost } }
        // Translate here so the rest of the app works unchanged.
        const translated = _translateAgentFrame(msg, sessionId)

        const e = _agentStreams.get(sessionId)
        if (e) {
          for (const cb of e.callbacks) {
            try {
              cb(translated)
            } catch (err) {
              console.warn("[conveyor-bridge] onStreamMessage callback error:", err)
            }
          }
        }

        // Clean up when the stream ends
        if ((translated as { type?: string }).type === "stream_end") {
          _agentStreams.delete(sessionId)
        }
      })

      ws.on("error", (err: unknown) => {
        console.warn(`[conveyor-bridge] agent stream error (${sessionId}):`, err)
        _agentStreams.delete(sessionId)
      })

      ws.connect()
    }

    entry.callbacks.add(callback)

    return () => {
      const e = _agentStreams.get(sessionId)
      if (!e) return
      e.callbacks.delete(callback)
      if (e.callbacks.size === 0) {
        e.ws.close()
        _agentStreams.delete(sessionId)
      }
    }
  },

  // Background session management
  getBackgroundSession: (projectId: string) =>
    getSidecarApiSync().agent.getBackgroundSession(projectId),

  listBackgroundSessions: () =>
    getSidecarApiSync().agent.listBackgroundSessions(),

  unregisterBackgroundSession: (sessionId: string) =>
    getSidecarApiSync().agent.unregisterBackgroundSession(sessionId),

  getBackgroundSessionById: (sessionId: string) =>
    getSidecarApiSync().agent.getBackgroundSessionById(sessionId),

  getBackgroundMessages: (sessionId: string, afterSeq?: number) =>
    getSidecarApiSync().agent.getBackgroundMessages(sessionId, afterSeq),

  // Session reading
  readSession: (
    sessionId: string,
    provider: "claude" | "codex",
    projectPath?: string,
  ) => getSidecarApiSync().agent.readSession(sessionId, provider, projectPath),

  listSessions: (
    provider: "claude" | "codex",
    projectPath?: string,
  ) => getSidecarApiSync().agent.listSessions(provider, projectPath),

  // Project name generation
  generateProjectName: (
    description: string,
    provider: "claude" | "codex" = "claude",
  ) => getSidecarApiSync().agent.generateProjectName(description, provider),
}

// ---------------------------------------------------------------------------
// ProjectSync API bridge  →  /api/project-sync/*
// ---------------------------------------------------------------------------

export const projectSyncBridge = {
  start: async (projectId: string, repoUrl: string, branch?: string): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/project-sync/start",
        { projectId, repoUrl, branch },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.start error:", err)
      return { success: false }
    }
  },

  stop: async (projectId: string): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/project-sync/stop",
        { projectId },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.stop error:", err)
      return { success: false }
    }
  },

  execute: async (
    projectId: string,
    changes: FileChange[],
    commitMessage?: string,
  ): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/project-sync/execute",
        { projectId, changes, commitMessage },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.execute error:", err)
      return { success: false }
    }
  },

  commit: async (projectId: string, message: string): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/project-sync/commit",
        { projectId, message },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.commit error:", err)
      return { success: false }
    }
  },

  getFiles: async (projectId: string): Promise<unknown[]> => {
    try {
      return await getSidecarApiSync().http.get<unknown[]>(
        `/api/project-sync/files/${projectId}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.getFiles error:", err)
      return []
    }
  },

  readFile: async (projectId: string, filePath: string): Promise<unknown | null> => {
    try {
      return await getSidecarApiSync().http.get<unknown>(
        `/api/project-sync/read-file/${projectId}?path=${encodeURIComponent(filePath)}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.readFile error:", err)
      return null
    }
  },

  pull: async (projectId: string): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/project-sync/pull",
        { projectId },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.pull error:", err)
      return { success: false }
    }
  },

  status: async (projectId: string): Promise<unknown | null> => {
    try {
      return await getSidecarApiSync().http.get<unknown>(
        `/api/project-sync/status/${projectId}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.status error:", err)
      return null
    }
  },

  getProjectPath: async (projectId: string): Promise<string | null> => {
    try {
      const result = await getSidecarApiSync().http.get<{ path: string }>(
        `/api/project-sync/project-path/${projectId}`,
      )
      return result?.path ?? null
    } catch (err) {
      console.warn("[conveyor-bridge] projectSync.getProjectPath error:", err)
      return null
    }
  },

  // SSE events will be added in a future iteration when the sidecar exposes
  // an /api/project-sync/events/:projectId endpoint.
  onFileChange: (_callback: (data: ProjectSyncFileChangeEventData) => void): UnsubscribeFn => {
    return () => {}
  },

  // SSE events will be added in a future iteration when the sidecar exposes
  // an /api/project-sync/events/:projectId endpoint.
  onError: (_callback: (data: ProjectSyncErrorEventData) => void): UnsubscribeFn => {
    return () => {}
  },
}

// ---------------------------------------------------------------------------
// ProjectFiles API bridge  →  /api/project-files/*
//
// The Electron API is stateful: open() sets the active project and all
// subsequent calls (readFile, writeFile, close, etc.) operate on it without
// repeating the projectId.  The sidecar REST API is stateless and requires the
// projectId in every endpoint path.  We bridge the gap by tracking the active
// projectId here.
// ---------------------------------------------------------------------------

let _activeProjectId: string | null = null

export const projectFilesBridge = {
  open: async (projectId: string, remoteUrl?: string, appType?: string): Promise<ProjectState> => {
    try {
      _activeProjectId = projectId
      const result = await getSidecarApiSync().http.post<ProjectState>(
        "/api/project-files/open",
        { projectId, remoteUrl: remoteUrl || "", appType: appType || "web" },
      )
      // Ensure the response includes a `path` field so projectStore.fetchFileContent can use result.path
      return result
    } catch (err) {
      console.error("[conveyor-bridge] projectFiles.open error:", err)
      return {
        projectId,
        projectPath: "",
        status: "error",
        error: err instanceof Error ? err.message : "Failed to open project",
        fileTree: [],
      }
    }
  },

  close: async (): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) return
    try {
      await getSidecarApiSync().http.post<void>(
        "/api/project-files/close",
        { projectId: pid },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectFiles.close error:", err)
    } finally {
      _activeProjectId = null
    }
  },

  getState: async (): Promise<ProjectState | null> => {
    const pid = _activeProjectId
    if (!pid) return null
    try {
      return await getSidecarApiSync().http.get<ProjectState>(
        `/api/project-files/tree/${pid}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] projectFiles.getState error:", err)
      return null
    }
  },

  readFile: async (relativePath: string): Promise<FileContent> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    const result = await getSidecarApiSync().http.get<FileContent>(
      `/api/project-files/read/${pid}?path=${encodeURIComponent(relativePath)}`,
    )
    // Ensure result has `path` field (the Electron API returns { path, content, isBinary })
    return { ...result, path: relativePath }
  },

  writeFile: async (relativePath: string, content: string): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/write/${pid}`,
      { path: relativePath, content },
    )
  },

  deleteFile: async (relativePath: string): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/delete/${pid}`,
      { path: relativePath },
    )
  },

  createDirectory: async (relativePath: string): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/mkdir/${pid}`,
      { path: relativePath },
    )
  },

  rename: async (oldPath: string, newPath: string): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/rename/${pid}`,
      { from: oldPath, to: newPath },
    )
  },

  commitAndPush: async (message: string): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/git-commit/${pid}`,
      { message, push: true },
    )
  },

  syncToRemote: async (_authenticatedUrl?: string): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/git-push/${pid}`,
    )
  },

  pull: async (): Promise<void> => {
    const pid = _activeProjectId
    if (!pid) throw new Error("No active project — call open() first")
    // Note: the sidecar uses git-clone endpoint for pulling
    await getSidecarApiSync().http.post<void>(
      `/api/project-files/git-clone/${pid}`,
    )
  },

  hasChanges: async (): Promise<boolean> => {
    const pid = _activeProjectId
    if (!pid) return false
    try {
      const result = await getSidecarApiSync().http.get<{
        isGitRepo?: boolean
        files?: unknown[]
        clean?: boolean
      }>(`/api/project-files/git-status/${pid}`)
      if (typeof result?.clean === "boolean") return !result.clean
      return (result?.files?.length ?? 0) > 0
    } catch (err) {
      console.warn("[conveyor-bridge] projectFiles.hasChanges error:", err)
      return false
    }
  },

  getPath: async (): Promise<string> => {
    const pid = _activeProjectId
    if (!pid) return ""
    // Return the same absolute path the sidecar uses, not a tilde path
    // that won't expand in non-shell contexts.
    try {
      const result = await getSidecarApiSync().http.get<{ cwd: string }>("/api/terminal/cwd")
      const home = result?.cwd || ""
      if (home) return `${home}/.bfloat-ide/projects/${pid}`
    } catch { /* fall through */ }
    return `${typeof process !== "undefined" ? process.env?.HOME || "" : ""}/.bfloat-ide/projects/${pid}`
  },

  isReady: async (): Promise<boolean> => {
    const pid = _activeProjectId
    if (!pid) return false
    try {
      await getSidecarApiSync().http.get<unknown>(
        `/api/project-files/tree/${pid}`,
      )
      return true
    } catch {
      return false
    }
  },

  rescanTree: async (): Promise<FileNode[]> => {
    const pid = _activeProjectId
    if (!pid) return []
    try {
      const result = await getSidecarApiSync().http.get<{ success?: boolean; tree?: FileNode[] }>(
        `/api/project-files/tree/${pid}`,
      )
      return result?.tree ?? []
    } catch (err) {
      console.warn("[conveyor-bridge] projectFiles.rescanTree error:", err)
      return []
    }
  },

  existsLocally: async (projectId: string): Promise<boolean> => {
    try {
      await getSidecarApiSync().http.get<unknown>(
        `/api/project-files/tree/${projectId}`,
      )
      return true
    } catch {
      return false
    }
  },

  saveAttachment: async (name: string, data: string): Promise<string> => {
    const pid = _activeProjectId
    if (!pid) return ""
    try {
      const filePath = `.bfloat-ide/attachments/${name}`
      await getSidecarApiSync().http.post<void>(
        `/api/project-files/write/${pid}`,
        { path: filePath, content: data },
      )
      return filePath
    } catch (err) {
      console.warn("[conveyor-bridge] projectFiles.saveAttachment error:", err)
      return ""
    }
  },

  // SSE file change events will be added in a future iteration.
  onFileChange: (_callback: (event: FileChangeEvent) => void): UnsubscribeFn => {
    return () => {}
  },
}

// ---------------------------------------------------------------------------
// Provider API bridge  →  /api/provider/*
// ---------------------------------------------------------------------------

export const providerBridge = {
  checkClaudeCliInstalled: async (): Promise<CliInstalledResult> => {
    try {
      const result = await getSidecarApiSync().http.get<CliInstalledResult>(
        "/api/provider/check-claude-cli",
      )
      return result ?? { installed: false }
    } catch (err) {
      console.warn("[conveyor-bridge] provider.checkClaudeCliInstalled error:", err)
      return { installed: false }
    }
  },

  selectGitBashPath: async (): Promise<GitBashSelectionResult> => {
    try {
      const selected = await tauriOpenDialog({
        multiple: false,
        directory: false,
        title: "Select Git Bash Executable",
      })
      if (!selected || (Array.isArray(selected) && selected.length === 0)) {
        return { success: false }
      }
      const filePath = Array.isArray(selected) ? selected[0] : selected
      await getSidecarApiSync().http.post<void>(
        "/api/provider/save-git-bash-path",
        { path: filePath },
      )
      return { success: true, path: filePath }
    } catch (err) {
      console.warn("[conveyor-bridge] provider.selectGitBashPath error:", err)
      return { success: false, error: String(err) }
    }
  },

  connectAnthropic: async (): Promise<ConnectResult> => {
    try {
      // Blocking POST — sidecar runs `claude setup-token` (which opens the
      // browser itself) and returns when auth completes or times out.
      return await getSidecarApiSync().http.post<ConnectResult>(
        "/api/provider/connect-anthropic",
        {},
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.connectAnthropic error:", err)
      return { success: false, exitCode: 1, authenticated: false }
    }
  },

  connectOpenAI: async (): Promise<ConnectResult> => {
    try {
      // Blocking POST — sidecar starts local OAuth server, opens the browser
      // from the sidecar process, waits for callback, then returns result.
      return await getSidecarApiSync().http.post<ConnectResult>(
        "/api/provider/connect-openai",
        {},
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.connectOpenAI error:", err)
      return { success: false, exitCode: 1, authenticated: false }
    }
  },

  connectExpo: async (credentials: ExpoCredentials): Promise<ExpoConnectResult> => {
    try {
      return await getSidecarApiSync().http.post<ExpoConnectResult>(
        "/api/provider/connect-expo",
        credentials,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.connectExpo error:", err)
      return { success: false, exitCode: 1, authenticated: false }
    }
  },

  checkAuth: async (): Promise<AuthStatus> => {
    try {
      return await getSidecarApiSync().http.get<AuthStatus>(
        "/api/provider/check-auth",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.checkAuth error:", err)
      return { authenticated: false, providers: [] }
    }
  },

  checkExpoAuth: async (): Promise<ExpoAuthStatus> => {
    try {
      return await getSidecarApiSync().http.get<ExpoAuthStatus>(
        "/api/provider/check-expo-auth",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.checkExpoAuth error:", err)
      return { authenticated: false }
    }
  },

  disconnect: async (provider: ProviderType): Promise<DisconnectResult> => {
    try {
      return await getSidecarApiSync().http.post<DisconnectResult>(
        "/api/provider/disconnect",
        { provider },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.disconnect error:", err)
      return { success: false, exitCode: 1 }
    }
  },

  saveTokens: async (tokens: unknown): Promise<void> => {
    try {
      await getSidecarApiSync().http.post<void>(
        "/api/provider/save-tokens",
        tokens,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.saveTokens error:", err)
    }
  },

  clearTokens: async (provider: ProviderType): Promise<void> => {
    try {
      await getSidecarApiSync().http.post<void>(
        "/api/provider/disconnect",
        { provider },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.clearTokens error:", err)
    }
  },

  loadTokens: async (): Promise<ProviderAuthState> => {
    try {
      return await getSidecarApiSync().http.get<ProviderAuthState>(
        "/api/provider/load-tokens",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] provider.loadTokens error:", err)
      return { anthropic: null, openai: null, expo: null }
    }
  },

  // No /api/provider/refresh-tokens endpoint exists yet — kept as stub.
  refreshTokens: stub("provider.refreshTokens", null as OAuthTokens | null),

  // Generic event listener for provider auth output events.
  // Used by ProviderAuthModal to show auth stage progress.
  on: <T>(channel: string, callback: (data: T) => void): UnsubscribeFn => {
    if (channel !== "provider:auth-output") {
      console.warn(`[conveyor-bridge] provider.on: unsupported channel "${channel}"`)
      return () => {}
    }

    // Listen on the sidecar's SSE stream for auth output events.
    let closed = false
    let es: EventSource | null = null
    try {
      es = createAuthenticatedEventSource("/api/provider/auth-output")
      es.addEventListener("data", (e: MessageEvent) => {
        if (closed) return
        try {
          callback(JSON.parse(e.data) as T)
        } catch (err) {
          console.warn("[conveyor-bridge] provider.on callback error:", err)
        }
      })
      es.addEventListener("message", (e: MessageEvent) => {
        if (closed) return
        try {
          callback(JSON.parse(e.data) as T)
        } catch (err) {
          // Ignore parse errors for non-JSON messages
        }
      })
      es.onerror = () => {
        // Don't warn — the stream naturally ends when auth completes
      }
    } catch (err) {
      console.warn("[conveyor-bridge] provider.on setup error:", err)
    }

    return () => {
      closed = true
      if (es) {
        es.close()
        es = null
      }
    }
  },
}

// ---------------------------------------------------------------------------
// Deploy API bridge  →  /api/deploy/*
// ---------------------------------------------------------------------------

type BuildLogCallback = (data: { data: string }) => void
type BuildProgressCallback = (progress: IOSBuildProgress) => void
type InteractiveAuthCallback = (event: InteractiveAuthEvent) => void

// Module-level EventSource references for build streaming.
let _buildLogEs: EventSource | null = null
let _buildProgressEs: EventSource | null = null
let _buildInteractiveEs: EventSource | null = null
// Track the current buildId so EventSources can connect to the correct stream.
let _currentBuildId: string | null = null

export const deployBridge = {
  saveASCApiKey: async (args: SaveASCApiKeyArgs): Promise<SaveASCApiKeyResult> => {
    try {
      return await getSidecarApiSync().http.post<SaveASCApiKeyResult>(
        "/api/deploy/save-asc-api-key",
        args,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.saveASCApiKey error:", err)
      return { success: false }
    }
  },

  checkASCApiKey: async (): Promise<CheckASCApiKeyResult> => {
    try {
      return await getSidecarApiSync().http.get<CheckASCApiKeyResult>(
        "/api/deploy/check-asc-api-key",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.checkASCApiKey error:", err)
      return { configured: false }
    }
  },

  startIOSBuild: async (args: IOSBuildArgs): Promise<IOSBuildResult> => {
    try {
      const result = await getSidecarApiSync().http.post<IOSBuildResult & { buildId?: string }>(
        "/api/deploy/ios-build",
        args,
      )
      if (result?.buildId) {
        _currentBuildId = result.buildId
      }
      return result
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.startIOSBuild error:", err)
      return { success: false }
    }
  },

  cancelBuild: async (): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/deploy/cancel",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.cancelBuild error:", err)
      return { success: false }
    }
  },

  startInteractiveIOSBuild: async (args: IOSBuildInteractiveArgs): Promise<IOSBuildResult> => {
    try {
      const result = await getSidecarApiSync().http.post<IOSBuildResult & { buildId?: string }>(
        "/api/deploy/ios-build-interactive",
        args,
      )
      if (result?.buildId) {
        _currentBuildId = result.buildId
      }
      return result
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.startInteractiveIOSBuild error:", err)
      return { success: false }
    }
  },

  submit2FACode: async (code: string): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/deploy/submit-input",
        { input: code },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.submit2FACode error:", err)
      return { success: false }
    }
  },

  submitTerminalInput: async (input: string): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/deploy/submit-input",
        { input },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.submitTerminalInput error:", err)
      return { success: false }
    }
  },

  checkAppleSession: async (): Promise<AppleSessionInfo> => {
    try {
      const result = await getSidecarApiSync().http.get<AppleSessionsResult>(
        "/api/deploy/apple-sessions",
      )
      // Return the first session or a default no-session result.
      return result?.sessions?.[0] ?? { exists: false }
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.checkAppleSession error:", err)
      return { exists: false }
    }
  },

  clearAppleSession: async (): Promise<{ success: boolean; cleared: number }> => {
    try {
      return await getSidecarApiSync().http.delete<{ success: boolean; cleared: number }>(
        "/api/deploy/apple-sessions",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.clearAppleSession error:", err)
      return { success: false, cleared: 0 }
    }
  },

  listAppleSessions: async (): Promise<AppleSessionsResult> => {
    try {
      return await getSidecarApiSync().http.get<AppleSessionsResult>(
        "/api/deploy/apple-sessions",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.listAppleSessions error:", err)
      return { sessions: [], hasValidSession: false }
    }
  },

  writeAppleCredsFile: async (creds: unknown): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean }>(
        "/api/deploy/write-apple-creds",
        creds,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.writeAppleCredsFile error:", err)
      return { success: false }
    }
  },

  deleteCredsFile: async (): Promise<{ success: boolean }> => {
    try {
      return await getSidecarApiSync().http.delete<{ success: boolean }>(
        "/api/deploy/delete-apple-creds",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.deleteCredsFile error:", err)
      return { success: false }
    }
  },

  onBuildLog: (callback: BuildLogCallback): UnsubscribeFn => {
    if (_buildLogEs) {
      _buildLogEs.close()
      _buildLogEs = null
    }
    const streamPath = _currentBuildId
      ? `/api/deploy/stream/${_currentBuildId}`
      : "/api/deploy/stream/current"
    try {
      const es = createAuthenticatedEventSource(streamPath)
      _buildLogEs = es
      es.addEventListener("log", (e: MessageEvent) => {
        try {
          callback({ data: e.data })
        } catch (err) {
          console.warn("[conveyor-bridge] deploy.onBuildLog callback error:", err)
        }
      })
      es.onerror = () => {
        console.warn("[conveyor-bridge] deploy.onBuildLog EventSource error")
      }
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.onBuildLog setup error:", err)
    }
    return () => {
      if (_buildLogEs) {
        _buildLogEs.close()
        _buildLogEs = null
      }
    }
  },

  onBuildProgress: (callback: BuildProgressCallback): UnsubscribeFn => {
    if (_buildProgressEs) {
      _buildProgressEs.close()
      _buildProgressEs = null
    }
    const streamPath = _currentBuildId
      ? `/api/deploy/stream/${_currentBuildId}`
      : "/api/deploy/stream/current"
    try {
      const es = createAuthenticatedEventSource(streamPath)
      _buildProgressEs = es
      es.addEventListener("progress", (e: MessageEvent) => {
        try {
          callback(JSON.parse(e.data) as IOSBuildProgress)
        } catch (err) {
          console.warn("[conveyor-bridge] deploy.onBuildProgress callback error:", err)
        }
      })
      es.onerror = () => {
        console.warn("[conveyor-bridge] deploy.onBuildProgress EventSource error")
      }
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.onBuildProgress setup error:", err)
    }
    return () => {
      if (_buildProgressEs) {
        _buildProgressEs.close()
        _buildProgressEs = null
      }
    }
  },

  onInteractiveAuth: (callback: InteractiveAuthCallback): UnsubscribeFn => {
    if (_buildInteractiveEs) {
      _buildInteractiveEs.close()
      _buildInteractiveEs = null
    }
    const streamPath = _currentBuildId
      ? `/api/deploy/stream/${_currentBuildId}`
      : "/api/deploy/stream/current"
    try {
      const es = createAuthenticatedEventSource(streamPath)
      _buildInteractiveEs = es
      es.addEventListener("interactive_auth", (e: MessageEvent) => {
        try {
          callback(JSON.parse(e.data) as InteractiveAuthEvent)
        } catch (err) {
          console.warn("[conveyor-bridge] deploy.onInteractiveAuth callback error:", err)
        }
      })
      es.onerror = () => {
        console.warn("[conveyor-bridge] deploy.onInteractiveAuth EventSource error")
      }
    } catch (err) {
      console.warn("[conveyor-bridge] deploy.onInteractiveAuth setup error:", err)
    }
    return () => {
      if (_buildInteractiveEs) {
        _buildInteractiveEs.close()
        _buildInteractiveEs = null
      }
    }
  },

  clearBuildListeners: (): void => {
    if (_buildLogEs) {
      _buildLogEs.close()
      _buildLogEs = null
    }
    if (_buildProgressEs) {
      _buildProgressEs.close()
      _buildProgressEs = null
    }
    if (_buildInteractiveEs) {
      _buildInteractiveEs.close()
      _buildInteractiveEs = null
    }
    _currentBuildId = null
  },
}

// ---------------------------------------------------------------------------
// Secrets API bridge  →  /api/secrets/*
// ---------------------------------------------------------------------------

export const secretsBridge = {
  readSecrets: async (projectId: string): Promise<SecretsReadResult> => {
    try {
      return await getSidecarApiSync().http.get<SecretsReadResult>(
        `/api/secrets/${projectId}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] secrets.readSecrets error:", err)
      return { secrets: [] }
    }
  },

  setSecret: async (projectId: string, key: string, value: string): Promise<SecretOperationResult> => {
    try {
      return await getSidecarApiSync().http.post<SecretOperationResult>(
        `/api/secrets/${projectId}`,
        { key, value },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] secrets.setSecret error:", err)
      return { success: false }
    }
  },

  deleteSecret: async (projectId: string, key: string): Promise<SecretOperationResult> => {
    try {
      return await getSidecarApiSync().http.delete<SecretOperationResult>(
        `/api/secrets/${projectId}/${encodeURIComponent(key)}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] secrets.deleteSecret error:", err)
      return { success: false }
    }
  },
}

// ---------------------------------------------------------------------------
// Screenshot API bridge  →  /api/screenshot/*
// ---------------------------------------------------------------------------

export const screenshotBridge = {
  capture: async (options?: { url?: string; cwd?: string }): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean; dataUrl?: string; error?: string }>(
        "/api/screenshot/capture",
        { url: options?.url, cwd: options?.cwd },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] screenshot.capture error:", err)
      return { success: false, error: String(err) }
    }
  },

  registerPreviewUrl: async (cwd: string, url: string): Promise<void> => {
    try {
      await getSidecarApiSync().http.post("/api/screenshot/register-url", { cwd, url })
    } catch (err) {
      console.warn("[conveyor-bridge] screenshot.registerPreviewUrl error:", err)
    }
  },
}

// ---------------------------------------------------------------------------
// LocalProjects API bridge  →  /api/local-projects/*
// ---------------------------------------------------------------------------

export const localProjectsBridge = {
  list: async (): Promise<LocalProject[]> => {
    try {
      return await getSidecarApiSync().http.get<LocalProject[]>(
        "/api/local-projects",
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.list error:", err)
      return []
    }
  },

  get: async (id: string): Promise<LocalProject | null> => {
    try {
      return await getSidecarApiSync().http.get<LocalProject>(
        `/api/local-projects/${id}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.get error:", err)
      return null
    }
  },

  create: async (project: LocalProject): Promise<void> => {
    try {
      await getSidecarApiSync().http.post<void>(
        "/api/local-projects",
        project,
      )
    } catch (err) {
      console.error("[conveyor-bridge] localProjects.create error:", err)
      throw err // Propagate so callers know the save failed
    }
  },

  update: async (id: string, data: Partial<LocalProject>): Promise<void> => {
    try {
      await getSidecarApiSync().http.put<void>(
        `/api/local-projects/${id}`,
        data,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.update error:", err)
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      await getSidecarApiSync().http.delete<void>(
        `/api/local-projects/${id}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.delete error:", err)
    }
  },

  listSessions: async (projectId: string): Promise<AgentSession[]> => {
    try {
      return await getSidecarApiSync().http.get<AgentSession[]>(
        `/api/local-projects/${projectId}/sessions`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.listSessions error:", err)
      return []
    }
  },

  addSession: async (projectId: string, session: AgentSession): Promise<void> => {
    try {
      await getSidecarApiSync().http.post<void>(
        `/api/local-projects/${projectId}/sessions`,
        session,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.addSession error:", err)
    }
  },

  updateSession: async (
    projectId: string,
    sessionId: string,
    data: Partial<AgentSession>,
  ): Promise<void> => {
    try {
      await getSidecarApiSync().http.put<void>(
        `/api/local-projects/${projectId}/sessions/${sessionId}`,
        data,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.updateSession error:", err)
    }
  },

  deleteSession: async (projectId: string, sessionId: string): Promise<void> => {
    try {
      await getSidecarApiSync().http.delete<void>(
        `/api/local-projects/${projectId}/sessions/${sessionId}`,
      )
    } catch (err) {
      console.warn("[conveyor-bridge] localProjects.deleteSession error:", err)
    }
  },
}

// ---------------------------------------------------------------------------
// Template API bridge  →  /api/template/*
// ---------------------------------------------------------------------------

export const templateBridge = {
  initialize: async (
    projectPath: string,
    appType: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await getSidecarApiSync().http.post<{ success: boolean; error?: string }>(
        "/api/template/initialize",
        { projectPath, appType },
      )
    } catch (err) {
      console.warn("[conveyor-bridge] template.initialize error:", err)
      return { success: false }
    }
  },

  list: async (): Promise<{ id: string; name: string; type: string }[]> => {
    try {
      const result = await getSidecarApiSync().http.get<{
        templates?: { id: string; name: string; type: string }[]
      }>("/api/template/list")
      return result?.templates ?? []
    } catch (err) {
      console.warn("[conveyor-bridge] template.list error:", err)
      return []
    }
  },

  getPath: async (appType: string): Promise<string> => {
    try {
      const result = await getSidecarApiSync().http.get<{ path?: string }>(
        `/api/template/path?appType=${encodeURIComponent(appType)}`,
      )
      return result?.path ?? ""
    } catch (err) {
      console.warn("[conveyor-bridge] template.getPath error:", err)
      return ""
    }
  },
}

// ---------------------------------------------------------------------------
// App API bridge — deep-link based OAuth callbacks
// ---------------------------------------------------------------------------

export const appBridge = {
  onStripeCallback: (callback: (data: { success: boolean }) => void): UnsubscribeFn => {
    return addDeepLinkListener((url: string) => {
      if (url.includes("stripe-callback") || url.includes("stripe-oauth")) {
        const success = !url.includes("error")
        callback({ success })
      }
    })
  },

  onRevenueCatCallback: (callback: (data: { success: boolean }) => void): UnsubscribeFn => {
    return addDeepLinkListener((url: string) => {
      if (url.includes("revenuecat-callback") || url.includes("revenuecat-oauth")) {
        const success = !url.includes("error")
        callback({ success })
      }
    })
  },
}

// ---------------------------------------------------------------------------
// Public init function
// ---------------------------------------------------------------------------

/**
 * initConveyorBridge — assign the compatibility bridge to `window.conveyor`.
 *
 * Must be called **after** `initialiseSidecarApi()` has been called so that
 * `getSidecarApiSync()` is guaranteed to succeed when the terminal / filesystem
 * / agent bridge methods are invoked.
 *
 * @example
 *   import { initialiseSidecarApi } from './api'
 *   import { initConveyorBridge } from './conveyor-bridge'
 *
 *   initialiseSidecarApi(serverReady.url, serverReady.password)
 *   initConveyorBridge()
 */
export function initConveyorBridge(): void {
  // Cast to `any` so we can assign to `window.conveyor` without importing the
  // Electron-only ConveyorApi type declaration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).conveyor = {
    app: appBridge,
    window: windowBridge,
    terminal: terminalBridge,
    filesystem: filesystemBridge,
    aiAgent: aiAgentBridge,
    projectSync: projectSyncBridge,
    projectFiles: projectFilesBridge,
    provider: providerBridge,
    deploy: deployBridge,
    secrets: secretsBridge,
    screenshot: screenshotBridge,
    localProjects: localProjectsBridge,
    template: templateBridge,
  }

  console.log("[conveyor-bridge] window.conveyor initialised (Tauri compatibility bridge)")
}
