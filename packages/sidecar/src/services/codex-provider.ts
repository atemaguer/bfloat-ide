/**
 * Codex Provider for the sidecar
 *
 * Implements the sidecar AgentProvider interface using the @openai/codex-sdk.
 * Adapts the SDK's Thread/event model to the sidecar's ProviderStreamEvent stream.
 */

import {
  Codex,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type AgentMessageItem,
  type ReasoningItem,
  type CommandExecutionItem,
  type FileChangeItem,
  type McpToolCallItem,
  type TodoListItem,
  type ErrorItem,
} from "@openai/codex-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  AgentProvider,
  AgentProviderId,
  ProviderStreamEvent,
  SessionCreateOptions,
} from "./agent-session.ts";

const LOG_PREFIX = "[Codex Provider]";
const DEFAULT_CODEX_ERROR_MESSAGE =
  "Codex failed before returning a detailed error. Check authentication, model access, or sidecar logs for details.";

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const nestedCandidates = [
    record.message,
    record.error,
    record.details,
    record.stderr,
    record.stdout,
    record.cause,
  ];

  for (const candidate of nestedCandidates) {
    const extracted = extractErrorMessage(candidate);
    if (extracted) return extracted;
  }

  if (record.error && typeof record.error === "object") {
    const nested = extractErrorMessage(record.error);
    if (nested) return nested;
  }

  if (record.response && typeof record.response === "object") {
    const nested = extractErrorMessage(record.response);
    if (nested) return nested;
  }

  return undefined;
}

export function normalizeCodexError(error: unknown, fallback = DEFAULT_CODEX_ERROR_MESSAGE): string {
  const direct =
    extractErrorMessage(error) ||
    (error instanceof Error ? error.message.trim() : undefined);

  if (direct && direct !== "[object Object]" && direct.toLowerCase() !== "unknown error") {
    return direct;
  }

  if (error && typeof error === "object") {
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // Ignore serialization issues and use the fallback below.
    }
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getCodexHomeDir(): string {
  const envHome = process.env.CODEX_HOME;
  return envHome?.trim() ? envHome : path.join(os.homedir(), ".codex");
}

function getCodexAuthPathCandidates(): string[] {
  const candidates = new Set<string>();
  candidates.add(path.join(getCodexHomeDir(), "auth.json"));
  candidates.add(path.join(os.homedir(), ".codex", "auth.json"));
  if (process.env.APPDATA) {
    candidates.add(path.join(process.env.APPDATA, "codex", "auth.json"));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.add(path.join(process.env.LOCALAPPDATA, "codex", "auth.json"));
  }
  if (process.env.USERPROFILE) {
    candidates.add(path.join(process.env.USERPROFILE, ".codex", "auth.json"));
  }
  return Array.from(candidates);
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function findCodexBinaryPath(): string | undefined {
  const { platform, arch } = process;

  const platformMap: Record<string, { triple: string; pkg: string }> = {
    "darwin-arm64": { triple: "aarch64-apple-darwin", pkg: "@openai/codex-darwin-arm64" },
    "darwin-x64": { triple: "x86_64-apple-darwin", pkg: "@openai/codex-darwin-x64" },
    "linux-arm64": { triple: "aarch64-unknown-linux-musl", pkg: "@openai/codex-linux-arm64" },
    "linux-x64": { triple: "x86_64-unknown-linux-musl", pkg: "@openai/codex-linux-x64" },
    "win32-arm64": { triple: "aarch64-pc-windows-msvc", pkg: "@openai/codex-win32-arm64" },
    "win32-x64": { triple: "x86_64-pc-windows-msvc", pkg: "@openai/codex-win32-x64" },
  };

  const key = `${platform}-${arch}`;
  const entry = platformMap[key];
  if (!entry) {
    console.warn(`${LOG_PREFIX} Unsupported platform: ${key}`);
    return undefined;
  }

  const { triple, pkg } = entry;
  const binaryName = platform === "win32" ? "codex.exe" : "codex";
  const pkgDir = pkg.replace("@openai/", "");

  const searchPaths = [
    // From cwd (dev)
    path.join(process.cwd(), "node_modules", "@openai", pkgDir, "vendor", triple, "codex", binaryName),
    // From __dirname
    path.join(__dirname, "..", "..", "node_modules", "@openai", pkgDir, "vendor", triple, "codex", binaryName),
    path.join(__dirname, "..", "..", "..", "node_modules", "@openai", pkgDir, "vendor", triple, "codex", binaryName),
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      console.log(`${LOG_PREFIX} Found Codex binary at: ${p}`);
      return p;
    }
  }

  console.warn(`${LOG_PREFIX} Codex binary not found in any search path`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Permission mode mapping
// ---------------------------------------------------------------------------

function mapPermissionMode(
  mode?: string
): { approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted"; sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" } {
  switch (mode) {
    case "bypassPermissions":
      return { approvalPolicy: "never", sandboxMode: "danger-full-access" };
    case "acceptEdits":
      return { approvalPolicy: "never", sandboxMode: "workspace-write" };
    case "plan":
      return { approvalPolicy: "on-request", sandboxMode: "read-only" };
    default:
      return { approvalPolicy: "on-request", sandboxMode: "workspace-write" };
  }
}

// ---------------------------------------------------------------------------
// MCP config helpers
// ---------------------------------------------------------------------------

function buildMcpConfigOverrides(
  mcpServers?: Record<string, unknown>
): Record<string, Record<string, unknown>> | undefined {
  if (!mcpServers) return undefined;

  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    const cfg = config as Record<string, unknown>;
    if (cfg.type !== "http" && cfg.type !== "sse") continue;
    if (!cfg.url) continue;

    const entry: Record<string, unknown> = { url: cfg.url };
    if (cfg.headers && typeof cfg.headers === "object" && Object.keys(cfg.headers as object).length > 0) {
      entry.http_headers = cfg.headers;
    }
    result[name] = entry;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Event conversion helpers
// ---------------------------------------------------------------------------

function convertThreadItem(item: ThreadItem): ProviderStreamEvent | null {
  switch (item.type) {
    case "agent_message": {
      const msgItem = item as AgentMessageItem;
      return { kind: "text", delta: msgItem.text };
    }

    case "reasoning": {
      const reasoningItem = item as ReasoningItem & {
        summary?: Array<{ type: string; text?: string }>;
      };

      let reasoningText: string | undefined;
      if (reasoningItem.summary && reasoningItem.summary.length > 0) {
        reasoningText = reasoningItem.summary
          .filter((s) => s.type === "summary_text" && s.text)
          .map((s) => s.text)
          .join("\n");
      }
      if (!reasoningText && reasoningItem.text) {
        reasoningText = reasoningItem.text.replace(/undefined$/g, "").trimEnd();
      }
      if (!reasoningText) return null;

      return { kind: "reasoning", delta: reasoningText };
    }

    case "command_execution": {
      const cmdItem = item as CommandExecutionItem;
      return {
        kind: "tool_call",
        callId: cmdItem.id,
        name: "shell",
        input: { command: cmdItem.command },
        status: cmdItem.status === "completed" ? "completed" : cmdItem.status === "failed" ? "error" : "running",
      };
    }

    case "file_change": {
      const fileItem = item as FileChangeItem;
      return {
        kind: "tool_call",
        callId: fileItem.id,
        name: "file_change",
        input: { changes: fileItem.changes as unknown as Record<string, unknown> },
        status: fileItem.status === "completed" ? "completed" : "error",
      };
    }

    case "mcp_tool_call": {
      const mcpItem = item as McpToolCallItem;
      return {
        kind: "tool_call",
        callId: mcpItem.id,
        name: `${mcpItem.server}:${mcpItem.tool}`,
        input: (mcpItem.arguments ?? {}) as Record<string, unknown>,
        status: mcpItem.status === "completed" ? "completed" : mcpItem.status === "failed" ? "error" : "running",
      };
    }

    case "todo_list": {
      const todoItem = item as TodoListItem;
      const todoText = todoItem.items
        .map((t) => `${t.completed ? "✓" : "○"} ${t.text}`)
        .join("\n");
      return { kind: "text", delta: `**Todo List:**\n${todoText}` };
    }

    case "error": {
      const errorItem = item as ErrorItem;
      return {
        kind: "error",
        code: "item_error",
        message: errorItem.message,
        recoverable: true,
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class CodexProvider implements AgentProvider {
  readonly id: AgentProviderId = "codex";
  readonly name = "Codex";

  private codexBinaryPath: string | undefined;

  constructor() {
    this.codexBinaryPath = findCodexBinaryPath();
    if (this.codexBinaryPath) {
      console.log(`${LOG_PREFIX} Initialized with binary path: ${this.codexBinaryPath}`);
    } else {
      console.log(`${LOG_PREFIX} Will use SDK default path resolution`);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      for (const candidate of getCodexAuthPathCandidates()) {
        if (!fs.existsSync(candidate)) continue;
        const content = fs.readFileSync(candidate, "utf-8");
        const auth = JSON.parse(content);
        if (auth?.tokens?.refresh_token) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async getAvailableModels() {
    return [
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "Latest agentic coding model" },
      { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", description: "Advanced coding model" },
      { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", description: "Stable coding model" },
      { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", description: "Fast and efficient" },
    ];
  }

  async *streamMessage(
    message: string,
    options: SessionCreateOptions & { abortController: AbortController }
  ): AsyncIterable<ProviderStreamEvent> {
    console.log(`${LOG_PREFIX} Starting stream — cwd: ${options.cwd}, model: ${options.model || "default"}`);

    // Build Codex SDK instance
    const codexOptions: Record<string, unknown> = {};
    if (this.codexBinaryPath) {
      codexOptions.codexPathOverride = this.codexBinaryPath;
    }

    const config: Record<string, unknown> = {};
    const mcpConfig = buildMcpConfigOverrides(options.mcpServers);
    if (mcpConfig) {
      config.mcp_servers = mcpConfig;
    }
    if (options.systemPrompt) {
      config.instructions = options.systemPrompt;
    }
    if (Object.keys(config).length > 0) {
      codexOptions.config = config;
    }

    const codex = new Codex(codexOptions as ConstructorParameters<typeof Codex>[0]);

    // Build thread options
    const permissionOptions = mapPermissionMode(options.permissionMode);
    const threadOptions: ThreadOptions = {
      workingDirectory: options.cwd,
      skipGitRepoCheck: true,
      ...permissionOptions,
    };

    // Only pass a valid Codex model — ignore Claude model IDs that may leak through
    if (options.model && !options.model.startsWith("claude-")) {
      threadOptions.model = options.model;
    }

    let thread;
    if (options.resumeSessionId) {
      console.log(`${LOG_PREFIX} Resuming thread ${options.resumeSessionId}`);
      thread = codex.resumeThread(options.resumeSessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    try {
      const { events } = await thread.runStreamed(message, {
        signal: options.abortController.signal,
      });

      for await (const event of events) {
        if (options.abortController.signal.aborted) break;

        switch (event.type) {
          case "thread.started": {
            const threadId = event.thread_id || "";
            console.log(`${LOG_PREFIX} Thread started: ${threadId}`);
            yield {
              kind: "init",
              realSessionId: threadId,
              model: options.model || "codex",
              availableTools: [],
            };
            break;
          }

          case "item.completed": {
            const converted = convertThreadItem(event.item);
            if (converted) yield converted;
            break;
          }

          case "turn.completed": {
            const totalTokens = event.usage.input_tokens + event.usage.output_tokens;
            yield {
              kind: "done",
              interrupted: false,
              totalTokens,
            };
            break;
          }

          case "turn.failed": {
            yield {
              kind: "error",
              code: "turn_failed",
              message: normalizeCodexError(event.error, "Codex turn failed without returning error details."),
              recoverable: false,
            };
            break;
          }

          case "error": {
            yield {
              kind: "error",
              code: "stream_error",
              message: normalizeCodexError(event, "Codex stream failed without returning error details."),
              recoverable: false,
            };
            break;
          }

          // item.started, item.updated, turn.started — skip to avoid duplicates
          default:
            break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        yield { kind: "done", interrupted: true };
        return;
      }

      const normalizedError = normalizeCodexError(error);
      console.error(`${LOG_PREFIX} Stream error:`, normalizedError, error);
      yield {
        kind: "error",
        code: "execution_error",
        message: normalizedError,
        recoverable: false,
      };
    }
  }
}
