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
import { createScreenshotMcpServer } from "./screenshot-mcp.ts";
import { createWorkbenchMcpServer } from "./workbench-mcp.ts";
import { buildWorkspaceProfile, shouldBlockScaffoldCommand } from "./workspace-profile.ts";
import { assessDevServer } from "./workbench-runtime.ts";
import { updateSessionInProject } from "../routes/local-projects.ts";
import { CodexProvider } from "./codex-provider.ts";

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

const DEV_SERVER_START_PATTERNS: RegExp[] = [
  /\bnpm\s+start\b/i,
  /\bnpm\s+run\s+dev\b/i,
  /\bnpm\s+run\s+start\b/i,
  /\bpnpm\s+dev\b/i,
  /\bpnpm\s+run\s+dev\b/i,
  /\byarn\s+dev\b/i,
  /\byarn\s+start\b/i,
  /\bbun\s+run\s+dev\b/i,
  /\bbun\s+dev\b/i,
  /\bnpx\s+expo\s+start\b/i,
  /\bexpo\s+start\b/i,
  /\bnext\s+dev\b/i,
  /\bvite\b(?:\s|$)/i,
  /\breact-native\s+start\b/i,
];

const PACKAGE_INSTALL_PATTERNS: RegExp[] = [
  /\bnpm\s+(install|i)\b/i,
  /\bpnpm\s+add\b/i,
  /\byarn\s+add\b/i,
  /\bbun\s+add\b/i,
  /\bnpx\s+expo\s+install\b/i,
  /\bexpo\s+install\b/i,
];

const DEPRECATED_PACKAGE_REPLACEMENTS: Record<string, string> = {
  "expo-av": "expo-audio and expo-video",
  "expo-permissions": "individual package permission APIs",
  "@expo/vector-icons": "expo-symbols",
  "@react-native-async-storage/async-storage": "expo-sqlite/localStorage/install",
  "expo-app-loading": "expo-splash-screen",
  "expo-linear-gradient": "CSS gradients via experimental_backgroundImage",
};

const READ_ONLY_BASH_PREFIX = /^(ls|pwd|cat|sed\b|rg\b|find\b|git\s+(status|log|diff|show)\b|ps\b|which\b|command\s+-v\b|echo\b|wc\b|head\b|tail\b|sort\b|uniq\b|cut\b|awk\b|jq\b|stat\b|du\b|df\b|env\b|printenv\b|id\b|uname\b|date\b)(\s|$)/i;
const MUTATING_TOOL_NAME_FRAGMENT = [
  "write",
  "edit",
  "multiedit",
  "create",
  "delete",
  "remove",
  "rename",
  "move",
  "update",
];

function isLikelyMutatingToolCall(toolName: string, input: Record<string, unknown>): boolean {
  const normalized = toolName.toLowerCase();
  const command =
    typeof input.command === "string"
      ? input.command.trim()
      : typeof input.cmd === "string"
        ? input.cmd.trim()
        : "";

  const isShellTool =
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("command");

  if (isShellTool) {
    if (!command) return false;
    return !READ_ONLY_BASH_PREFIX.test(command);
  }

  return MUTATING_TOOL_NAME_FRAGMENT.some((fragment) =>
    normalized.includes(fragment)
  );
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractVerificationResult(output: string, isError: boolean): {
  passed: boolean;
  checkedAt?: string;
  failureReason?: string;
} {
  if (isError) {
    return {
      passed: false,
      failureReason: "workbench.verify_app_state returned an error result.",
    };
  }

  const parsed = parseJsonObject(output);
  if (!parsed) {
    return {
      passed: false,
      failureReason: "Unable to parse verify_app_state output payload.",
    };
  }

  const checkedAt =
    typeof parsed.checkedAt === "string" ? parsed.checkedAt : undefined;
  const status = typeof parsed.status === "string" ? parsed.status : "";
  const evidence =
    parsed.evidence && typeof parsed.evidence === "object"
      ? (parsed.evidence as Record<string, unknown>)
      : null;
  const logs =
    evidence?.logs && typeof evidence.logs === "object"
      ? (evidence.logs as Record<string, unknown>)
      : null;
  const screenshot =
    evidence?.screenshot && typeof evidence.screenshot === "object"
      ? (evidence.screenshot as Record<string, unknown>)
      : null;
  const failures = Array.isArray(parsed.failures) ? parsed.failures : [];

  const hasLogs = typeof logs?.text === "string" && logs.text.length > 0;
  const screenshotOk = screenshot?.success === true;
  const passed = status === "ok" && hasLogs && screenshotOk && failures.length === 0;

  if (passed) {
    return { passed: true, checkedAt };
  }

  let failureReason = "verify_app_state did not include successful logs and screenshot evidence.";
  if (failures.length > 0 && typeof failures[0] === "object" && failures[0] !== null) {
    const maybeMessage = (failures[0] as Record<string, unknown>).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      failureReason = maybeMessage;
    }
  }

  return { passed: false, checkedAt, failureReason };
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function isDevServerStartCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return DEV_SERVER_START_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getDeprecatedPackageInstall(command: string): { pkg: string; replacement: string } | null {
  if (!PACKAGE_INSTALL_PATTERNS.some((pattern) => pattern.test(command))) return null;

  const tokens = command
    .replace(/["'`]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  for (const [pkg, replacement] of Object.entries(DEPRECATED_PACKAGE_REPLACEMENTS)) {
    const target = pkg.toLowerCase();
    const matched = tokens.some((token) => token === target || token.startsWith(`${target}@`));
    if (matched) return { pkg, replacement };
  }
  return null;
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

    case "user": {
      const blocks = sdkMessage.message.content;
      const events: ProviderStreamEvent[] = [];

      for (const block of blocks) {
        if ("type" in block && block.type === "tool_result") {
          const output =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .map((entry) => {
                      if (typeof entry === "string") return entry;
                      if (entry && typeof entry === "object" && "text" in entry) {
                        const text = (entry as { text?: unknown }).text;
                        return typeof text === "string" ? text : "";
                      }
                      return "";
                    })
                    .join("\n")
                : "";

          events.push({
            kind: "tool_result",
            callId:
              ("tool_use_id" in block && typeof block.tool_use_id === "string"
                ? block.tool_use_id
                : ("id" in block && typeof block.id === "string" ? block.id : "")),
            name:
              ("name" in block && typeof block.name === "string"
                ? block.name
                : ""),
            output,
            isError: Boolean("is_error" in block ? block.is_error : false),
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
      mcpServers: {
        ...(options.mcpServers as Record<string, any>),
        screenshot: createScreenshotMcpServer({ cwd: options.cwd }),
        workbench: createWorkbenchMcpServer({ cwd: options.cwd }),
      },
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

// Register providers on module load
registerProvider(new ClaudeProvider());
registerProvider(new CodexProvider());

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
const REVENUECAT_MCP_URL = "https://mcp.revenuecat.ai/mcp";
const STRIPE_MCP_URL = "https://mcp.stripe.com";

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

function parseEnvContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!key) continue;

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadProjectEnv(cwd: string): Record<string, string> {
  const envLocalPath = path.join(cwd, ".env.local");
  const envPath = path.join(cwd, ".env");
  const candidatePath = fs.existsSync(envLocalPath)
    ? envLocalPath
    : fs.existsSync(envPath)
      ? envPath
      : null;

  if (!candidatePath) return {};

  try {
    const content = fs.readFileSync(candidatePath, "utf-8");
    return parseEnvContent(content);
  } catch (error) {
    console.warn("[AgentSession] Failed to load project env for MCP config:", error);
    return {};
  }
}

function loadProjectEnvByProjectId(projectId?: string): Record<string, string> {
  if (!projectId) return {};

  const projectDir = path.join(os.homedir(), ".bfloat-ide", "projects", projectId);
  const envLocalPath = path.join(projectDir, ".env.local");
  const envPath = path.join(projectDir, ".env");
  const candidatePath = fs.existsSync(envLocalPath)
    ? envLocalPath
    : fs.existsSync(envPath)
      ? envPath
      : null;

  if (!candidatePath) return {};

  try {
    const content = fs.readFileSync(candidatePath, "utf-8");
    return parseEnvContent(content);
  } catch (error) {
    console.warn("[AgentSession] Failed to load project-id env for MCP config:", error);
    return {};
  }
}

function buildAutoMcpServers(
  cwd: string,
  sessionEnv?: Record<string, string>,
  projectId?: string
): Record<string, unknown> {
  const cwdEnv = loadProjectEnv(cwd);
  const projectScopedEnv = loadProjectEnvByProjectId(projectId);
  const mergedEnv = { ...cwdEnv, ...projectScopedEnv, ...(sessionEnv ?? {}) };
  const autoServers: Record<string, unknown> = {};

  const revenueCatKey =
    mergedEnv.REVENUECAT_API_KEY?.trim() ||
    mergedEnv.EXPO_PUBLIC_REVENUECAT_API_KEY?.trim() ||
    "";

  if (revenueCatKey) {
    autoServers.revenuecat = {
      type: "http",
      url: REVENUECAT_MCP_URL,
      headers: {
        Authorization: `Bearer ${revenueCatKey}`,
      },
    };
    console.log("[AgentSession] Auto-configured RevenueCat MCP server from project/session env");
  }

  const stripeKey = mergedEnv.STRIPE_SECRET_KEY?.trim() || "";
  if (stripeKey) {
    autoServers.stripe = {
      type: "http",
      url: STRIPE_MCP_URL,
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
    };
    console.log("[AgentSession] Auto-configured Stripe MCP server from project/session env");
  }

  return autoServers;
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
  const autoMcpServers = buildAutoMcpServers(options.cwd, options.env, options.projectId);
  const mergedMcpServers = {
    ...autoMcpServers,
    ...(options.mcpServers ?? {}),
  };
  const normalizedOptions: SessionCreateOptions =
    Object.keys(mergedMcpServers).length > 0
      ? { ...options, mcpServers: mergedMcpServers }
      : { ...options };

  const state: AgentSessionState = {
    id: sessionId,
    provider: providerId,
    status: "idle",
    model: normalizedOptions.model ?? "default",
    cwd: normalizedOptions.cwd,
    projectId: normalizedOptions.projectId,
    realSessionId: normalizedOptions.resumeSessionId,
    conversation: [],
    totalTokens: 0,
    totalCostUsd: 0,
    startTime: now,
    messageCount: 0,
  };

  sessions.set(sessionId, {
    state,
    options: normalizedOptions,
    abortController: null,
    subscribers: new Set(),
    seq: 0,
  });

  // Register as background session so the renderer can reconnect on re-mount
  if (normalizedOptions.projectId) {
    registerBackgroundSession(sessionId, normalizedOptions.projectId, providerId, normalizedOptions.cwd);
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
  const workspaceProfile = buildWorkspaceProfile(session.state.cwd);

  // Accumulate assistant text for conversation history
  let assistantText = "";
  const toolNameByCallId = new Map<string, string>();
  let turnHadMutatingAction = false;
  let verificationAttempted = false;
  let verificationPassed = false;
  let verificationCheckedAt: string | undefined;
  let verificationFailureReason: string | undefined;

  try {
    const designModeDirective = workspaceProfile.isTemplateBootstrap
      ? [
          "## Frontend Design Mode",
          "Workspace classification: template-bootstrap.",
          "Treat this as a greenfield app scaffolded from a starter template.",
          "Do NOT treat starter template styling as an established design system.",
          "For frontend UI requests, prioritize creative/new design direction via /frontend-design skill.",
        ].join("\n")
      : [
          "## Frontend Design Mode",
          "Workspace classification: existing app.",
          "Treat this as an established product unless the user explicitly requests a redesign.",
          "Preserve existing design system tokens/components and adapt in place.",
        ].join("\n");

    const verificationDirective = [
      "## Verification Before Completion",
      "If you changed runtime/app behavior (UI, routes, build/dev-server behavior, integrations, API effects), run workbench.verify_app_state before claiming the task is complete.",
      "This is enforced by a completion gate: mutating turns without successful verify_app_state evidence are rejected with a recoverable error.",
      "For log-only checks, prefer workbench.get_app_logs instead of shell process/log discovery.",
      "For terminal inspection, prefer workbench.list_terminals and workbench.get_terminal_output before shell-based probing.",
      "In your final completion message, include verification evidence: checkedAt timestamp, screenshot confirmation, and recent log findings.",
      "If verification fails, do not claim completion. Report the failure reason and your next corrective action.",
    ].join("\n");

    const mergedSystemPrompt = session.options.systemPrompt
      ? `${session.options.systemPrompt}\n\n${designModeDirective}\n\n${verificationDirective}`
      : `${designModeDirective}\n\n${verificationDirective}`;

    const streamOptions = {
      ...session.options,
      systemPrompt: mergedSystemPrompt,
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
          liveSession.options.resumeSessionId = event.realSessionId;
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
          if (isLikelyMutatingToolCall(event.name, event.input)) {
            turnHadMutatingAction = true;
          }

          const normalizedToolName = event.name.toLowerCase();
          const isShellTool =
            normalizedToolName.includes("bash") ||
            normalizedToolName.includes("shell") ||
            normalizedToolName.includes("command");
          const command =
            typeof event.input.command === "string"
              ? event.input.command
              : typeof event.input.cmd === "string"
                ? event.input.cmd
                : "";
          const decision =
            isShellTool && command
              ? shouldBlockScaffoldCommand(command, workspaceProfile)
              : { shouldBlock: false };
          if (decision.shouldBlock) {
            liveSession.state.status = "error";
            liveSession.state.endTime = Date.now();
            frame = buildFrame(liveSession, "error", {
              code: "scaffold_blocked_existing_workspace",
              message:
                "Blocked scaffold command in existing workspace. This project already has app files; modify the existing project instead of creating a new app.",
              recoverable: true,
            } satisfies ErrorPayload);
            broadcastToSession(liveSession, frame);
            broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
            return;
          }

          if (isShellTool && command && isDevServerStartCommand(command)) {
            const assessment = await assessDevServer(liveSession.state.cwd, true);
            const isManagedAndHealthy =
              assessment.status === "running" || assessment.status === "starting";

            if (isManagedAndHealthy) {
              liveSession.state.status = "error";
              liveSession.state.endTime = Date.now();
              frame = buildFrame(liveSession, "error", {
                code: "dev_server_already_managed",
                message:
                  "Blocked dev-server start command because the workbench-managed server is already healthy. Use workbench.get_dev_server_status for metadata and continue editing without starting a new server.",
                recoverable: true,
              } satisfies ErrorPayload);
              broadcastToSession(liveSession, frame);
              broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
              return;
            }
          }

          if (isShellTool && command) {
            const deprecatedInstall = getDeprecatedPackageInstall(command);
            if (deprecatedInstall) {
              const blockedMessage =
                `Blocked deprecated package install (${deprecatedInstall.pkg}). ` +
                `Use ${deprecatedInstall.replacement} instead.`;

              // Surface the attempted command as a tool call, then mark it failed
              // so the UI can resolve the running tool state without killing the session.
              const blockedToolCallFrame = buildFrame(liveSession, "tool_call", {
                callId: event.callId,
                name: event.name,
                input: event.input,
                status: "running",
              } satisfies ToolCallPayload);
              broadcastToSession(liveSession, blockedToolCallFrame);

              const blockedToolResultFrame = buildFrame(liveSession, "tool_result", {
                callId: event.callId,
                name: event.name,
                output: blockedMessage,
                isError: true,
              } satisfies ToolResultPayload);
              broadcastToSession(liveSession, blockedToolResultFrame);

              liveSession.state.status = "completed";
              liveSession.state.endTime = Date.now();

              frame = buildFrame(liveSession, "done", {
                result: blockedMessage,
                interrupted: false,
                totalTokens: liveSession.state.totalTokens,
                totalCostUsd: liveSession.state.totalCostUsd,
              } satisfies DonePayload);
              broadcastToSession(liveSession, frame);
              broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
              return;
            }
          }

          frame = buildFrame(liveSession, "tool_call", {
            callId: event.callId,
            name: event.name,
            input: event.input,
            status: event.status,
          } satisfies ToolCallPayload);
          if (event.callId && event.name) {
            toolNameByCallId.set(event.callId, event.name);
          }
          break;
        }

        case "tool_result": {
          const resolvedName =
            event.name || toolNameByCallId.get(event.callId) || "unknown_tool";
          const normalizedResolvedName = resolvedName.toLowerCase();
          if (normalizedResolvedName.includes("verify_app_state")) {
            verificationAttempted = true;
            const verification = extractVerificationResult(event.output, event.isError);
            verificationPassed = verification.passed;
            verificationCheckedAt = verification.checkedAt;
            verificationFailureReason = verification.failureReason;
          }
          frame = buildFrame(liveSession, "tool_result", {
            callId: event.callId,
            name: resolvedName,
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
          const verificationRequired = turnHadMutatingAction;
          if (verificationRequired && !verificationPassed) {
            liveSession.state.status = "error";
            liveSession.state.endTime = Date.now();

            const reason = verificationAttempted
              ? verificationFailureReason ??
                "Verification did not produce successful logs and screenshot evidence."
              : "No workbench.verify_app_state call was observed after mutating actions.";

            const gateMessage = [
              "Completion verification gate blocked this turn.",
              `Reason: ${reason}`,
              "Run workbench.verify_app_state and continue only after it returns status \"ok\" with both logs and screenshot evidence.",
            ].join("\n");

            const gateTextFrame = buildFrame(liveSession, "text", {
              delta: `${gateMessage}\n`,
            } satisfies TextPayload);
            broadcastToSession(liveSession, gateTextFrame);

            frame = buildFrame(liveSession, "error", {
              code: "completion_verification_required",
              message: gateMessage,
              recoverable: true,
            } satisfies ErrorPayload);
            broadcastToSession(liveSession, frame);
            broadcastToSession(liveSession, buildFrame(liveSession, "stream_end", {}));
            return;
          }

          liveSession.state.status = event.interrupted ? "interrupted" : "completed";
          liveSession.state.endTime = Date.now();
          if (event.totalTokens) {
            liveSession.state.totalTokens += event.totalTokens;
          }
          if (event.totalCostUsd) {
            liveSession.state.totalCostUsd += event.totalCostUsd;
          }

          // Persist token/cost to projects.json (fire-and-forget)
          const projectId = sessionToProject.get(sessionId);
          const realSid = liveSession.state.realSessionId;
          if (projectId && realSid) {
            updateSessionInProject(projectId, realSid, {
              totalTokens: liveSession.state.totalTokens,
              totalCostUsd: liveSession.state.totalCostUsd,
            }).catch((err) =>
              console.warn("[AgentSession] Failed to persist token/cost:", err)
            );
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
            result:
              verificationPassed && verificationCheckedAt
                ? `${event.result ?? ""}\n[verification.checkedAt=${verificationCheckedAt}]`.trim()
                : event.result,
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
