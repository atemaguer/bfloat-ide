import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.ts";
import { healthRouter } from "./routes/health.ts";
import {
  terminalRouter,
  onTerminalWSOpen,
  onTerminalWSMessage,
  onTerminalWSClose,
  cleanupAllSessions,
} from "./routes/terminal.ts";
import { agentRouter } from "./routes/agent.ts";
import { filesystemRouter } from "./routes/filesystem.ts";
import { subscribeWebSocket, unsubscribeWebSocket } from "./services/agent-session.ts";
import { projectFilesRouter } from "./routes/project-files.ts";
import { projectSyncRouter } from "./routes/project-sync.ts";
import { deployRouter } from "./routes/deploy.ts";
import { secretsRouter } from "./routes/secrets.ts";
import { providerRouter } from "./routes/provider.ts";
import { localProjectsRouter } from "./routes/local-projects.ts";
import { templateRouter } from "./routes/template.ts";
import { screenshotRouter } from "./routes/screenshot.ts";
import { workbenchRouter } from "./routes/workbench.ts";
import { previewProxyRouter, previewProxyFallback, getActiveProxyTarget } from "./routes/preview-proxy.ts";
import { shutdownBrowser } from "./services/screenshot.ts";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { port: number; password: string; hostname: string } {
  const args = process.argv.slice(2);
  let port = 7765;
  let password = "";
  let hostname = "127.0.0.1";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      const parsed = parseInt(args[i + 1]!, 10);
      if (!isNaN(parsed)) port = parsed;
      i++;
    } else if (arg === "--password" && args[i + 1]) {
      password = args[i + 1]!;
      i++;
    } else if (arg === "--hostname" && args[i + 1]) {
      hostname = args[i + 1]!;
      i++;
    } else if (arg?.startsWith("--port=")) {
      const parsed = parseInt(arg.split("=")[1]!, 10);
      if (!isNaN(parsed)) port = parsed;
    } else if (arg?.startsWith("--password=")) {
      password = arg.split("=").slice(1).join("=");
    } else if (arg?.startsWith("--hostname=")) {
      hostname = arg.split("=")[1]!;
    }
  }

  if (!password) {
    console.error(
      `[${timestamp()}] FATAL: --password is required. Tauri must launch the sidecar with a shared secret.`
    );
    process.exit(1);
  }

  return { port, password, hostname };
}

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Application bootstrap
// ---------------------------------------------------------------------------

const { port, password, hostname } = parseArgs();

const app = new Hono();

// --- Global middleware ---

// Strip trailing slashes for all methods (Hono sub-routers don't match them).
// Re-dispatch internally so that POST body is preserved (redirects may lose it).
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
    const newReq = new Request(url.toString(), c.req.raw);
    return app.fetch(newReq);
  }
  await next();
});

app.use("*", logger((message: string, ...rest: string[]) => {
  console.log(`[${timestamp()}] ${message}`, ...rest);
}));

app.use(
  "*",
  cors({
    origin: ["tauri://localhost", "http://tauri.localhost", "http://localhost", "http://localhost:1420"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  })
);

// Preview reverse proxy — mounted BEFORE auth middleware because the iframe
// cannot send auth headers.  Target is restricted to localhost in the route.
app.route("/preview-proxy", previewProxyRouter);

// Auth middleware applies to all routes except health (checked inside health route)
app.use("/api/*", authMiddleware(password));

// --- Route groups ---

app.route("/health", healthRouter);
app.route("/api/terminal", terminalRouter);
app.route("/api/agent", agentRouter);
app.route("/api/fs", filesystemRouter);

// ---------------------------------------------------------------------------
// Ported conveyor routes (formerly Electron IPC handlers)
// ---------------------------------------------------------------------------

// Direct file operations scoped to project directories
app.route("/api/project-files", projectFilesRouter);

// Git-based project synchronization (clone, watch, commit, push, pull)
app.route("/api/project-sync", projectSyncRouter);

// iOS EAS builds, Apple credentials, deployment lifecycle
app.route("/api/deploy", deployRouter);

// Project environment variable management (.env.local)
app.route("/api/secrets", secretsRouter);

// AI provider auth: Anthropic, OpenAI/Codex, Expo
app.route("/api/provider", providerRouter);

// Local project + session CRUD (~/.bfloat-ide/projects.json)
app.route("/api/local-projects", localProjectsRouter);

// Template listing and project initialisation from bundled templates
app.route("/api/template", templateRouter);

// Screenshot capture via headless Chrome + preview URL registration
app.route("/api/screenshot", screenshotRouter);

// Workbench runtime metadata for managed dev-server awareness
app.route("/api/workbench", workbenchRouter);

// Catch-all: proxy unmatched requests to the active preview target (if any).
// This handles sub-resources like <script src="/entry.bundle"> that the browser
// resolves to the sidecar origin instead of the /preview-proxy route.
app.all("/*", previewProxyFallback);

// 404 fallback
app.notFound((c) => {
  console.error(`[${timestamp()}] 404 Not Found: ${c.req.method} ${c.req.path}`);
  return c.json({ error: `Not Found: ${c.req.method} ${c.req.path}` }, 404);
});

// Generic error handler
app.onError((err, c) => {
  console.error(`[${timestamp()}] Unhandled error on ${c.req.path}:`, err);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

// ---------------------------------------------------------------------------
// WebSocket upgrade map
// WebSocket connections for /api/terminal/ws/:id and /api/agent/ws/stream are
// handled by Bun's native WebSocket support via the `websocket` handler below.
// ---------------------------------------------------------------------------

type WSData = {
  type: "terminal" | "agent" | "preview-proxy";
  sessionId: string;
  authenticated: boolean;
  /** For preview-proxy WS: the target Expo dev server origin. */
  proxyTarget?: string;
};

// Re-export type alias so the terminal module's ServerWebSocket<WSData>
// is satisfied by the same shape (both define the same fields).

// Map from client WS → upstream WS for preview-proxy HMR forwarding.
const previewProxyUpstreams = new Map<object, WebSocket>();

// ---------------------------------------------------------------------------
// Start Bun server
// ---------------------------------------------------------------------------

console.log(`[${timestamp()}] Starting bfloat-sidecar v0.0.1`);
console.log(`[${timestamp()}] Listening on http://${hostname}:${port}`);

const server = Bun.serve<WSData>({
  port,
  hostname,

  // HTTP request handler — delegates to Hono
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade paths
    if (
      req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
      (url.pathname.startsWith("/api/terminal/ws/") ||
        url.pathname.startsWith("/api/agent/ws/") ||
        url.pathname.startsWith("/preview-proxy/ws"))
    ) {
      // Preview-proxy WS is unauthenticated (target restricted to localhost).
      const isPreviewProxy = url.pathname.startsWith("/preview-proxy/ws");

      // Validate auth before upgrading (skip for preview-proxy).
      // Browser WebSocket API cannot set headers, so we also accept
      // the password as a ?password= query parameter.
      const authHeader = req.headers.get("authorization") ?? "";
      const queryPassword = url.searchParams.get("password") ?? "";
      const authenticated =
        isPreviewProxy ||
        validateWebSocketAuth(authHeader, password) ||
        queryPassword === password;

      if (!authenticated) {
        return new Response("Unauthorized", { status: 401 });
      }

      let type: WSData["type"] = "agent";
      let sessionId = "unknown";
      let proxyTarget: string | undefined;

      if (url.pathname.startsWith("/api/terminal/ws/")) {
        type = "terminal";
        sessionId = url.pathname.replace("/api/terminal/ws/", "");
      } else if (url.pathname.startsWith("/preview-proxy/ws")) {
        type = "preview-proxy";
        proxyTarget = url.searchParams.get("target") ?? undefined;
        sessionId = "preview-proxy";
      } else if (url.pathname.startsWith("/api/agent/ws/")) {
        type = "agent";
        sessionId = url.pathname.replace("/api/agent/ws/", "");
      }

      const upgraded = server.upgrade(req, {
        data: { type, sessionId, authenticated, proxyTarget },
      });

      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Fallback WS upgrade: Metro HMR sockets (e.g. /message, /hot) that
    // don't match any known route but should be proxied to the active Expo
    // dev server when a preview session is active.
    if (
      req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
      getActiveProxyTarget()
    ) {
      const target = getActiveProxyTarget()!;
      const wsTarget = target.replace(/^http/, "ws");
      const proxyTarget = `${wsTarget}${url.pathname}${url.search}`;

      const upgraded = server.upgrade(req, {
        data: {
          type: "preview-proxy" as const,
          sessionId: "preview-proxy",
          authenticated: true,
          proxyTarget,
        },
      });

      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // All other requests go to Hono
    return app.fetch(req);
  },

  // WebSocket lifecycle handlers
  websocket: {
    open(ws) {
      const { type, sessionId } = ws.data;
      console.log(
        `[${timestamp()}] WebSocket opened: type=${type} session=${sessionId}`
      );

      if (type === "terminal") {
        onTerminalWSOpen(ws);
      } else if (type === "preview-proxy") {
        // Pipe this client WS to the upstream Expo dev server's WS.
        const target = ws.data.proxyTarget;
        if (!target) {
          ws.send(JSON.stringify({ type: "error", message: "Missing ?target= for preview-proxy WS" }));
          ws.close(4000, "Missing target");
          return;
        }
        try {
          const wsTarget = target.replace(/^http/, "ws");
          const upstream = new WebSocket(wsTarget);
          previewProxyUpstreams.set(ws, upstream);

          upstream.addEventListener("message", (event) => {
            try { ws.send(typeof event.data === "string" ? event.data : event.data); } catch {}
          });
          upstream.addEventListener("close", () => {
            try { ws.close(); } catch {}
            previewProxyUpstreams.delete(ws);
          });
          upstream.addEventListener("error", () => {
            try { ws.close(); } catch {}
            previewProxyUpstreams.delete(ws);
          });
        } catch (err) {
          console.error(`[${timestamp()}] Preview proxy WS upstream connection failed:`, err);
          ws.close(4002, "Upstream connection failed");
        }
      } else if (type === "agent") {
        // Subscribe this WebSocket to the agent session's stream.
        // subscribeWebSocket sends an immediate "connected" frame so the
        // client knows it is registered.
        const found = subscribeWebSocket(sessionId, ws);
        if (!found) {
          ws.send(
            JSON.stringify({
              type: "error",
              sessionId,
              seq: 0,
              ts: new Date().toISOString(),
              payload: {
                code: "session_not_found",
                message: `Agent session '${sessionId}' not found. Create it first via POST /api/agent/sessions.`,
                recoverable: false,
              },
            })
          );
          ws.close(4004, "Session not found");
        }
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown WebSocket type: '${type}'.`,
          })
        );
        ws.close(4000, "Unknown session type");
      }
    },

    message(ws, message) {
      const { type, sessionId } = ws.data;
      console.log(
        `[${timestamp()}] WebSocket message: type=${type} session=${sessionId} bytes=${
          typeof message === "string" ? message.length : (message as Buffer).byteLength
        }`
      );

      if (type === "terminal") {
        onTerminalWSMessage(ws, message as string | Buffer);
      } else if (type === "preview-proxy") {
        // Forward client → upstream for HMR
        const upstream = previewProxyUpstreams.get(ws);
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          upstream.send(typeof message === "string" ? message : message);
        }
      } else if (type === "agent") {
        // Agent WebSockets are subscribe-only (server → client). Client-to-server
        // messages are not currently used; the client sends messages via the
        // POST /api/agent/sessions/:id/message REST endpoint instead.
        // We silently ignore any incoming frames to avoid breaking clients that
        // send pings or control frames.
        console.log(`[${timestamp()}] Agent WS incoming frame ignored (subscribe-only) for session ${sessionId}`);
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown WebSocket type: '${type}'.`,
          })
        );
      }
    },

    close(ws, code, reason) {
      const { type, sessionId } = ws.data;
      console.log(
        `[${timestamp()}] WebSocket closed: type=${type} session=${sessionId} code=${code} reason=${reason}`
      );

      if (type === "terminal") {
        onTerminalWSClose(ws, code, reason);
      } else if (type === "preview-proxy") {
        const upstream = previewProxyUpstreams.get(ws);
        if (upstream) {
          try { upstream.close(); } catch {}
          previewProxyUpstreams.delete(ws);
        }
      } else if (type === "agent") {
        // Unsubscribe this WebSocket from the agent session.
        // The session itself is NOT closed — the client must DELETE the session
        // explicitly if they want to tear it down.
        unsubscribeWebSocket(sessionId, ws);
      }
    },

    error(ws, error) {
      console.error(
        `[${timestamp()}] WebSocket error: session=${ws.data.sessionId}`,
        error
      );
    },
  },
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`[${timestamp()}] Received ${signal}. Shutting down gracefully...`);
  cleanupAllSessions();
  await shutdownBrowser();
  server.stop(true);
  console.log(`[${timestamp()}] Server stopped. Goodbye.`);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("exit", () => {
  cleanupAllSessions();
});

process.on("uncaughtException", (err) => {
  console.error(`[${timestamp()}] Uncaught exception:`, err);
  cleanupAllSessions();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${timestamp()}] Unhandled rejection:`, reason);
  cleanupAllSessions();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateWebSocketAuth(authHeader: string, expectedPassword: string): boolean {
  if (!authHeader.startsWith("Basic ")) return false;
  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;
  const suppliedPassword = decoded.slice(colonIdx + 1);
  return suppliedPassword === expectedPassword;
}
