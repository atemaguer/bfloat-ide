/**
 * Screenshot HTTP Routes
 *
 * POST /capture       — Capture a screenshot of a URL (or the registered preview URL)
 * POST /register-url  — Register a preview URL for a project cwd
 */

import { Hono } from "hono";
import { captureScreenshot, registerPreviewUrl, getPreviewUrl } from "../services/screenshot.ts";

export const screenshotRouter = new Hono();

/**
 * POST /capture
 * Body: { url?: string, cwd?: string, width?: number, height?: number }
 *
 * If `url` is omitted, looks up the registered preview URL for `cwd`.
 * Returns: { success: boolean, dataUrl?: string, error?: string }
 */
screenshotRouter.post("/capture", async (c) => {
  const body = await c.req.json<{
    url?: string;
    cwd?: string;
    width?: number;
    height?: number;
  }>();

  let targetUrl = body.url;

  if (!targetUrl && body.cwd) {
    targetUrl = getPreviewUrl(body.cwd);
  }

  if (!targetUrl) {
    return c.json(
      { success: false, error: "No URL provided and no preview URL registered for this project." },
      400
    );
  }

  const result = await captureScreenshot({
    url: targetUrl,
    width: body.width,
    height: body.height,
  });

  return c.json(result);
});

/**
 * POST /register-url
 * Body: { cwd: string, url: string }
 */
screenshotRouter.post("/register-url", async (c) => {
  const body = await c.req.json<{ cwd: string; url: string }>();

  if (!body.cwd || !body.url) {
    return c.json({ success: false, error: "Both cwd and url are required." }, 400);
  }

  registerPreviewUrl(body.cwd, body.url);
  return c.json({ success: true });
});
