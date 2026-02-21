/**
 * Agent Session Manager
 *
 * Manages AI agent sessions for the bfloat sidecar. Provides a unified
 * interface for session lifecycle (create, list, get, close), message
 * sending, cancellation, and WebSocket streaming of agent responses.
 *
 * Provider extensibility:
 *   - Each provider implements AgentProvider and is registered in the
 *     providerRegistry map.
 *   - New providers (e.g., OpenAI/Codex, Gemini) can be added by implementing
 *     AgentProvider and registering them here.
 *
 * WebSocket streaming:
 *   - Each session maintains a Set of active WebSocket connections.
 *   - When a message is sent, the provider's stream is consumed and each
 *     AgentFrame is broadcast to all connected WebSocket subscribers.
 *   - Clients can subscribe/unsubscribe by connecting/closing the WS.
 */

import { randomUUID } from "crypto";
import { query, type SDKMessage, type Options } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Frame types (wire format over WebSocket and HTTP responses)
// ---------------------------------------------------------------------------

export type AgentFrameType =
  | "init"        // Session initialised; contains sessionId + model
  | "text"        // Incremental text token from the model
  | "reasoning"   // Extended thinking / internal reasoning
  | "tool_call"   // Tool invocation started
  | "tool_result" // Tool execution completed
  | "error"       // Error occurred (may or may not be recoverable)
  | "done"        // Stream completed successfully
  | "stream_end"  // Synthetic end-of-stream sentinel (always emitted last)
  | "connected"   // Sent immediately on WS open to confirm subscription
  | "cancelled";  // Sent when the user explicitly cancels a response

export interface AgentFrame {
  type: AgentFrameType;
  sessionId: string;
  /** Monotonic sequence number for deduplication on reconnect. */
  seq: number;
  /** ISO-8601 timestamp. */
  ts: string;
  /** Payload depends on `type`. */
  payload?: unknown;
}

// Payload shapes for each frame type:
export interface InitPayload {
  realSessionId: string; // Provider-assigned session ID (e.g., Claude session UUID)
  model: string;
  availableTools: string[];
  provider: AgentProviderId;
}

export interface TextPayload {
  delta: string; // Incremental text chunk
}

export interface ReasoningPayload {
  delta: string;
}

export interface ToolCallPayload {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "error";
}

export interface ToolResultPayload {
  callId: string;
  name: string;
  output: string;
  isError: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface DonePayload {
  result?: string;
  interrupted: boolean;
  totalTokens?: number;
  totalCostUsd?: number;
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export type AgentProviderId = "claude" | "codex" | "openai" | "bfloat";

export interface SessionCreateOptions {
  /** Working directory for file operations. */
  cwd: string;
  /** Provider-specific model ID. */
  model?: string;
  /** Permission mode forwarded to the underlying SDK. */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "delegate" | "dontAsk";
  /** Tool whitelist. */
  allowedTools?: string[];
  /** Tool blacklist. */
  disallowedTools?: string[];
  /** Custom system prompt to prepend. */
  systemPrompt?: string;
  /** Resume from a previously-created provider session ID. */
  resumeSessionId?: string;
  /** Temperature override (0.0–1.0). */
  temperature?: number;
  /** Extra environment variables forwarded to the agent process. */
  env?: Record<string, string>;
  /** Maximum agentic turns before the agent is force-stopped. */
  maxTurns?: number;
  /** Associated project ID (for grouping / background tracking). */
  projectId?: string;
  /** MCP server configurations keyed by server name. */
  mcpServers?: Record<string, unknown>;
}

/**
 * A provider-agnostic streaming response. Each item is an AgentFrame
 * payload plus enough context for the session manager to build the full frame.
 */
export type ProviderStreamEvent =
  | { kind: "init"; realSessionId: string; model: string; availableTools: string[] }
  | { kind: "text"; delta: string; tokens?: number }
  | { kind: "reasoning"; delta: string }
  | { kind: "tool_call"; callId: string; name: string; input: Record<string, unknown>; status: ToolCallPayload["status"] }
  | { kind: "tool_result"; callId: string; name: string; output: string; isError: boolean }
  | { kind: "error"; code: string; message: string; recoverable: boolean }
  | { kind: "done"; result?: string; interrupted: boolean; totalTokens?: number; totalCostUsd?: number };

/**
 * Abstract provider interface. Implement this to add a new AI backend.
 */
export interface AgentProvider {
  readonly id: AgentProviderId;
  readonly name: string;

  /**
   * Returns true when the provider has valid credentials.
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Returns the list of models this provider exposes.
   */
  getAvailableModels(): Promise<Array<{ id: string; name: string; description?: string }>>;

  /**
   * Opens a streaming connection and yields events. The caller is responsible
   * for consuming the full iterator; to cancel, call `abortController.abort()`.
   */
  streamMessage(
    message: string,
    options: SessionCreateOptions & { abortController: AbortController }
  ): AsyncIterable<ProviderStreamEvent>;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "running" | "completed" | "error" | "interrupted";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AgentSessionState {
  id: string;
  provider: AgentProviderId;
  status: SessionStatus;
  model: string;
  cwd: string;
  projectId?: string;
  /** The provider-assigned session ID (e.g., Claude Code session UUID). */
  realSessionId?: string;
  conversation: ConversationMessage[];
  totalTokens: number;
  totalCostUsd: number;
  startTime: number;
  endTime?: number;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// Internal session representation
// ---------------------------------------------------------------------------

type WebSocketSub = {
  send(data: string): void;
  close(): void;
};

interface InternalSession {
  state: AgentSessionState;
  options: SessionCreateOptions;
  abortController: AbortController | null;
  /** All WebSocket connections subscribed to this session's stream. */
  subscribers: Set<WebSocketSub>;
  /** Frame sequence counter (monotonically increasing per session). */
  seq: number;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const providerRegistry = new Map<AgentProviderId, AgentProvider>();

export function registerProvider(provider: AgentProvider): void {
  providerRegistry.set(provider.id, provider);
}

export function getProvider(id: AgentProviderId): AgentProvider | undefined {
  return providerRegistry.get(id);
}

export function getProviders(): AgentProvider[] {
  return Array.from(providerRegistry.values());
}

// ---------------------------------------------------------------------------
// Claude Provider — real implementation using @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------

const CLAUDE_LOG = "[Claude Provider]";
const CLAUDE_CONFIG_PATH = path.join(os.homedir(), ".claude.json");
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CLAUDE_CREDENTIALS_PATH = path.join(CLAUDE_CONFIG_DIR, ".credentials.json");

/**
 * Read the stored OAuth token from ~/.claude/.credentials.json
 */
function getClaudeOAuthToken(): string | null {
  try {
    if (!fs.existsSync(CLAUDE_CREDENTIALS_PATH)) return null;
    const content = fs.readFileSync(CLAUDE_CREDENTIALS_PATH, "utf-8");
    const credentials = JSON.parse(content) as { oauthToken?: string };
    return credentials?.oauthToken || null;
  } catch {
    return null;
  }
}

/**
 * Find the Claude Code CLI binary in standard installation locations.
 */
function findClaudeCodeBinaryPath(): string | undefined {
  const possiblePaths: string[] =
    process.platform === "win32"
      ? [
          path.join(os.homedir(), ".local", "bin", "claude.exe"),
          path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
            "Programs", "claude-code", "claude.exe"
          ),
          path.join(
            process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
            "npm", "claude.cmd"
          ),
        ]
      : [
          path.join(os.homedir(), ".local", "bin", "claude"),
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          "/usr/bin/claude",
        ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`${CLAUDE_LOG} Found Claude Code binary at: ${p}`);
      return p;
    }
  }

  console.warn(`${CLAUDE_LOG} Claude Code binary not found. Checked: ${possiblePaths.join(", ")}`);
  return undefined;
}

/**
 * Build an enhanced PATH that includes common binary locations.
 * Electron/Tauri apps on macOS don't inherit the full shell PATH.
 */
function buildEnhancedPath(): string {
  const additionalPaths = [
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".bun", "bin"),
    path.join(os.homedir(), ".nvm", "current", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/bin",
    "/sbin",
  ];
  const currentPath = process.env.PATH || "";
  if (process.platform === "win32") return currentPath;
  return [...additionalPaths, ...currentPath.split(path.delimiter)]
    .filter(Boolean)
    .join(path.delimiter);
}

/**
 * Convert a raw SDKMessage from the Claude Agent SDK into a ProviderStreamEvent.
 *
 * Returns null for messages that should be skipped (e.g., unknown types).
 * May return an array when a single SDK message produces multiple events
 * (e.g., an assistant message with both text and tool_use blocks).
 */
function convertSDKMessageToEvent(
  sdkMessage: SDKMessage
): ProviderStreamEvent | ProviderStreamEvent[] | null {
  switch (sdkMessage.type) {
    case "system": {
      if (sdkMessage.subtype === "init") {
        console.log(`${CLAUDE_LOG} Init — model: ${sdkMessage.model}, tools: ${sdkMessage.tools?.length ?? 0}`);
        return {
          kind: "init",
          realSessionId: "", // Will be populated from session_id on assistant message
          model: sdkMessage.model || "unknown",
          availableTools: sdkMessage.tools || [],
        };
      }
      return null;
    }

    case "assistant": {
      const blocks = sdkMessage.message.content;
      const events: ProviderStreamEvent[] = [];

      for (const block of blocks) {
        if ("text" in block && block.text) {
          events.push({ kind: "text", delta: block.text, tokens: sdkMessage.message.usage?.output_tokens });
        }
        if ("name" in block && block.type === "tool_use") {
          events.push({
            kind: "tool_call",
            callId: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
            status: "running",
          });
        }
      }

      return events.length === 1 ? events[0] : events.length > 0 ? events : null;
    }

    case "stream_event": {
      if (sdkMessage.event.type === "content_block_delta") {
        const delta = sdkMessage.event.delta;
        if ("text" in delta && delta.text) {
          return { kind: "text", delta: delta.text };
        }
      }
      return null;
    }

    case "result": {
      if (sdkMessage.subtype === "success") {
        return {
          kind: "done",
          result: sdkMessage.result,
          interrupted: false,
          totalTokens:
            (sdkMessage.total_usage?.input_tokens || 0) +
            (sdkMessage.total_usage?.output_tokens || 0),
          totalCostUsd: sdkMessage.total_cost_usd,
        };
      }
      return {
        kind: "error",
        code: sdkMessage.subtype,
        message: sdkMessage.error || "Unknown error",
        recoverable: false,
      };
    }

    default:
      return null;
  }
}

class ClaudeProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Claude";

  async isAuthenticated(): Promise<boolean> {
    try {
      let hasAccount = false;
      if (fs.existsSync(CLAUDE_CONFIG_PATH)) {
        try {
          const config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, "utf-8"));
          hasAccount = !!config.oauthAccount?.accountUuid;
        } catch { /* ignore */ }
      }

      let hasCredentials = false;
      if (fs.existsSync(CLAUDE_CREDENTIALS_PATH)) {
        try {
          const creds = JSON.parse(fs.readFileSync(CLAUDE_CREDENTIALS_PATH, "utf-8")) as {
            claudeAiOauth?: { accessToken?: string };
            apiKey?: string;
            anthropicApiKey?: string;
            oauthToken?: string;
          };
          hasCredentials = Boolean(
            creds?.claudeAiOauth?.accessToken ||
            creds?.oauthToken ||
            creds?.apiKey ||
            creds?.anthropicApiKey
          );
        } catch { /* ignore */ }
      }

      if (!hasCredentials && process.env.ANTHROPIC_API_KEY) {
        hasCredentials = true;
      }

      const result = hasAccount || hasCredentials;
      console.log(`${CLAUDE_LOG} Auth check: ${result}`);
      return result;
    } catch (error) {
      console.error(`${CLAUDE_LOG} Auth check error:`, error);
      return false;
    }
  }

  async getAvailableModels() {
    return [
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", description: "Most capable" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", description: "Balanced" },
      { id: "claude-3-5-haiku-20241022", name: "Claude Haiku 3.5", description: "Fast" },
    ];
  }

  async *streamMessage(
    message: string,
    options: SessionCreateOptions & { abortController: AbortController }
  ): AsyncIterable<ProviderStreamEvent> {
    const claudeBinaryPath = findClaudeCodeBinaryPath();
    if (!claudeBinaryPath) {
      yield {
        kind: "error",
        code: "binary_not_found",
        message: "Claude Code CLI not found. Please install it from https://claude.com/download",
        recoverable: false,
      };
      return;
    }

    // Ensure CWD exists — the Claude CLI hangs if spawned with a non-existent cwd
    if (!fs.existsSync(options.cwd)) {
      console.warn(`${CLAUDE_LOG} CWD does not exist, creating: ${options.cwd}`);
      fs.mkdirSync(options.cwd, { recursive: true });
    }

    // Build OAuth token
    const oauthToken = getClaudeOAuthToken();
    if (oauthToken) {
      console.log(`${CLAUDE_LOG} Using stored OAuth token (length: ${oauthToken.length})`);
    }

    // Build environment
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: buildEnhancedPath(),
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_API_KEY: undefined, // Remove placeholder; Claude Code uses OAuth
      CLAUDE_CODE_OAUTH_TOKEN: oauthToken || undefined,
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      ...(options.env || {}),
    };

    // Ensure 'Skill' is in allowedTools if specified
    const allowedTools = options.allowedTools
      ? [...options.allowedTools, "Skill"]
      : undefined;

    const sdkOptions: Options = {
      cwd: options.cwd,
      permissionMode: (options.permissionMode as Options["permissionMode"]) || "default",
      model: options.model,
      allowedTools,
      disallowedTools: options.disallowedTools,
      systemPrompt: options.systemPrompt,
      settingSources: ["project"],
      resume: options.resumeSessionId || undefined,
      abortController: options.abortController,
      allowDangerouslySkipPermissions: options.permissionMode === "bypassPermissions",
      env,
      pathToClaudeCodeExecutable: claudeBinaryPath,
      maxTurns: options.maxTurns || 50,
      mcpServers: options.mcpServers as Record<string, any>,
      stderr: (data: string) => {
        console.log(`${CLAUDE_LOG} [stderr] ${data}`);
      },
    };

    console.log(`${CLAUDE_LOG} Spawning Claude Code SDK — cwd: ${options.cwd}, model: ${options.model || "default"}`);

    // Track Bash commands to detect infinite retry loops
    const bashCommandCounts = new Map<string, number>();
    const MAX_DUPLICATE_BASH = 2;
    let capturedSessionId: string | null = options.resumeSessionId || null;
    let hasEmittedInit = false;

    try {
      const stream = query({ prompt: message, options: sdkOptions });

      for await (const sdkMessage of stream) {
        if (options.abortController.signal.aborted) break;

        // --- Capture real session ID from SDK messages ---
        const sdkSessionId = (sdkMessage as { session_id?: string }).session_id;
        if (sdkSessionId && !capturedSessionId) {
          capturedSessionId = sdkSessionId;
          console.log(`${CLAUDE_LOG} Captured real session ID: ${sdkSessionId}`);
        }

        // --- Infinite loop detection for duplicate Bash commands ---
        if (sdkMessage.type === "assistant") {
          for (const block of sdkMessage.message.content) {
            if (block.type === "tool_use" && block.name === "Bash") {
              const cmd = String((block.input as Record<string, unknown>)?.command || "");
              if (cmd) {
                const count = (bashCommandCounts.get(cmd) || 0) + 1;
                bashCommandCounts.set(cmd, count);
                if (count > MAX_DUPLICATE_BASH) {
                  console.error(`${CLAUDE_LOG} Duplicate Bash command (${count}x): ${cmd.substring(0, 120)}`);
                  options.abortController.abort();
                  yield {
                    kind: "error",
                    code: "duplicate_command",
                    message: `Agent ran the same Bash command ${count} times. Session aborted to prevent infinite loop.`,
                    recoverable: false,
                  };
                  return;
                }
              }
            }
          }
        }

        // --- Convert SDK message → ProviderStreamEvent(s) ---
        const converted = convertSDKMessageToEvent(sdkMessage);
        if (!converted) continue;

        const events = Array.isArray(converted) ? converted : [converted];

        for (const event of events) {
          // Patch init event with captured session ID
          if (event.kind === "init" && !hasEmittedInit) {
            hasEmittedInit = true;
            yield {
              ...event,
              realSessionId: capturedSessionId || randomUUID(),
            };
            continue;
          }

          // Skip duplicate init events (SDK may send system init without session ID)
          if (event.kind === "init" && hasEmittedInit) continue;

          yield event;
        }
      }

      // If we never got a "done" event (e.g., aborted), emit one
      if (!options.abortController.signal.aborted) {
        // Stream ended naturally without result message — unusual but handle gracefully
      }
    } catch (error) {
      // If we already yielded a "done", ignore post-completion exit code errors
      console.error(`${CLAUDE_LOG} Stream error:`, error instanceof Error ? error.message : error);
      yield {
        kind: "error",
        code: "execution_error",
        message: error instanceof Error ? error.message : "Unknown error",
        recoverable: false,
      };
    }
  }
}

// Register the real Claude provider on module load
registerProvider(new ClaudeProvider());

// ---------------------------------------------------------------------------
// Session registry
// ---------------------------------------------------------------------------

const sessions = new Map<string, InternalSession>();

// ---------------------------------------------------------------------------
// Background session registry
//
// Tracks sessions by projectId so the renderer can reconnect to them after
// navigating away and coming back.  Each entry stores a buffer of recent
// AgentFrames for replay on reconnect.
// ---------------------------------------------------------------------------

interface BackgroundSession {
  sessionId: string;
  projectId: string;
  provider: AgentProviderId;
  cwd: string;
  status: "running" | "completed" | "error";
  streamChannel: string; // same as sessionId for WS reconnection
  startedAt: number;
  frames: AgentFrame[];  // ring-buffer of recent frames for replay
}

const MAX_BUFFERED_FRAMES = 500;

/** projectId → BackgroundSession */
const backgroundSessions = new Map<string, BackgroundSession>();
/** sessionId → projectId  (reverse lookup) */
const sessionToProject = new Map<string, string>();
/** realSessionId (provider's ID, e.g., Claude CLI UUID) → sidecar sessionId */
const realIdToSessionId = new Map<string, string>();

function registerBackgroundSession(
  sessionId: string,
  projectId: string,
  provider: AgentProviderId,
  cwd: string,
): void {
  const bg: BackgroundSession = {
    sessionId,
    projectId,
    provider,
    cwd,
    status: "running",
    streamChannel: sessionId,
    startedAt: Date.now(),
    frames: [],
  };
  backgroundSessions.set(projectId, bg);
  sessionToProject.set(sessionId, projectId);
  console.log(`[AgentSession] Registered background session ${sessionId} for project ${projectId}`);
}

function bufferFrame(sessionId: string, frame: AgentFrame): void {
  const projectId = sessionToProject.get(sessionId);
  if (!projectId) return;
  const bg = backgroundSessions.get(projectId);
  if (!bg) return;
  bg.frames.push(frame);
  if (bg.frames.length > MAX_BUFFERED_FRAMES) {
    bg.frames = bg.frames.slice(-MAX_BUFFERED_FRAMES);
  }
  // Capture the provider's real session ID from init frames so we can
  // look up background sessions by the ID stored in projects.json.
  if (frame.type === "init") {
    const payload = frame.payload as { realSessionId?: string } | undefined;
    if (payload?.realSessionId) {
      realIdToSessionId.set(payload.realSessionId, sessionId);
    }
  }
  // Update status based on frame type
  if (frame.type === "done" || frame.type === "stream_end") {
    bg.status = "completed";
  } else if (frame.type === "error") {
    bg.status = "error";
  }
}

export function getBackgroundSessionByProject(projectId: string): BackgroundSession | null {
  return backgroundSessions.get(projectId) ?? null;
}

export function getBackgroundSessionById(sessionId: string): BackgroundSession | null {
  const projectId = sessionToProject.get(sessionId);
  if (!projectId) return null;
  return backgroundSessions.get(projectId) ?? null;
}

/**
 * Look up a background session by the provider's real session ID.
 * The React app stores the provider's ID (e.g., Claude CLI UUID) in
 * projects.json and passes it when switching session tabs.
 */
export function getBackgroundSessionByRealId(realSessionId: string): BackgroundSession | null {
  const internalId = realIdToSessionId.get(realSessionId);
  if (!internalId) return null;
  return getBackgroundSessionById(internalId);
}

export function listBackgroundSessions(): BackgroundSession[] {
  return Array.from(backgroundSessions.values());
}

export function unregisterBackgroundSession(sessionId: string): boolean {
  const projectId = sessionToProject.get(sessionId);
  if (!projectId) return false;
  backgroundSessions.delete(projectId);
  sessionToProject.delete(sessionId);
  // Clean up realId → sessionId mapping
  for (const [realId, intId] of realIdToSessionId) {
    if (intId === sessionId) {
      realIdToSessionId.delete(realId);
      break;
    }
  }
  console.log(`[AgentSession] Unregistered background session ${sessionId}`);
  return true;
}

export function getBackgroundMessages(
  sessionId: string,
  afterSeq?: number
): { success: boolean; messages: AgentFrame[] } {
  // Try internal ID first, then fall back to provider's real session ID
  const bg = getBackgroundSessionById(sessionId) ?? getBackgroundSessionByRealId(sessionId);
  if (!bg) return { success: false, messages: [] };
  const frames = afterSeq !== undefined
    ? bg.frames.filter((f) => f.seq > afterSeq)
    : bg.frames;
  return { success: true, messages: frames };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new agent session.
 */
export function createSession(
  providerId: AgentProviderId,
  options: SessionCreateOptions
): { success: true; sessionId: string } | { success: false; error: string } {
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return { success: false, error: `Unknown provider: ${providerId}` };
  }

  const sessionId = randomUUID();
  const now = Date.now();

  const state: AgentSessionState = {
    id: sessionId,
    provider: providerId,
    status: "idle",
    model: options.model ?? "default",
    cwd: options.cwd,
    projectId: options.projectId,
    realSessionId: options.resumeSessionId,
    conversation: [],
    totalTokens: 0,
    totalCostUsd: 0,
    startTime: now,
    messageCount: 0,
  };

  sessions.set(sessionId, {
    state,
    options,
    abortController: null,
    subscribers: new Set(),
    seq: 0,
  });

  // Register as background session so the renderer can reconnect on re-mount
  if (options.projectId) {
    registerBackgroundSession(sessionId, options.projectId, providerId, options.cwd);
  }

  console.log(`[AgentSession] Created session ${sessionId} (provider=${providerId})`);
  return { success: true, sessionId };
}

/**
 * List all currently-tracked sessions (active and recently completed).
 */
export function listSessions(): AgentSessionState[] {
  return Array.from(sessions.values()).map((s) => ({ ...s.state }));
}

/**
 * Get the state of a single session, or null if not found.
 */
export function getSession(sessionId: string): AgentSessionState | null {
  const session = sessions.get(sessionId);
  return session ? { ...session.state } : null;
}

/**
 * Close a session, interrupting any active stream, and remove it from the
 * registry. All subscriber WebSocket connections are closed.
 */
export async function closeSession(sessionId: string): Promise<{ success: true } | { success: false; error: string }> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: `Session not found: ${sessionId}` };
  }

  // Cancel any active stream
  if (session.abortController) {
    session.abortController.abort();
  }

  // Notify and close all subscribers
  const closeFrame = buildFrame(session, "stream_end", { cancelled: true });
  broadcastToSession(session, closeFrame);
  for (const sub of session.subscribers) {
    try { sub.close(); } catch { /* ignore */ }
  }
  session.subscribers.clear();

  session.state.status = "interrupted";
  session.state.endTime = Date.now();

  sessions.delete(sessionId);
  console.log(`[AgentSession] Closed session ${sessionId}`);
  return { success: true };
}

/**
 * Send a message to an agent session and begin streaming the response.
 *
 * Returns immediately; the actual streaming runs asynchronously and pushes
 * AgentFrames to all registered WebSocket subscribers.
 */
export function sendMessage(
  sessionId: string,
  message: string
): { success: true } | { success: false; error: string } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: `Session not found: ${sessionId}` };
  }

  if (session.state.status === "running") {
    return { success: false, error: "Session is already processing a message. Cancel it first." };
  }

  // Append user message to conversation history
  session.state.conversation.push({
    role: "user",
    content: message,
    timestamp: Date.now(),
  });

  // Mark as running
  session.state.status = "running";
  session.state.messageCount++;

  // Kick off the stream in the background (fire-and-forget)
  runStream(sessionId, message).catch((err) => {
    console.error(`[AgentSession] Unhandled stream error for session ${sessionId}:`, err);
    const s = sessions.get(sessionId);
    if (s) {
      s.state.status = "error";
      s.state.endTime = Date.now();
      const errFrame = buildFrame(s, "error", {
        code: "unhandled_error",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      } satisfies ErrorPayload);
      broadcastToSession(s, errFrame);

      const endFrame = buildFrame(s, "stream_end", {});
      broadcastToSession(s, endFrame);
    }
  });

  return { success: true };
}

/**
 * Cancel an ongoing response for a session.
 *
 * If the session is not currently running, this is a no-op (returns success).
 */
export function cancelMessage(
  sessionId: string
): { success: true } | { success: false; error: string } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: `Session not found: ${sessionId}` };
  }

  if (session.abortController) {
    session.abortController.abort();
    console.log(`[AgentSession] Cancelled stream for session ${sessionId}`);
  }

  return { success: true };
}

/**
 * Subscribe a WebSocket connection to a session's stream.
 *
 * If the session is currently running, the subscriber will receive all
 * subsequent frames. If the session is idle or complete, they receive only
 * the "connected" confirmation frame.
 *
 * Returns false if the session was not found.
 */
export function subscribeWebSocket(
  sessionId: string,
  ws: WebSocketSub
): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.subscribers.add(ws);
  console.log(
    `[AgentSession] WebSocket subscribed to session ${sessionId} (total=${session.subscribers.size})`
  );

  // Send an immediate "connected" frame so the client knows the subscription succeeded
  const connectedFrame = buildFrame(session, "connected", {
    sessionState: { ...session.state },
  });
  try {
    ws.send(JSON.stringify(connectedFrame));
  } catch {
    // Ignore send errors on connection
  }

  return true;
}

/**
 * Unsubscribe a WebSocket connection from a session's stream.
 */
export function unsubscribeWebSocket(
  sessionId: string,
  ws: WebSocketSub
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.subscribers.delete(ws);
    console.log(
      `[AgentSession] WebSocket unsubscribed from session ${sessionId} (remaining=${session.subscribers.size})`
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Assign a monotonically increasing sequence number and build a full AgentFrame.
 */
function buildFrame(
  session: InternalSession,
  type: AgentFrameType,
  payload: unknown
): AgentFrame {
  return {
    type,
    sessionId: session.state.id,
    seq: session.seq++,
    ts: new Date().toISOString(),
    payload,
  };
}

/**
 * Broadcast a frame to all subscribers of a session as a JSON string.
 * Also buffers the frame for background session replay.
 */
function broadcastToSession(session: InternalSession, frame: AgentFrame): void {
  // Buffer frame for background session replay
  bufferFrame(session.state.id, frame);

  const json = JSON.stringify(frame);
  for (const sub of session.subscribers) {
    try {
      sub.send(json);
    } catch (err) {
      // If sending fails, remove the dead subscriber
      console.warn(`[AgentSession] Dropping dead subscriber from session ${session.state.id}:`, err);
      session.subscribers.delete(sub);
    }
  }
}

/**
 * Core streaming loop. Called by sendMessage() in fire-and-forget fashion.
 *
 * Consumes the provider's AsyncIterable and converts each ProviderStreamEvent
 * into an AgentFrame, which is then broadcast to all WebSocket subscribers.
 */
async function runStream(sessionId: string, message: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  const provider = providerRegistry.get(session.state.provider);
  if (!provider) {
    session.state.status = "error";
    session.state.endTime = Date.now();
    const errFrame = buildFrame(session, "error", {
      code: "provider_not_found",
      message: `Provider '${session.state.provider}' is not registered.`,
      recoverable: false,
    } satisfies ErrorPayload);
    broadcastToSession(session, errFrame);
    broadcastToSession(session, buildFrame(session, "stream_end", {}));
    return;
  }

  session.abortController = new AbortController();

  // Accumulate assistant text for conversation history
  let assistantText = "";

  try {
    const streamOptions = {
      ...session.options,
      abortController: session.abortController,
    };

    for await (const event of provider.streamMessage(message, streamOptions)) {
      // Check if we've been aborted between events
      if (session.abortController.signal.aborted) {
        break;
      }

      // Re-fetch session in case it was closed mid-stream
      const liveSession = sessions.get(sessionId);
      if (!liveSession) return;

      let frame: AgentFrame;

      switch (event.kind) {
        case "init": {
          // Store the real provider session ID for future resume
          liveSession.state.realSessionId = event.realSessionId;
          liveSession.state.model = event.model;

          frame = buildFrame(liveSession, "init", {
            realSessionId: event.realSessionId,
            model: event.model,
            availableTools: event.availableTools,
            provider: liveSession.state.provider,
          } satisfies InitPayload);
          break;
        }

        case "text": {
          assistantText += event.delta;
          if (event.tokens) {
            liveSession.state.totalTokens += event.tokens;
          }
          frame = buildFrame(liveSession, "text", { delta: event.delta } satisfies TextPayload);
          break;
        }

        case "reasoning": {
          frame = buildFrame(liveSession, "reasoning", { delta: event.delta } satisfies ReasoningPayload);
          break;
        }

        case "tool_call": {
          frame = buildFrame(liveSession, "tool_call", {
            callId: event.callId,
            name: event.name,
            input: event.input,
            status: event.status,
          } satisfies ToolCallPayload);
          break;
        }

        case "tool_result": {
          frame = buildFrame(liveSession, "tool_result", {
            callId: event.callId,
            name: event.name,
            output: event.output,
            isError: event.isError,
          } satisfies ToolResultPayload);
          break;
        }

        case "error": {
          liveSession.state.status = "error";
          liveSession.state.endTime = Date.now();
          frame = buildFrame(liveSession, "error", {
            code: event.code,
            message: event.message,
            recoverable: event.recoverable,
          } satisfies ErrorPayload);
          broadcastToSession(liveSession, frame);
          broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
          return;
        }

        case "done": {
          liveSession.state.status = event.interrupted ? "interrupted" : "completed";
          liveSession.state.endTime = Date.now();
          if (event.totalTokens) {
            liveSession.state.totalTokens += event.totalTokens;
          }
          if (event.totalCostUsd) {
            liveSession.state.totalCostUsd += event.totalCostUsd;
          }

          // Save assistant turn to conversation history
          if (assistantText) {
            liveSession.state.conversation.push({
              role: "assistant",
              content: assistantText,
              timestamp: Date.now(),
            });
          }

          frame = buildFrame(liveSession, "done", {
            result: event.result,
            interrupted: event.interrupted,
            totalTokens: liveSession.state.totalTokens,
            totalCostUsd: liveSession.state.totalCostUsd,
          } satisfies DonePayload);
          broadcastToSession(liveSession, frame);
          broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
          return;
        }

        default: {
          // Unknown event kind — skip
          continue;
        }
      }

      broadcastToSession(liveSession, frame);
    }

    // Stream ended without a "done" event (e.g., aborted)
    const liveSession = sessions.get(sessionId);
    if (liveSession && liveSession.state.status === "running") {
      liveSession.state.status = "interrupted";
      liveSession.state.endTime = Date.now();

      if (assistantText) {
        liveSession.state.conversation.push({
          role: "assistant",
          content: assistantText,
          timestamp: Date.now(),
        });
      }

      const cancelledFrame = buildFrame(liveSession, "cancelled", {
        interrupted: true,
      });
      broadcastToSession(liveSession, cancelledFrame);
      broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
    }
  } catch (err) {
    const liveSession = sessions.get(sessionId);
    if (!liveSession) return;

    // If already completed/interrupted, ignore
    if (liveSession.state.status !== "running") return;

    liveSession.state.status = "error";
    liveSession.state.endTime = Date.now();

    const errFrame = buildFrame(liveSession, "error", {
      code: "stream_error",
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    } satisfies ErrorPayload);
    broadcastToSession(liveSession, errFrame);
    broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
  } finally {
    const liveSession = sessions.get(sessionId);
    if (liveSession) {
      liveSession.abortController = null;
    }
  }
}
