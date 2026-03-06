import { Hono } from "hono";
import { z } from "zod";
import {
  assessDevServer,
  getRuntimeState,
  upsertRuntimeState,
  type RuntimeAppType,
  type RuntimeServerStatus,
} from "../services/workbench-runtime.ts";

const RuntimeUpdateSchema = z.object({
  cwd: z.string().min(1),
  serverStatus: z.enum(["starting", "running", "error", "unknown"]).optional(),
  previewUrl: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  expoUrl: z.string().optional(),
  appType: z.enum(["web", "mobile"]).optional(),
  devServerTerminalId: z.string().optional(),
});

export const workbenchRouter = new Hono();

workbenchRouter.post("/runtime", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }

  const parsed = RuntimeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: "Validation failed.",
        details: parsed.error.flatten(),
      },
      422
    );
  }

  const normalized = upsertRuntimeState({
    cwd: parsed.data.cwd,
    serverStatus: parsed.data.serverStatus as RuntimeServerStatus | undefined,
    previewUrl: parsed.data.previewUrl,
    port: parsed.data.port,
    expoUrl: parsed.data.expoUrl,
    appType: parsed.data.appType as RuntimeAppType | undefined,
    devServerTerminalId: parsed.data.devServerTerminalId,
  });

  return c.json({ success: true, state: normalized });
});

workbenchRouter.get("/runtime", async (c) => {
  const cwd = c.req.query("cwd");
  if (!cwd) {
    return c.json({ success: false, error: "Missing 'cwd' query parameter." }, 400);
  }

  const includeChecks = c.req.query("includeChecks") !== "false";
  const state = getRuntimeState(cwd);
  const assessment = await assessDevServer(cwd, includeChecks);

  return c.json({
    success: true,
    state,
    assessment,
  });
});
