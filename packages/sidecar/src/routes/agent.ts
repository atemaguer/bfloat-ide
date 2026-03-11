/**
 * AI Agent routes
 *
 * HTTP REST endpoints for AI agent session management. WebSocket streaming is
 * handled in server.ts via Bun.serve()'s native WebSocket support — this file
 * only owns the HTTP surface.
 *
 * Endpoints
 * ---------
 * POST   /api/agent/sessions              — create a new session
 * GET    /api/agent/sessions              — list all tracked sessions
 * GET    /api/agent/sessions/:id          — get a single session's state
 * DELETE /api/agent/sessions/:id          — close a session
 * POST   /api/agent/sessions/:id/message  — send a message (streams via WS)
 * POST   /api/agent/sessions/:id/cancel   — cancel an in-progress response
 * GET    /api/agent/sessions/:id/stream   — documents the WS endpoint
 *
 * WebSocket (handled in server.ts)
 * --------------------------------
 * WS /api/agent/ws/:id
 *   Client → Server: (none — subscribe-only)
 *   Server → Client: JSON AgentFrame per event
 *
 *   Frame format: see AgentFrame in services/agent-session.ts
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  createSession,
  listSessions,
  getSession,
  closeSession,
  sendMessage,
  cancelMessage,
  getProviders,
  getProvider,
  getBackgroundSessionByProject,
  getBackgroundSessionById,
  getBackgroundSessionByRealId,
  listBackgroundSessions,
  unregisterBackgroundSession,
  getBackgroundMessages,
  type AgentProviderId,
  type AgentFrame,
  type UserDisplayMessage,
} from "../services/agent-session.ts";
import {
  readSession as readSessionFromStorage,
  listSessions as listSessionsFromStorage,
} from "../services/session-reader.ts";
import { translateFrameToMessage } from "../services/agent-message.ts";
import { readSessionHistory } from "../services/session-journal.ts";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateSessionSchema = z.object({
  provider: z
    .enum(["claude", "codex", "openai", "bfloat"])
    .optional()
    .default("claude"),
  model: z.string().optional(),
  cwd: z.string().min(1),
  systemPrompt: z.string().optional(),
  permissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan", "delegate", "dontAsk"])
    .optional()
    .default("default"),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  env: z.record(z.string()).optional(),
  projectId: z.string().optional(),
  resumeSessionId: z.string().optional(),
  mcpServers: z.record(z.unknown()).optional(),
});

const SendMessageSchema = z.object({
  content: z.string().min(1, "Message content must not be empty"),
  displayMessage: z.object({
    id: z.string().min(1),
    role: z.literal("user"),
    content: z.string(),
    parts: z.array(z.record(z.unknown())).optional(),
    createdAt: z.string(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const agentRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/agent/sessions
//
// Create a new AI agent session.
//
// Body: CreateSessionSchema
// Returns: { sessionId: string, provider: string, status: string }
// ---------------------------------------------------------------------------

agentRouter.post("/sessions", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be valid JSON." }, 400);
  }

  const parsed = CreateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation Error",
        message: "Invalid request body.",
        details: parsed.error.flatten(),
      },
      422
    );
  }

  const { provider, ...sessionOptions } = parsed.data;

  // Verify the provider is registered and authenticated
  const providerInstance = getProvider(provider as AgentProviderId);
  if (!providerInstance) {
    return c.json(
      { error: "Not Found", message: `Provider '${provider}' is not registered.` },
      404
    );
  }

  const isAuthenticated = await providerInstance.isAuthenticated();
  if (!isAuthenticated) {
    return c.json(
      {
        error: "Unauthorized",
        message: `Provider '${provider}' is not authenticated. Configure credentials before creating a session.`,
      },
      401
    );
  }

  const result = createSession(provider as AgentProviderId, sessionOptions);

  if (!result.success) {
    return c.json({ error: "Internal Server Error", message: result.error }, 500);
  }

  const state = getSession(result.sessionId)!;

  return c.json(
    {
      sessionId: result.sessionId,
      provider: state.provider,
      status: state.status,
      model: state.model,
      cwd: state.cwd,
      projectId: state.projectId,
      startTime: state.startTime,
    },
    201
  );
});

// ---------------------------------------------------------------------------
// GET /api/agent/sessions
//
// List all tracked sessions.
//
// Returns: Array of session state objects.
// ---------------------------------------------------------------------------

agentRouter.get("/sessions", (c) => {
  const all = listSessions();
  return c.json({
    sessions: all.map((s) => ({
      id: s.id,
      provider: s.provider,
      status: s.status,
      model: s.model,
      cwd: s.cwd,
      projectId: s.projectId,
      messageCount: s.messageCount,
      totalTokens: s.totalTokens,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    total: all.length,
  });
});

// ---------------------------------------------------------------------------
// GET /api/agent/sessions/:id
//
// Get the current state of a session.
//
// Returns: Full session state including conversation history.
// ---------------------------------------------------------------------------

agentRouter.get("/sessions/:id", (c) => {
  const sessionId = c.req.param("id");
  const state = getSession(sessionId);

  if (!state) {
    return c.json({ error: "Not Found", message: `Session '${sessionId}' not found.` }, 404);
  }

  return c.json({
    id: state.id,
    provider: state.provider,
    status: state.status,
    model: state.model,
    cwd: state.cwd,
    projectId: state.projectId,
    realSessionId: state.realSessionId,
    messageCount: state.messageCount,
    totalTokens: state.totalTokens,
    totalCostUsd: state.totalCostUsd,
    startTime: state.startTime,
    endTime: state.endTime,
    conversation: state.conversation,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/agent/sessions/:id
//
// Close a session and free all associated resources.
// Any active stream is cancelled; all WebSocket subscribers are disconnected.
//
// Returns: { success: true }
// ---------------------------------------------------------------------------

agentRouter.delete("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const result = await closeSession(sessionId);

  if (!result.success) {
    return c.json({ error: "Not Found", message: result.error }, 404);
  }

  return c.json({ success: true, sessionId });
});

// ---------------------------------------------------------------------------
// POST /api/agent/sessions/:id/message
//
// Send a message to an agent session. The response streams asynchronously
// over the WebSocket at /api/agent/ws/:id. This endpoint returns immediately
// after enqueuing the message.
//
// Body: { content: string }
// Returns: { queued: true, sessionId: string, wsPath: string }
// ---------------------------------------------------------------------------

agentRouter.post("/sessions/:id/message", async (c) => {
  const sessionId = c.req.param("id");

  // Verify session exists before parsing body
  const state = getSession(sessionId);
  if (!state) {
    return c.json({ error: "Not Found", message: `Session '${sessionId}' not found.` }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be valid JSON." }, 400);
  }

  const parsed = SendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation Error",
        message: "Invalid request body.",
        details: parsed.error.flatten(),
      },
      422
    );
  }

  const result = sendMessage(
    sessionId,
    parsed.data.content,
    parsed.data.displayMessage as UserDisplayMessage | undefined,
  );

  if (!result.success) {
    // sendMessage returns an error if the session is already running
    return c.json({ error: "Conflict", message: result.error }, 409);
  }

  return c.json({
    queued: true,
    sessionId,
    wsPath: `/api/agent/ws/${sessionId}`,
    message: "Message enqueued. Connect to the WebSocket path to receive streamed frames.",
  });
});

// ---------------------------------------------------------------------------
// POST /api/agent/sessions/:id/cancel
//
// Cancel an in-progress response. The session remains open; you can send
// another message after cancellation.
//
// Returns: { success: true, sessionId: string }
// ---------------------------------------------------------------------------

agentRouter.post("/sessions/:id/cancel", (c) => {
  const sessionId = c.req.param("id");

  const state = getSession(sessionId);
  if (!state) {
    return c.json({ error: "Not Found", message: `Session '${sessionId}' not found.` }, 404);
  }

  const result = cancelMessage(sessionId);

  if (!result.success) {
    return c.json({ error: "Internal Server Error", message: result.error }, 500);
  }

  return c.json({ success: true, sessionId });
});

// ---------------------------------------------------------------------------
// GET /api/agent/sessions/:id/stream
//
// Documents the WebSocket endpoint. Returns a 400 with instructions because
// the actual upgrade is handled by Bun.serve() in server.ts before Hono
// sees the request.
// ---------------------------------------------------------------------------

agentRouter.get("/sessions/:id/stream", (c) => {
  const sessionId = c.req.param("id");
  return c.json(
    {
      error: "Bad Request",
      message:
        "This endpoint requires a WebSocket upgrade. " +
        `Connect with a WebSocket client to /api/agent/ws/${sessionId}.`,
      wsUrl: `/api/agent/ws/${sessionId}`,
      protocol:
        "Frames are JSON-encoded AgentFrame objects: " +
        "{ type, sessionId, seq, ts, payload }. " +
        "Frame types: init | text | reasoning | tool_call | tool_result | queue_user_prompt | error | done | stream_end | cancelled",
    },
    400
  );
});

// ---------------------------------------------------------------------------
// GET /api/agent/providers
//
// List all registered AI providers and their authentication status.
// ---------------------------------------------------------------------------

agentRouter.get("/providers", async (c) => {
  const providers = getProviders();
  const infos = await Promise.all(
    providers.map(async (p) => ({
      id: p.id,
      name: p.name,
      isAuthenticated: await p.isAuthenticated(),
    }))
  );
  return c.json({ providers: infos });
});

// ---------------------------------------------------------------------------
// GET /api/agent/providers/:id/models
//
// Get available models for a provider.
// ---------------------------------------------------------------------------

agentRouter.get("/providers/:id/models", async (c) => {
  const providerId = c.req.param("id") as AgentProviderId;
  const provider = getProvider(providerId);

  if (!provider) {
    return c.json({ error: "Not Found", message: `Provider '${providerId}' not found.` }, 404);
  }

  const models = await provider.getAvailableModels();
  return c.json({ provider: providerId, models });
});

// Legacy routes kept for backward-compatibility with any existing callers.
// They redirect to the new canonical paths.

agentRouter.post("/session/create", (c) => {
  return c.json(
    {
      error: "Gone",
      message: "This endpoint has moved to POST /api/agent/sessions.",
      newPath: "/api/agent/sessions",
    },
    308
  );
});

agentRouter.post("/message", (c) => {
  return c.json(
    {
      error: "Gone",
      message: "This endpoint has moved to POST /api/agent/sessions/:id/message.",
      newPath: "/api/agent/sessions/:id/message",
    },
    308
  );
});

agentRouter.post("/session/:id/cancel", (c) => {
  const id = c.req.param("id");
  return c.json(
    {
      error: "Gone",
      message: `This endpoint has moved to POST /api/agent/sessions/${id}/cancel.`,
      newPath: `/api/agent/sessions/${id}/cancel`,
    },
    308
  );
});

agentRouter.delete("/session/:id", (c) => {
  const id = c.req.param("id");
  return c.json(
    {
      error: "Gone",
      message: `This endpoint has moved to DELETE /api/agent/sessions/${id}.`,
      newPath: `/api/agent/sessions/${id}`,
    },
    308
  );
});

agentRouter.get("/ws/stream", (c) => {
  return c.json(
    {
      error: "Bad Request",
      message:
        "The multiplexed WebSocket has been replaced with per-session WebSockets. " +
        "Connect to /api/agent/ws/:sessionId instead.",
    },
    400
  );
});

// ---------------------------------------------------------------------------
// POST /api/agent/generate-project-name
//
// Generate a short, descriptive project name from a user prompt. Uses the
// specified AI provider if available, otherwise returns a deterministic
// fallback name derived from the description text.
//
// Body: { description: string, provider?: AgentProviderId }
// Returns: { success: boolean, name: string, source: "ai"|"fallback", error?: string }
// ---------------------------------------------------------------------------

const GenerateNameSchema = z.object({
  description: z.string().min(1, "Description must not be empty"),
  provider: z
    .enum(["claude", "codex", "openai", "bfloat"])
    .optional()
    .default("claude"),
});

/**
 * Derive a deterministic project title from the first few words of the
 * description.  Used as a fast fallback when AI generation is unavailable.
 */
function fallbackProjectName(description: string): string {
  const words = description.trim().split(/\s+/).slice(0, 4);
  const base = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return base || "Untitled Project";
}

agentRouter.post("/generate-project-name", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Bad Request", message: "Request body must be valid JSON." },
      400,
    );
  }

  const parsed = GenerateNameSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation Error",
        message: "Invalid request body.",
        details: parsed.error.flatten(),
      },
      422,
    );
  }

  const { description, provider: providerId } = parsed.data;

  // Try AI-powered generation via the provider's streamMessage
  const provider = getProvider(providerId as AgentProviderId);
  if (provider) {
    try {
      const isAuth = await provider.isAuthenticated();
      if (isAuth) {
        const prompt =
          `Generate a short, catchy project name (2-4 words, no quotes) for the following idea:\n\n"${description}"\n\nRespond with ONLY the project name, nothing else.`;

        let collected = "";
        const ac = new AbortController();
        // 10-second timeout for name generation
        const timeout = setTimeout(() => ac.abort(), 10_000);

        try {
          for await (const event of provider.streamMessage(prompt, {
            cwd: process.cwd(),
            abortController: ac,
          })) {
            if (event.kind === "text") {
              collected += event.delta;
            }
          }
        } finally {
          clearTimeout(timeout);
        }

        const name = collected.trim().replace(/^["']|["']$/g, "");
        if (name && name.length > 0 && name.length < 100) {
          return c.json({
            success: true,
            name,
            source: "ai" as const,
          });
        }
      }
    } catch (err) {
      console.warn(
        `[agent] AI name generation failed for provider '${providerId}':`,
        err instanceof Error ? err.message : err,
      );
      // Fall through to fallback
    }
  }

  // Fallback: derive name from description text
  return c.json({
    success: true,
    name: fallbackProjectName(description),
    source: "fallback" as const,
  });
});

// ===========================================================================
// Background session routes
//
// Background sessions track agent sessions by projectId so the renderer can
// reconnect when navigating away and returning to a project.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/agent/background
//
// List all active background sessions.
// ---------------------------------------------------------------------------

agentRouter.get("/background", (c) => {
  const sessions = listBackgroundSessions();
  return c.json(
    sessions.map((bg) => ({
      sessionId: bg.sessionId,
      projectId: bg.projectId,
      provider: bg.provider,
      status: bg.status,
      startedAt: bg.startedAt,
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /api/agent/background/by-id/:sessionId
//
// Look up a background session by session ID (reverse lookup).
// ---------------------------------------------------------------------------

agentRouter.get("/background/by-id/:sessionId", (c) => {
  const { sessionId } = c.req.param();
  // Try internal sidecar ID first, then fall back to provider's real session ID.
  // The React app stores the provider's ID (e.g., Claude CLI UUID) in projects.json
  // and passes it when switching session tabs.
  const bg = getBackgroundSessionById(sessionId) ?? getBackgroundSessionByRealId(sessionId);
  if (!bg) {
    return c.json({ success: false } as const);
  }

  return c.json({
    success: true,
    session: {
      sessionId: bg.sessionId,
      projectId: bg.projectId,
      provider: bg.provider,
      cwd: bg.cwd,
      streamChannel: bg.streamChannel,
      status: bg.status,
      startedAt: bg.startedAt,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/agent/background/:projectId
//
// Get the background session for a specific project.
// ---------------------------------------------------------------------------

agentRouter.get("/background/:projectId", (c) => {
  const { projectId } = c.req.param();
  const bg = getBackgroundSessionByProject(projectId);
  if (!bg) {
    return c.json({ success: false } as const);
  }

  return c.json({
    success: true,
    session: {
      sessionId: bg.sessionId,
      projectId: bg.projectId,
      provider: bg.provider,
      cwd: bg.cwd,
      streamChannel: bg.streamChannel,
      status: bg.status,
      startedAt: bg.startedAt,
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/agent/background/:sessionId
//
// Unregister a background session (cleanup after reconnecting).
// ---------------------------------------------------------------------------

agentRouter.delete("/background/:sessionId", (c) => {
  const { sessionId } = c.req.param();
  const removed = unregisterBackgroundSession(sessionId);
  return c.json({ success: removed });
});

// ===========================================================================
// Background messages route
//
// Returns buffered frames for a session, used to replay missed messages
// when the UI reconnects.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/agent/sessions/:id/messages
//
// Get buffered messages for a session. Query params:
//   afterSeq - only return messages with seq > afterSeq
// ---------------------------------------------------------------------------

agentRouter.get("/sessions/:id/messages", (c) => {
  const { id: sessionId } = c.req.param();
  const afterSeqStr = c.req.query("afterSeq");
  const afterSeq = afterSeqStr !== undefined ? parseInt(afterSeqStr, 10) : undefined;

  const result = getBackgroundMessages(sessionId, afterSeq);
  if (!result.success) {
    return c.json({
      success: false,
      error: "No buffered messages found for this session.",
      messages: [],
    });
  }

  // Translate AgentFrame[] → AgentMessage[] so the React frontend
  // receives the expected shape (type + content + metadata.seq).
  const messages = result.messages.map(translateFrameToMessage);

  return c.json({
    success: true,
    messages,
  });
});

agentRouter.get("/sessions/:id/history", async (c) => {
  const { id: sessionId } = c.req.param();
  const result = await readSessionHistory(sessionId);

  if (!result) {
    return c.json({ success: false, error: "Session history not found" }, 404);
  }

  return c.json({
    success: true,
    sessionId: result.canonicalSessionId,
    provider: result.journal.provider,
    providerSessionId: result.journal.providerSessionId,
    status: result.journal.status,
    lastSeq: result.journal.lastSeq,
    entries: result.journal.entries,
  });
});

// ===========================================================================
// Session storage routes
//
// Read sessions from the local CLI's storage (e.g., ~/.claude/projects/).
// These are used to load conversation history on project open.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/agent/storage/:provider/sessions
//
// List available sessions for a project from local CLI storage.
// Query params:
//   projectPath - project path to list sessions for
// ---------------------------------------------------------------------------

agentRouter.get("/storage/:provider/sessions", async (c) => {
  const { provider } = c.req.param();
  const projectPath = c.req.query("projectPath");

  const validProviders = ["claude", "codex", "bfloat"];
  if (!validProviders.includes(provider)) {
    return c.json({ error: "Bad Request", message: `Invalid provider: ${provider}` }, 400);
  }

  const result = await listSessionsFromStorage(
    provider as "claude" | "codex" | "bfloat",
    projectPath,
  );

  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/agent/storage/:provider/sessions/:sessionId
//
// Read a persisted session from local CLI storage.
// Query params:
//   sessionId   - the session ID to read (also in URL)
//   projectPath - optional project path to aid session discovery
// ---------------------------------------------------------------------------

agentRouter.get("/storage/:provider/sessions/:sessionId", async (c) => {
  const { provider, sessionId } = c.req.param();
  const projectPath = c.req.query("projectPath");

  const validProviders = ["claude", "codex", "bfloat"];
  if (!validProviders.includes(provider)) {
    return c.json({ error: "Bad Request", message: `Invalid provider: ${provider}` }, 400);
  }

  const result = await readSessionFromStorage(
    sessionId,
    provider as "claude" | "codex" | "bfloat",
    projectPath,
  );

  if (!result.success) {
    return c.json(result, 404);
  }

  return c.json(result);
});
