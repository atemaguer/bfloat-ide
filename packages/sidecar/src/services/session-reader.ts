/**
 * Session Reader Service (Sidecar)
 *
 * Reads and lists sessions from Claude CLI's local storage.
 * Claude sessions: ~/.claude/projects/{encoded-path}/{session-id}.jsonl
 *
 * This is a simplified version of lib/agents/session-reader.ts that runs
 * in the sidecar context without Electron-specific imports.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
  timestamp: number;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  content?: string;
  name?: string;
  input?: Record<string, unknown>;
  callId?: string;
  output?: string;
  isError?: boolean;
}

export interface ParsedSession {
  sessionId: string;
  provider: "claude" | "codex" | "bfloat";
  messages: SessionMessage[];
  cwd?: string;
  createdAt?: number;
  lastModified?: number;
}

/**
 * Block format expected by the renderer's `convertSessionMessage()`.
 *
 * - `text` blocks carry markdown content.
 * - `tool` blocks describe a tool invocation + optional result.
 */
export interface RendererBlock {
  type: "text" | "tool";
  content?: string;
  action?: {
    id: string;
    type: string;   // tool name (e.g. "Write", "Read", "Bash")
    label: string;   // human-readable label (same as name)
    status: "running" | "completed" | "error";
    output?: string;
    timestamp: number;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: RendererBlock[];
  timestamp?: number;
  isMeta?: boolean;
}

// ---------------------------------------------------------------------------
// Claude storage paths
// ---------------------------------------------------------------------------

function getClaudeSessionsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Encode a project path the way Claude does for directory names.
 * Claude replaces slashes AND dots with dashes.
 * e.g., /Users/foo/.bfloat-ide/projects → -Users-foo--bfloat-ide-projects
 */
function encodeProjectPath(projectPath: string): string {
  const normalized = path.resolve(projectPath);
  return normalized.replace(/[/\\.]/g, "-");
}

// ---------------------------------------------------------------------------
// Claude JSONL types
// ---------------------------------------------------------------------------

interface ClaudeSessionEntry {
  type: "user" | "assistant" | "summary" | "init" | "result" | "queue-operation";
  message?: {
    role: string;
    content: string | Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
  };
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  uuid?: string;
  isMeta?: boolean;
}

// ---------------------------------------------------------------------------
// Session file finding
// ---------------------------------------------------------------------------

async function findClaudeSessionFile(
  sessionId: string,
  projectPath?: string
): Promise<string | null> {
  const sessionsDir = getClaudeSessionsDir();

  if (!fs.existsSync(sessionsDir)) return null;

  // If we have a project path, look in that specific directory first
  if (projectPath) {
    const encodedPath = encodeProjectPath(projectPath);
    const sessionFile = path.join(sessionsDir, encodedPath, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) return sessionFile;
  }

  // Search all project directories
  try {
    const projectDirs = fs.readdirSync(sessionsDir);
    for (const dir of projectDirs) {
      const sessionFile = path.join(sessionsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(sessionFile)) return sessionFile;
    }
  } catch {
    // Ignore read errors
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

async function readClaudeSession(filePath: string): Promise<ParsedSession | null> {
  try {
    const stats = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const messages: SessionMessage[] = [];
    let sessionId = "";
    let cwd: string | undefined;
    let createdAt: number | undefined;
    let messageIndex = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as ClaudeSessionEntry;

        // Extract session metadata from init entries
        if (entry.type === "init") {
          if (entry.sessionId) sessionId = entry.sessionId;
          if (entry.cwd) cwd = entry.cwd;
          if (entry.timestamp) {
            const ts = new Date(entry.timestamp).getTime();
            if (!isNaN(ts)) createdAt = ts;
          }
          continue;
        }

        // Skip non-message entries
        if (!entry.message) continue;
        if (entry.isMeta) continue; // skip injected/synthetic messages

        const role = entry.message.role as "user" | "assistant";
        if (role !== "user" && role !== "assistant") continue;

        const msgId = entry.uuid || `msg-${messageIndex++}`;
        const timestamp = entry.timestamp
          ? new Date(entry.timestamp).getTime()
          : Date.now();

        // Parse content
        if (typeof entry.message.content === "string") {
          messages.push({
            id: msgId,
            role,
            content: entry.message.content,
            timestamp,
          });
        } else if (Array.isArray(entry.message.content)) {
          const blocks: ContentBlock[] = [];
          let textContent = "";

          for (const block of entry.message.content) {
            if (block.type === "text" && block.text) {
              blocks.push({ type: "text", content: block.text });
              textContent += block.text;
            } else if (block.type === "tool_use" && block.name) {
              blocks.push({
                type: "tool_use",
                callId: block.id,
                name: block.name,
                input: block.input,
              });
            } else if (block.type === "tool_result") {
              const output =
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);
              blocks.push({
                type: "tool_result",
                callId: block.tool_use_id,
                output,
                isError: block.is_error,
              });
            }
          }

          messages.push({
            id: msgId,
            role,
            content: blocks.length > 0 ? blocks : textContent,
            timestamp,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Derive sessionId from filename if not found in content
    if (!sessionId) {
      sessionId = path.basename(filePath, ".jsonl");
    }

    return {
      sessionId,
      provider: "claude",
      messages,
      cwd,
      createdAt: createdAt || stats.birthtimeMs,
      lastModified: stats.mtimeMs,
    };
  } catch (error) {
    console.error("[SessionReader] Failed to read session:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convert ParsedSession → ChatMessage[] format expected by the renderer
// ---------------------------------------------------------------------------

export function sessionToMessages(session: ParsedSession): ChatMessage[] {
  const chatMessages: ChatMessage[] = [];

  // First pass: collect tool_result outputs keyed by callId.
  // Claude's JSONL interleaves assistant (with tool_use) and user (with tool_result)
  // messages, so we pre-scan to match results to their calls.
  const toolResults = new Map<string, { output: string; isError: boolean }>();
  for (const msg of session.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.callId) {
          toolResults.set(block.callId, {
            output: block.output || "",
            isError: block.isError ?? false,
          });
        }
      }
    }
  }

  // Merge consecutive assistant messages into one ChatMessage.
  // Claude's JSONL stores each API turn separately:
  //   assistant: [text]
  //   assistant: [tool_use]
  //   user: [tool_result]       ← skipped
  //   assistant: [text, tool_use]
  //   user: [tool_result]       ← skipped
  //   assistant: [text]
  // The renderer expects ONE ChatMessage per conversational turn so that
  // consecutive tool calls are grouped into an accordion.

  let pendingAssistant: { id: string; content: string; blocks: RendererBlock[]; timestamp: number } | null = null;

  const flushAssistant = () => {
    if (pendingAssistant) {
      chatMessages.push({
        id: pendingAssistant.id,
        role: "assistant",
        content: pendingAssistant.content,
        blocks: pendingAssistant.blocks,
        timestamp: pendingAssistant.timestamp,
      });
      pendingAssistant = null;
    }
  };

  const appendAssistantBlocks = (msg: SessionMessage) => {
    if (!pendingAssistant) {
      pendingAssistant = { id: msg.id, content: "", blocks: [], timestamp: msg.timestamp };
    }

    if (typeof msg.content === "string") {
      pendingAssistant.content += msg.content;
      if (msg.content.trim()) {
        pendingAssistant.blocks.push({ type: "text", content: msg.content });
      }
    } else {
      for (const block of msg.content) {
        if (block.type === "text" && block.content) {
          pendingAssistant.content += block.content;
          pendingAssistant.blocks.push({ type: "text", content: block.content });
        } else if (block.type === "tool_use" && block.name) {
          const result = block.callId ? toolResults.get(block.callId) : undefined;
          const hasResult = !!result;
          const label = buildToolLabel(block.name, block.input);

          pendingAssistant.blocks.push({
            type: "tool",
            action: {
              id: block.callId || `tool-${pendingAssistant.blocks.length}`,
              type: block.name,
              label,
              status: hasResult ? (result.isError ? "error" : "completed") : "completed",
              output: result?.output,
              timestamp: msg.timestamp,
            },
          });
        }
        // tool_result blocks are handled via toolResults map above
      }
    }
  };

  for (const msg of session.messages) {
    if (msg.role === "user") {
      // For user messages, extract text content only (skip tool_result blocks)
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((b) => b.type === "text")
              .map((b) => b.content || "")
              .join("\n");

      // Skip user messages that are purely tool_result (no text content)
      if (!content.trim() && typeof msg.content !== "string") {
        continue;
      }

      // Real user text message — flush any pending assistant
      flushAssistant();

      chatMessages.push({
        id: msg.id,
        role: "user",
        content,
        timestamp: msg.timestamp,
      });
    } else if (msg.role === "assistant") {
      // Merge into the pending assistant message (or start a new one)
      appendAssistantBlocks(msg);
    }
  }

  // Flush any remaining assistant message
  flushAssistant();

  return chatMessages;
}

/**
 * Build a short human-readable label for a tool call.
 */
function buildToolLabel(
  name: string,
  input?: Record<string, unknown>,
): string {
  if (!input) return name;

  // Common patterns: file operations show path, bash shows command
  if (input.file_path) return `${name}: ${input.file_path}`;
  if (input.path) return `${name}: ${input.path}`;
  if (input.command) {
    const cmd = String(input.command);
    return `${name}: ${cmd.length > 80 ? cmd.substring(0, 77) + "..." : cmd}`;
  }
  if (input.pattern) return `${name}: ${input.pattern}`;
  if (input.query) return `${name}: ${String(input.query).substring(0, 60)}`;

  return name;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a session by ID and provider.
 */
export async function readSession(
  sessionId: string,
  provider: "claude" | "codex" | "bfloat",
  projectPath?: string
): Promise<{ success: boolean; session?: unknown; error?: string }> {
  try {
    if (provider === "claude" || provider === "bfloat") {
      const sessionFile = await findClaudeSessionFile(sessionId, projectPath);
      if (!sessionFile) {
        return { success: false, error: "Session not found" };
      }
      const session = await readClaudeSession(sessionFile);
      if (!session) {
        return { success: false, error: "Failed to parse session" };
      }

      // Preserve the original provider
      session.provider = provider;

      // Convert to chat-compatible format
      const messages = sessionToMessages(session);

      return {
        success: true,
        session: {
          sessionId: session.sessionId,
          provider: session.provider,
          messages,
          cwd: session.cwd,
          createdAt: session.createdAt,
          lastModified: session.lastModified,
        },
      };
    }

    // Codex support can be added later
    return { success: false, error: `Provider '${provider}' not supported yet` };
  } catch (error) {
    console.error("[SessionReader] readSession error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * List available sessions for a project from local CLI storage.
 */
export async function listSessions(
  provider: "claude" | "codex" | "bfloat",
  projectPath?: string
): Promise<{
  success: boolean;
  sessions: Array<{ sessionId: string; lastModified: number }>;
  error?: string;
}> {
  const sessions: Array<{ sessionId: string; lastModified: number }> = [];

  try {
    if ((provider === "claude" || provider === "bfloat") && projectPath) {
      const sessionsDir = getClaudeSessionsDir();
      const encodedPath = encodeProjectPath(projectPath);
      const projectSessionDir = path.join(sessionsDir, encodedPath);

      if (fs.existsSync(projectSessionDir)) {
        const files = fs.readdirSync(projectSessionDir);
        for (const file of files) {
          if (file.endsWith(".jsonl")) {
            const sessionFile = path.join(projectSessionDir, file);
            const stats = fs.statSync(sessionFile);
            sessions.push({
              sessionId: path.basename(file, ".jsonl"),
              lastModified: stats.mtimeMs,
            });
          }
        }
      }
    }

    // Sort by last modified, newest first
    sessions.sort((a, b) => b.lastModified - a.lastModified);

    return { success: true, sessions };
  } catch (error) {
    console.error("[SessionReader] listSessions error:", error);
    return {
      success: false,
      sessions: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
