import { Hono } from "hono";

const SIDECAR_VERSION = "0.0.1" as const;

export const healthRouter = new Hono();

/**
 * GET /health
 *
 * Public endpoint — intentionally does NOT require authentication so that the
 * Tauri backend can poll it immediately after spawning the sidecar process to
 * detect when it is ready to accept requests.
 *
 * Returns 200 once the server is up.
 */
healthRouter.get("/", (c) => {
  return c.json(
    {
      status: "ok",
      version: SIDECAR_VERSION,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    200
  );
});
