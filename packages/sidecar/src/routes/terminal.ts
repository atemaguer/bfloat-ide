import { Hono } from "hono";
import { z } from "zod";
import * as os from "node:os";
import * as fs from "node:fs";
import type { ServerWebSocket } from "bun";
import type { IPty } from "bun-pty";

// ---------------------------------------------------------------------------
// Session data type (set by server.ts on WebSocket.data)
// ---------------------------------------------------------------------------

export interface WSData {
  type: "terminal" | "agent";
  sessionId: string;
  authenticated: boolean;
}

// ---------------------------------------------------------------------------
// Terminal session registry
// ---------------------------------------------------------------------------

interface TerminalSession {
  id: string;
  pty: IPty | null;
  fallbackProc: ReturnType<typeof Bun.spawn> | null;
  /** true when the process is pty-backed, false when Bun.spawn fallback */
  isPty: boolean;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  /** output ring-buffer (last MAX_BUFFER chars) */
  outputBuffer: string;
  /** all WebSocket clients subscribed to this session */
  subscribers: Set<ServerWebSocket<WSData>>;
}

const MAX_OUTPUT_BUFFER = 20_000;

export interface TerminalSessionSnapshot {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  isPty: boolean;
  outputTail: string;
}

/**
 * Global registry of active terminal sessions.
 * Exported so that server.ts can wire WebSocket events to it.
 */
export const terminalSessions = new Map<string, TerminalSession>();

// ---------------------------------------------------------------------------
// bun-pty dynamic import (graceful fallback if not available)
// ---------------------------------------------------------------------------

type BunPtySpawn = (
  command: string,
  args: string[],
  options: { name: string; cwd: string; env: Record<string, string> }
) => IPty;

let bunPtySpawn: BunPtySpawn | null = null;
let ptyLoadAttempted = false;

async function tryLoadBunPty(): Promise<BunPtySpawn | null> {
  if (ptyLoadAttempted) return bunPtySpawn;
  ptyLoadAttempted = true;
  try {
    const { spawn } = await import("bun-pty");
    bunPtySpawn = spawn;
    console.log("[Terminal] bun-pty loaded successfully");
  } catch (err) {
    console.warn(
      "[Terminal] bun-pty not available, will use Bun.spawn fallback:",
      err instanceof Error ? err.message : String(err)
    );
    bunPtySpawn = null;
  }
  return bunPtySpawn;
}

// ---------------------------------------------------------------------------
// Shell resolution
// ---------------------------------------------------------------------------

function resolveShell(requestedShell?: string): string {
  if (requestedShell && fs.existsSync(requestedShell)) return requestedShell;

  // Respect SHELL env var
  if (process.env["SHELL"] && fs.existsSync(process.env["SHELL"])) {
    return process.env["SHELL"];
  }

  const candidates =
    process.platform === "win32"
      ? [process.env["COMSPEC"] ?? "cmd.exe", "powershell.exe"]
      : process.platform === "darwin"
        ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
        : ["/bin/bash", "/bin/sh"];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
}

function resolveShellArgs(_shell: string): string[] {
  if (process.platform === "win32") return [];
  // login shell so rc files are sourced
  return ["-l"];
}

// ---------------------------------------------------------------------------
// Environment construction
// ---------------------------------------------------------------------------

function buildEnv(overrides?: Record<string, string>): Record<string, string> {
  const base = { ...(process.env as Record<string, string>) };

  // Terminal identity
  base["TERM"] = "xterm-256color";
  base["COLORTERM"] = "truecolor";
  base["TERM_PROGRAM"] = "Bfloat";

  // Remove Electron / problematic vars
  delete base["ELECTRON_RUN_AS_NODE"];
  delete base["TERM_SESSION_ID"];

  if (overrides) Object.assign(base, overrides);
  return base;
}

// ---------------------------------------------------------------------------
// Output buffer helper
// ---------------------------------------------------------------------------

function appendOutput(session: TerminalSession, data: string): void {
  session.outputBuffer = (session.outputBuffer + data).slice(-MAX_OUTPUT_BUFFER);
}

function toSnapshot(
  session: TerminalSession,
  maxChars: number = MAX_OUTPUT_BUFFER
): TerminalSessionSnapshot {
  const bounded = Math.max(1, Math.min(maxChars, MAX_OUTPUT_BUFFER));
  return {
    id: session.id,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    isPty: session.isPty,
    outputTail: session.outputBuffer.slice(-bounded),
  };
}

export function getTerminalSessionSnapshot(
  id: string,
  maxChars: number = MAX_OUTPUT_BUFFER
): TerminalSessionSnapshot | null {
  const session = terminalSessions.get(id);
  if (!session) return null;
  return toSnapshot(session, maxChars);
}

export function getLatestTerminalSessionSnapshotForCwd(
  cwd: string,
  maxChars: number = MAX_OUTPUT_BUFFER
): TerminalSessionSnapshot | null {
  let latest: TerminalSession | null = null;
  for (const session of terminalSessions.values()) {
    if (session.cwd !== cwd) continue;
    if (!latest || session.createdAt > latest.createdAt) {
      latest = session;
    }
  }
  if (!latest) return null;
  return toSnapshot(latest, maxChars);
}

// ---------------------------------------------------------------------------
// Broadcast PTY data to all WebSocket subscribers
// ---------------------------------------------------------------------------

function broadcast(session: TerminalSession, data: string): void {
  const dead: ServerWebSocket<WSData>[] = [];
  for (const ws of session.subscribers) {
    try {
      ws.send(data);
    } catch {
      dead.push(ws);
    }
  }
  for (const ws of dead) session.subscribers.delete(ws);
}

function broadcastControl(
  session: TerminalSession,
  payload: Record<string, unknown>
): void {
  const msg = JSON.stringify(payload);
  const dead: ServerWebSocket<WSData>[] = [];
  for (const ws of session.subscribers) {
    try {
      ws.send(msg);
    } catch {
      dead.push(ws);
    }
  }
  for (const ws of dead) session.subscribers.delete(ws);
}

// ---------------------------------------------------------------------------
// Core: create a terminal session
// ---------------------------------------------------------------------------

export async function createTerminalSession(opts: {
  id?: string;
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const id = opts.id ?? crypto.randomUUID();

  if (terminalSessions.has(id)) {
    return { success: true, id }; // idempotent
  }

  const shell = resolveShell(opts.shell);
  const shellArgs = resolveShellArgs(shell);
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const env = buildEnv(opts.env);

  let cwd = opts.cwd ?? os.homedir();
  if (!fs.existsSync(cwd)) {
    console.warn(`[Terminal] cwd not found: ${cwd}, falling back to home`);
    cwd = os.homedir();
  }

  const session: TerminalSession = {
    id,
    pty: null,
    fallbackProc: null,
    isPty: false,
    shell,
    cwd,
    cols,
    rows,
    createdAt: Date.now(),
    outputBuffer: "",
    subscribers: new Set(),
  };

  terminalSessions.set(id, session);

  // --- Attempt bun-pty ---
  const spawn = await tryLoadBunPty();
  if (spawn) {
    try {
      const ptyProc = spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });

      session.pty = ptyProc;
      session.isPty = true;

      ptyProc.onData((data) => {
        // bun-pty may return Uint8Array or string
        const text = typeof data === "string"
          ? data
          : new TextDecoder().decode(data);
        appendOutput(session, text);
        broadcast(session, text);
      });

      ptyProc.onExit(({ exitCode }) => {
        console.log(
          `[Terminal] PTY ${id} exited code=${exitCode}`
        );
        broadcastControl(session, {
          type: "exit",
          code: exitCode,
          signal: null,
        });
        terminalSessions.delete(id);
      });

      console.log(
        `[Terminal] Created PTY session ${id} pid=${ptyProc.pid} shell=${shell}`
      );
      return { success: true, id };
    } catch (err) {
      console.warn(
        `[Terminal] bun-pty spawn failed, trying Bun.spawn fallback:`,
        err instanceof Error ? err.message : String(err)
      );
      session.pty = null;
    }
  }

  // --- Bun.spawn fallback (no PTY, but functional) ---
  try {
    const proc = Bun.spawn([shell, ...shellArgs], {
      cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    session.fallbackProc = proc;
    session.isPty = false;

    // Stream stdout
    (async () => {
      try {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          appendOutput(session, text);
          broadcast(session, text);
        }
      } catch {
        // process ended
      }
    })();

    // Stream stderr
    (async () => {
      try {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          appendOutput(session, text);
          broadcast(session, text);
        }
      } catch {
        // process ended
      }
    })();

    // Wait for exit
    proc.exited.then((code) => {
      console.log(`[Terminal] Fallback process ${id} exited code=${code}`);
      broadcastControl(session, { type: "exit", code: code ?? 0, signal: null });
      terminalSessions.delete(id);
    });

    const warning =
      "\r\n\x1b[33m[Terminal] Running in limited shell mode (no PTY). Some interactive programs may not work correctly.\x1b[0m\r\n";
    appendOutput(session, warning);
    // Don't broadcast warning yet — WebSocket subscriber may not have connected

    console.log(
      `[Terminal] Created fallback session ${id} shell=${shell} (no PTY)`
    );
    return { success: true, id };
  } catch (err) {
    terminalSessions.delete(id);
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Terminal] Failed to create terminal session ${id}:`, error);
    return { success: false, error };
  }
}

// ---------------------------------------------------------------------------
// Core: write to a terminal
// ---------------------------------------------------------------------------

export function writeToSession(
  id: string,
  data: string
): { success: boolean; error?: string } {
  const session = terminalSessions.get(id);
  if (!session) return { success: false, error: "Terminal session not found" };

  try {
    if (session.isPty && session.pty) {
      session.pty.write(data);
    } else if (session.fallbackProc && session.fallbackProc.stdin) {
      session.fallbackProc.stdin.write(data);
    } else {
      return { success: false, error: "No writable process" };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Core: resize a terminal
// ---------------------------------------------------------------------------

export function resizeSession(
  id: string,
  cols: number,
  rows: number
): { success: boolean; error?: string } {
  const session = terminalSessions.get(id);
  if (!session) return { success: false, error: "Terminal session not found" };

  try {
    if (session.isPty && session.pty) {
      session.pty.resize(cols, rows);
    }
    session.cols = cols;
    session.rows = rows;
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Core: kill a terminal
// ---------------------------------------------------------------------------

export function killSession(
  id: string
): { success: boolean; error?: string } {
  const session = terminalSessions.get(id);
  if (!session) return { success: false, error: "Terminal session not found" };

  try {
    if (session.isPty && session.pty) {
      session.pty.kill();
    } else if (session.fallbackProc) {
      session.fallbackProc.kill();
    }
    terminalSessions.delete(id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle — called from server.ts
// ---------------------------------------------------------------------------

/**
 * Called when a WebSocket connection for /api/terminal/ws/:id is opened.
 * Subscribes the socket to the session's output stream and replays the
 * last output from the ring-buffer so the client sees prior output.
 */
export function onTerminalWSOpen(ws: ServerWebSocket<WSData>): void {
  const { sessionId } = ws.data;
  const session = terminalSessions.get(sessionId);

  if (!session) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `Terminal session '${sessionId}' not found. Create it first via POST /api/terminal/create.`,
      })
    );
    ws.close(4004, "Session not found");
    return;
  }

  session.subscribers.add(ws);

  // Send a "connected" control frame so the client knows it's live
  ws.send(
    JSON.stringify({
      type: "connected",
      sessionId,
      cols: session.cols,
      rows: session.rows,
      isPty: session.isPty,
    })
  );

  // Replay buffered output so the terminal renders existing content
  if (session.outputBuffer.length > 0) {
    ws.send(session.outputBuffer);
  }

  console.log(
    `[Terminal] WebSocket subscribed to session ${sessionId} (${session.subscribers.size} subscriber(s))`
  );
}

/**
 * Called when a message arrives on a terminal WebSocket.
 * Raw string data is written directly to the PTY/process stdin.
 * JSON control frames (resize, etc.) are parsed and handled.
 */
export function onTerminalWSMessage(
  ws: ServerWebSocket<WSData>,
  message: string | Buffer
): void {
  const { sessionId } = ws.data;
  const session = terminalSessions.get(sessionId);

  if (!session) {
    ws.send(
      JSON.stringify({ type: "error", message: "Session no longer exists" })
    );
    return;
  }

  const text =
    typeof message === "string" ? message : message.toString("utf-8");

  // Try to parse JSON control frames first
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const frame = JSON.parse(text) as Record<string, unknown>;
      if (frame["type"] === "resize") {
        const cols = Number(frame["cols"]);
        const rows = Number(frame["rows"]);
        if (cols > 0 && rows > 0) {
          resizeSession(sessionId, cols, rows);
        }
        return;
      }
      if (frame["type"] === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (frame["type"] === "input" && typeof frame["data"] === "string") {
        writeToSession(sessionId, frame["data"]);
        return;
      }
    } catch {
      // Not a JSON control frame — treat as raw input
    }
  }

  // Raw text — write to process stdin
  writeToSession(sessionId, text);
}

/**
 * Called when a terminal WebSocket is closed.
 */
export function onTerminalWSClose(
  ws: ServerWebSocket<WSData>,
  code: number,
  reason: string
): void {
  const { sessionId } = ws.data;
  const session = terminalSessions.get(sessionId);
  if (session) {
    session.subscribers.delete(ws);
    console.log(
      `[Terminal] WebSocket unsubscribed from session ${sessionId} code=${code} reason=${reason} (${session.subscribers.size} remaining)`
    );
  }
}

// ---------------------------------------------------------------------------
// Cleanup — call on server shutdown
// ---------------------------------------------------------------------------

export function cleanupAllSessions(): void {
  console.log(
    `[Terminal] Cleaning up ${terminalSessions.size} terminal session(s)`
  );
  for (const [id, session] of terminalSessions) {
    try {
      if (session.isPty && session.pty) {
        session.pty.kill();
      } else if (session.fallbackProc) {
        session.fallbackProc.kill();
      }
    } catch {
      // ignore errors during cleanup
    }
    terminalSessions.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateTerminalSchema = z.object({
  id: z.string().min(1).optional(),
  shell: z.string().optional(),
  cwd: z.string().optional(),
  cols: z.number().int().min(1).max(500).optional().default(80),
  rows: z.number().int().min(1).max(200).optional().default(24),
  env: z.record(z.string()).optional(),
});

const ResizeTerminalSchema = z.object({
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
});

const WriteTerminalSchema = z.object({
  data: z.string(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const terminalRouter = new Hono();

/**
 * POST /api/terminal/create
 *
 * Creates a new pseudo-terminal session.
 * Body: { id?, shell?, cwd?, cols?, rows?, env? }
 * Returns: { id: string, isPty: boolean, cols: number, rows: number }
 */
terminalRouter.post("/create", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const parsed = CreateTerminalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      400
    );
  }

  const result = await createTerminalSession(parsed.data);
  if (!result.success) {
    return c.json({ error: "Internal Server Error", message: result.error }, 500);
  }

  const session = terminalSessions.get(result.id);
  return c.json(
    {
      id: result.id,
      isPty: session?.isPty ?? false,
      cols: session?.cols ?? parsed.data.cols,
      rows: session?.rows ?? parsed.data.rows,
      shell: session?.shell ?? "unknown",
      cwd: session?.cwd ?? os.homedir(),
    },
    201
  );
});

/**
 * GET /api/terminal/sessions
 *
 * Lists all active terminal sessions.
 * Returns: { sessions: Array<{ id, isPty, cols, rows, shell, cwd, createdAt, subscribers }> }
 */
terminalRouter.get("/sessions", (c) => {
  const sessions = Array.from(terminalSessions.values()).map((s) => ({
    id: s.id,
    isPty: s.isPty,
    cols: s.cols,
    rows: s.rows,
    shell: s.shell,
    cwd: s.cwd,
    createdAt: s.createdAt,
    subscriberCount: s.subscribers.size,
    pid: s.pty?.pid ?? s.fallbackProc?.pid ?? null,
  }));
  return c.json({ sessions });
});

/**
 * POST /api/terminal/:id/resize
 *
 * Resizes the pseudo-terminal dimensions.
 * Body: { cols: number, rows: number }
 * Returns: { ok: true }
 */
terminalRouter.post("/:id/resize", async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }

  const parsed = ResizeTerminalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      400
    );
  }

  const result = resizeSession(id, parsed.data.cols, parsed.data.rows);
  if (!result.success) {
    const status = result.error === "Terminal session not found" ? 404 : 500;
    return c.json({ error: result.error }, status);
  }

  return c.json({ ok: true, cols: parsed.data.cols, rows: parsed.data.rows });
});

/**
 * POST /api/terminal/:id/write
 *
 * HTTP fallback for writing data to a terminal (prefer WebSocket for low latency).
 * Body: { data: string }
 * Returns: { ok: true }
 */
terminalRouter.post("/:id/write", async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }

  const parsed = WriteTerminalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      400
    );
  }

  const result = writeToSession(id, parsed.data.data);
  if (!result.success) {
    const status = result.error === "Terminal session not found" ? 404 : 500;
    return c.json({ error: result.error }, status);
  }

  return c.json({ ok: true });
});

/**
 * DELETE /api/terminal/:id
 *
 * Kills and cleans up a terminal session.
 * Returns: { ok: true }
 */
terminalRouter.delete("/:id", (c) => {
  const id = c.req.param("id");

  const result = killSession(id);
  if (!result.success) {
    const status = result.error === "Terminal session not found" ? 404 : 500;
    return c.json({ error: result.error }, status);
  }

  return c.json({ ok: true });
});

/**
 * GET /api/terminal/ws/:id
 *
 * WebSocket upgrade endpoint for streaming terminal I/O.
 * The actual upgrade is handled in server.ts before Hono sees the request.
 * This HTTP handler is reached only when a non-WebSocket client calls the path.
 *
 * Protocol:
 *   Client -> Server: Raw string data  (written to pty stdin)
 *   Client -> Server: JSON { type: "resize", cols: number, rows: number }
 *   Client -> Server: JSON { type: "input", data: string }
 *   Client -> Server: JSON { type: "ping" }
 *   Server -> Client: Raw string data  (pty stdout/stderr)
 *   Server -> Client: JSON { type: "connected", sessionId, cols, rows, isPty }
 *   Server -> Client: JSON { type: "exit", code: number, signal: number | null }
 *   Server -> Client: JSON { type: "pong" }
 *   Server -> Client: JSON { type: "error", message: string }
 */
terminalRouter.get("/ws/:id", (c) => {
  return c.json(
    {
      error: "Bad Request",
      message:
        "This endpoint requires a WebSocket upgrade. Connect with a WebSocket client to /api/terminal/ws/:id.",
    },
    400
  );
});

/**
 * GET /api/terminal/cwd
 *
 * Get the default working directory (user's home directory).
 * Returns: { cwd: string }
 */
terminalRouter.get("/cwd", (c) => {
  return c.json({ cwd: os.homedir() });
});

/**
 * GET /api/terminal/check-port?port=<number>
 *
 * Check whether a specific TCP port is available on localhost.
 * Returns: { available: boolean, port: number }
 */
terminalRouter.get("/check-port", async (c) => {
  const portStr = c.req.query("port");
  if (!portStr) {
    return c.json({ error: "Bad Request", message: "Missing 'port' query parameter" }, 400);
  }
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return c.json({ error: "Bad Request", message: "Invalid port number" }, 400);
  }

  const available = await isPortAvailable(port);
  return c.json({ available, port });
});

/**
 * GET /api/terminal/find-port?startPort=<number>&endPort=<number>
 *
 * Find an available TCP port within a range.
 * Returns: { success: boolean, port?: number, error?: string }
 */
terminalRouter.get("/find-port", async (c) => {
  const startStr = c.req.query("startPort") || "3000";
  const endStr = c.req.query("endPort");
  const startPort = parseInt(startStr, 10);
  const endPort = endStr ? parseInt(endStr, 10) : startPort + 999;

  if (isNaN(startPort) || startPort < 1 || startPort > 65535) {
    return c.json({ success: false, error: "Invalid startPort" }, 400);
  }

  for (let port = startPort; port <= Math.min(endPort, 65535); port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return c.json({ success: true, port });
    }
  }

  return c.json({ success: false, error: `No available port found in range ${startPort}-${endPort}` });
});

/**
 * GET /api/terminal/:id/cwd
 *
 * Get the working directory of a specific terminal session.
 * Must be defined AFTER static routes (/cwd, /check-port, /find-port)
 * so that Hono doesn't match them as :id.
 * Returns: { cwd: string }
 */
terminalRouter.get("/:id/cwd", (c) => {
  const id = c.req.param("id");
  const session = terminalSessions.get(id);
  if (!session) {
    return c.json({ error: "Terminal session not found" }, 404);
  }
  return c.json({ cwd: session.cwd });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a TCP port is available on localhost by attempting to listen on it.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch() {
          return new Response("probe");
        },
      });
      server.stop(true);
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}
