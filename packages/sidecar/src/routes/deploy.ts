/**
 * Deploy Routes
 *
 * Ports the Electron deploy-handler IPC handlers to Hono HTTP routes.
 * Handles iOS EAS builds, Apple credentials management, and session tracking.
 *
 * Key differences from the Electron handler:
 * - Progress events that were sent via BrowserWindow.webContents.send() are
 *   delivered over SSE streams (GET /stream/:buildId).
 * - Uses bun-pty for interactive parity, with Bun.spawn() fallback.
 * - electron.app.getPath() → os.homedir() + .bfloat-ide
 *
 * Routes:
 *   POST /api/deploy/ios-build            – start non-interactive EAS build
 *   POST /api/deploy/ios-build-interactive – start interactive build (Apple ID / 2FA)
 *   POST /api/deploy/submit-input         – inject stdin input into active build
 *   GET  /api/deploy/stream/:buildId      – SSE stream of build logs + progress
 *   POST /api/deploy/cancel               – cancel active build
 *   POST /api/deploy/save-asc-api-key     – save App Store Connect API key
 *   GET  /api/deploy/check-asc-api-key    – check ASC API key config
 *   GET  /api/deploy/apple-sessions       – list Apple sessions (Fastlane cookie-based)
 *   POST /api/deploy/clear-apple-session  – delete Apple session files
 *   POST /api/deploy/write-apple-creds    – write temp credentials file
 *   POST /api/deploy/delete-creds-file    – delete credentials file
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { IPty } from "bun-pty";
import { spawn as bunPtySpawn } from "bun-pty";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getASCKeysDir(): string {
  return path.join(os.homedir(), ".bfloat-ide", "keys", "asc");
}

function getAppleSessionsDir(): string {
  return path.join(os.homedir(), ".app-store", "auth");
}

// ---------------------------------------------------------------------------
// PATH augmentation (mirrors deploy-handler.ts getEnhancedPath)
// ---------------------------------------------------------------------------

function getEnhancedPath(): string {
  const current = process.env.PATH ?? "";
  const home = os.homedir();

  const extras = [
    path.join(home, ".local", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".nvm", "current", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/bin",
    "/sbin",
  ];

  // Try to find active NVM version
  const nvmDir = path.join(home, ".nvm", "versions", "node");
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir).filter((v) => v.startsWith("v"));
      if (versions.length > 0) {
        versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        extras.unshift(path.join(nvmDir, versions[0], "bin"));
      }
    } catch { /* ignore */ }
  }

  return [...extras, ...current.split(path.delimiter)].filter(Boolean).join(path.delimiter);
}

function getEnhancedEnv(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    TERM: "xterm-256color",
    ...extra,
  };
}

console.log("[Deploy] bun-pty imported for deploy route");

// ---------------------------------------------------------------------------
// ANSI cleaner (mirrors deploy-handler cleanAnsi)
// ---------------------------------------------------------------------------

function cleanAnsi(text: string): string {
  return text
    .replace(/\r/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[1G\x1b\[0K/g, "\n")
    .replace(/\[1G\[0K/g, "\n")
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⇇⠏⠇⠏⠋★⚙✓✗✔✖⚪⚫]+/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x08]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\x1b/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// ASC App ID extraction + eas.json update
// ---------------------------------------------------------------------------

async function extractAndSaveAscAppId(projectPath: string, output: string): Promise<void> {
  const match = output.match(/ASC App ID:\s*(\d+)/);
  if (!match) return;
  const ascAppId = match[1];

  try {
    const easJsonPath = path.join(projectPath, "eas.json");
    const raw = await Bun.file(easJsonPath).text();
    const config = JSON.parse(raw);

    if (config.submit?.production?.ios?.ascAppId === ascAppId) return;

    if (!config.submit) config.submit = {};
    if (!config.submit.production) config.submit.production = {};
    if (!config.submit.production.ios) config.submit.production.ios = {};
    config.submit.production.ios.ascAppId = ascAppId;

    await Bun.write(easJsonPath, JSON.stringify(config, null, 2));
    console.log(`[Deploy] Saved ASC App ID ${ascAppId} to eas.json`);
  } catch (err) {
    console.error("[Deploy] Failed to save ASC App ID:", err);
  }
}

// ---------------------------------------------------------------------------
// ASC API key config
// ---------------------------------------------------------------------------

interface CheckASCResult {
  configured: boolean;
  keyId?: string;
  issuerId?: string;
  keyPath?: string;
}

async function checkASCApiKeyConfig(projectPath: string): Promise<CheckASCResult> {
  try {
    const easJsonPath = path.join(projectPath, "eas.json");
    if (!fs.existsSync(easJsonPath)) return { configured: false };

    const raw = await Bun.file(easJsonPath).text();
    const easConfig = JSON.parse(raw);
    const iosSubmit = easConfig.submit?.production?.ios;

    if (iosSubmit?.ascApiKeyPath && iosSubmit?.ascApiKeyId && iosSubmit?.ascApiKeyIssuerId) {
      const keyPath = (iosSubmit.ascApiKeyPath as string).replace(/^~/, os.homedir());
      if (fs.existsSync(keyPath)) {
        return {
          configured: true,
          keyId: iosSubmit.ascApiKeyId,
          issuerId: iosSubmit.ascApiKeyIssuerId,
          keyPath: iosSubmit.ascApiKeyPath,
        };
      }
    }

    return { configured: false };
  } catch {
    return { configured: false };
  }
}

// ---------------------------------------------------------------------------
// Active build registry + SSE event emitter
// ---------------------------------------------------------------------------

type BuildEventListener = (event: { type: string; data: unknown }) => void;

interface ActiveBuild {
  buildId: string;
  projectPath: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  pty: IPty | null;
  listeners: Set<BuildEventListener>;
  stdinWrite: ((input: string) => Promise<void>) | null;
  output: string;
  lastProgress: { step: string; message: string; percent: number; buildUrl?: string; error?: string } | null;
  lastInteractivePrompt: string | null;
  done: boolean;
  result: { success: boolean; buildUrl?: string; error?: string } | null;
}

const activeBuilds = new Map<string, ActiveBuild>();

function getLatestBuildId(): string | null {
  let last: string | null = null;
  for (const id of activeBuilds.keys()) {
    last = id;
  }
  return last;
}

function emitBuildEvent(build: ActiveBuild, type: string, data: unknown): void {
  const event = { type, data };
  for (const listener of build.listeners) {
    try {
      listener(event);
    } catch { /* ignore dead listeners */ }
  }
}

function detectAndHandleInteractivePrompt(
  build: ActiveBuild,
  cleanData: string,
  ctx: {
    hasAppleId: boolean;
    getPendingPassword: () => string;
    clearPendingPassword: () => void;
  }
): void {
  const text = cleanData.trim();
  if (!text) return;

  const twoFaPattern =
    /(6-digit|verification code|two[- ]factor|2fa|security code|one-time passcode|one-time password|apple.*code)/i;
  if (twoFaPattern.test(text)) {
    const key = `2fa:${text.slice(0, 120)}`;
    if (build.lastInteractivePrompt !== key) {
      build.lastInteractivePrompt = key;
      emitBuildEvent(build, "interactive_auth", {
        type: "2fa",
        confidence: 0.95,
        context: text,
        suggestion: "Enter the verification code sent to your trusted device.",
      });
    }
    return;
  }

  const yesNoPattern =
    /(\(Y\/n\)|\(y\/N\)|Would you like|Do you want|Proceed\?|Continue\?|log in to your Apple account\?)/i;
  if (yesNoPattern.test(text) && build.stdinWrite) {
    const key = `yesno:${text.slice(0, 120)}`;
    if (build.lastInteractivePrompt !== key) {
      build.lastInteractivePrompt = key;
      emitBuildEvent(build, "interactive_auth", {
        type: "yes_no",
        confidence: 0.9,
        context: text,
        suggestion: "y",
      });
      void build.stdinWrite("y\n").catch(() => {});
    }
    return;
  }

  const menuPattern =
    /(^\s*›\s*.+$)|use arrow keys|select an option|choose.*from|pick.*option/i;
  if (menuPattern.test(text) && build.stdinWrite) {
    const key = `menu:${text.slice(0, 120)}`;
    if (build.lastInteractivePrompt !== key) {
      build.lastInteractivePrompt = key;
      emitBuildEvent(build, "interactive_auth", {
        type: "menu",
        confidence: 0.85,
        context: text,
        suggestion: "Press enter to select the highlighted option.",
      });
      void build.stdinWrite("\n").catch(() => {});
    }
    return;
  }

  const appleIdPattern = /Apple ID:\s*$|^\s*Apple ID\s*›|enter.*apple\s*id/im;
  if (appleIdPattern.test(text)) {
    const key = `appleid:${text.slice(0, 120)}`;
    if (build.lastInteractivePrompt !== key) {
      build.lastInteractivePrompt = key;
      if (ctx.hasAppleId && build.stdinWrite) {
        void build.stdinWrite("\n").catch(() => {});
      } else {
        emitBuildEvent(build, "interactive_auth", {
          type: "apple_id",
          confidence: 0.95,
          context: text,
          suggestion: "Enter your Apple ID email.",
        });
      }
    }
    return;
  }

  const passwordPattern = /Password(\s*\[.*\])?\s*:\s*$|^\s*Password\s*›|enter.*password/im;
  if (passwordPattern.test(text)) {
    const key = `password:${text.slice(0, 120)}`;
    if (build.lastInteractivePrompt !== key) {
      build.lastInteractivePrompt = key;
      const pendingPassword = ctx.getPendingPassword();
      if (pendingPassword && build.stdinWrite) {
        void build.stdinWrite(`${pendingPassword}\n`).catch(() => {});
        ctx.clearPendingPassword();
      } else {
        emitBuildEvent(build, "interactive_auth", {
          type: "password",
          confidence: 0.95,
          context: text,
          suggestion: "Enter your Apple ID password.",
        });
      }
    }
  }
}

async function readConfiguredEasProjectId(projectPath: string): Promise<string | null> {
  const appJsonPath = path.join(projectPath, "app.json");
  if (!fs.existsSync(appJsonPath)) return null;

  try {
    const raw = await Bun.file(appJsonPath).text();
    const parsed = JSON.parse(raw) as {
      expo?: { extra?: { eas?: { projectId?: unknown } } };
    };
    const projectId = parsed?.expo?.extra?.eas?.projectId;
    return typeof projectId === "string" && projectId.length > 0 ? projectId : null;
  } catch {
    return null;
  }
}

// Generate a simple build ID
function newBuildId(): string {
  return `build-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Build progress detector (simplified version of the Electron handler)
// ---------------------------------------------------------------------------

function detectProgress(
  cleanData: string,
  cleanOutput: string,
  buildUrl: string | undefined
): { step: string; message: string; percent: number; buildUrl?: string; error?: string } | null {
  if (/Submitted your app to Apple App Store Connect|binary has been successfully uploaded|available on TestFlight|Successfully submitted/i.test(cleanOutput)) {
    return { step: "complete", message: "Successfully submitted to TestFlight!", percent: 100, buildUrl };
  }
  if (/Submitting your app to Apple App Store Connect|submission in progress|Submitting\.\.\./i.test(cleanData)) {
    return { step: "submit", message: "Submitting to App Store Connect...", percent: 85 };
  }
  if (/Waiting for submission to complete/i.test(cleanData)) {
    return { step: "submit", message: "Waiting for submission to start...", percent: 75 };
  }
  if (/Build finished/i.test(cleanData)) {
    return { step: "build", message: "Build finished, preparing submission...", percent: 65 };
  }
  if (/Build in progress\.\.\./i.test(cleanData)) {
    return { step: "build", message: "Building on EAS servers...", percent: 50 };
  }
  if (/Waiting in priority queue|Build queued|Waiting for build to complete/i.test(cleanData)) {
    return { step: "build", message: "Build queued, waiting to start...", percent: 35 };
  }
  if (/Uploading to EAS/i.test(cleanData)) {
    return { step: "upload", message: "Uploading to EAS Build...", percent: 25 };
  }
  if (/(Setting up|Fetching|Creating|Generating).*credentials|distribution certificate|provisioning profile/i.test(cleanData)) {
    return { step: "credentials", message: "Setting up credentials...", percent: 15 };
  }
  if (/Initializing|eas-cli init|Linking local|Linked to project/i.test(cleanData)) {
    return { step: "init", message: "Initializing EAS project...", percent: 5 };
  }
  if (/command failed|FAILURE|Error:|error:/i.test(cleanData) && !/https?:\/\//.test(cleanData)) {
    const errMatch = cleanData.match(/(?:Error:|error:)\s*(.+)/i);
    return { step: "error", message: errMatch?.[1]?.trim() ?? "Build failed", percent: 0, error: errMatch?.[1]?.trim() ?? "Build failed" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core build runner
// ---------------------------------------------------------------------------

async function startBuild(
  buildId: string,
  projectPath: string,
  extraEnv?: Record<string, string>
): Promise<void> {
  const build = activeBuilds.get(buildId);
  if (!build) return;

  const ascConfig = await checkASCApiKeyConfig(projectPath);
  const useNonInteractive = ascConfig.configured;
  const hasInteractiveCredentials = Boolean(
    extraEnv?.EXPO_APPLE_ID || extraEnv?.EXPO_APPLE_PASSWORD || extraEnv?.FASTLANE_USER || extraEnv?.FASTLANE_PASSWORD
  );
  const usePty = !useNonInteractive || hasInteractiveCredentials;
  const configuredEasProjectId = await readConfiguredEasProjectId(projectPath);

  const initCommand = configuredEasProjectId
    ? `npx -y eas-cli init --non-interactive --force --id ${configuredEasProjectId}`
    : "npx -y eas-cli init --non-interactive --force";
  const buildCommands = [
    `cd ${projectPath.replace(/'/g, "'\\''")}`,
    "echo \"[BIDE_DEPLOY_FLOW_V4]\"",
    "([ -d .git ] || git init)",
    "git add -A",
    'git commit -m "Configure for deployment" --allow-empty || true',
    initCommand,
    useNonInteractive
      ? "npx -y eas-cli build --platform ios --non-interactive --auto-submit"
      : "npx -y eas-cli build --platform ios --auto-submit",
  ].join(" && ");

  const env = getEnhancedEnv({ EAS_NO_VCS: "1", ...extraEnv });
  let pendingPassword = extraEnv?.EXPO_APPLE_PASSWORD ?? extraEnv?.FASTLANE_PASSWORD ?? "";
  const hasAppleId = Boolean(extraEnv?.EXPO_APPLE_ID || extraEnv?.FASTLANE_USER);
  let buildUrl: string | undefined;
  let accOutput = "";

  const handleChunk = (chunk: string): void => {
    accOutput += chunk;
    build.output += chunk;
    emitBuildEvent(build, "log", { data: chunk });

    const cleanData = cleanAnsi(chunk);
    const cleanOutput = cleanAnsi(accOutput);
    detectAndHandleInteractivePrompt(build, cleanData, {
      hasAppleId,
      getPendingPassword: () => pendingPassword,
      clearPendingPassword: () => {
        pendingPassword = "";
      },
    });

    const urlMatch = cleanData.match(/https:\/\/expo\.dev\/.*\/builds\/[a-zA-Z0-9-]+/i);
    if (urlMatch) buildUrl = urlMatch[0];

    const ascMatch = cleanOutput.match(/ASC App ID:\s*(\d+)/);
    if (ascMatch) {
      extractAndSaveAscAppId(projectPath, cleanOutput).catch(() => {});
    }

    const progress = detectProgress(cleanData, cleanOutput, buildUrl);
    if (progress) {
      build.lastProgress = progress;
      emitBuildEvent(build, "progress", progress);
    }
  };

  const finalize = async (exitCode: number): Promise<void> => {
    build.proc = null;
    build.pty = null;
    build.stdinWrite = null;
    build.done = true;

    const cleanOutput = cleanAnsi(accOutput);
    const isSuccess =
      exitCode === 0 ||
      /available on TestFlight|Successfully submitted/i.test(cleanOutput);

    if (isSuccess) {
      await extractAndSaveAscAppId(projectPath, cleanOutput);
      build.result = { success: true, buildUrl };
      emitBuildEvent(build, "complete", { success: true, buildUrl });
    } else {
      const errMatch = cleanOutput.match(/(?:Error:|error:)\s*(.+)/i);
      const errMsg = errMatch?.[1]?.trim() ?? "Build process failed";
      build.result = { success: false, error: errMsg };
      emitBuildEvent(build, "complete", { success: false, error: errMsg });
    }
  };

  if (usePty) {
    try {
      emitBuildEvent(build, "log", { data: "[BIDE_DEPLOY_MODE] pty\n" });
      const ptyProc = bunPtySpawn("bash", ["-lc", buildCommands], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: projectPath,
        env,
      });
      build.pty = ptyProc;
      build.stdinWrite = async (input: string) => {
        ptyProc.write(input);
      };

      const exitCode = await new Promise<number>((resolve) => {
        ptyProc.onData((data) => {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data);
          handleChunk(text);
        });
        ptyProc.onExit(({ exitCode: code }) => resolve(code));
      });

      await finalize(exitCode);
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      emitBuildEvent(build, "log", {
        data: `[BIDE_DEPLOY_MODE] pty_failed:${reason}\n`,
      });
      console.warn(
        "[Deploy] PTY deploy failed, falling back to Bun.spawn:",
        reason
      );
    }
  }

  emitBuildEvent(build, "log", { data: "[BIDE_DEPLOY_MODE] pipe_fallback\n" });
  const proc = Bun.spawn(["bash", "-c", buildCommands], {
    cwd: projectPath,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  build.proc = proc;

  if (proc.stdin) {
    const stdin = proc.stdin as unknown as {
      getWriter?: () => WritableStreamDefaultWriter<Uint8Array>;
      write?: (data: string | Uint8Array) => Promise<unknown> | unknown;
    };
    if (typeof stdin.getWriter === "function") {
      const writer = stdin.getWriter();
      build.stdinWrite = async (input: string) => {
        const encoded = new TextEncoder().encode(input);
        await writer.write(encoded);
      };
    } else if (typeof stdin.write === "function") {
      build.stdinWrite = async (input: string) => {
        await stdin.write!(input);
      };
    }
  }

  const streamStdout = async () => {
    if (!proc.stdout) return;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      handleChunk(decoder.decode(value));
    }
  };
  const streamStderr = async () => {
    if (!proc.stderr) return;
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      handleChunk(decoder.decode(value));
    }
  };

  await Promise.all([streamStdout(), streamStderr()]);
  await finalize(await proc.exited);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const IOSBuildSchema = z.object({
  projectPath: z.string().min(1),
});

const IOSBuildInteractiveSchema = z.object({
  projectPath: z.string().min(1),
  appleId: z.string().optional(),
  password: z.string().optional(),
});

const SubmitInputSchema = z.object({
  buildId: z.string().min(1),
  input: z.string(),
});

const BuildStatusQuerySchema = z.object({
  offset: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 0;
      const parsed = parseInt(value, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }),
});

const SaveASCKeySchema = z.object({
  projectPath: z.string().min(1),
  keyId: z.string().min(10),
  issuerId: z.string().regex(/[0-9a-f-]{36}/i, "Must be a UUID"),
  keyContent: z.string().min(1), // base64-encoded .p8 content
});

const ClearAppleSessionSchema = z.object({
  appleId: z.string().optional(),
});

const WriteAppleCredsSchema = z.object({
  appleId: z.string().min(1),
  password: z.string().min(1),
  projectPath: z.string().optional(),
});

const DeleteCredsFileSchema = z.object({
  path: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const deployRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/deploy/ios-build
// ---------------------------------------------------------------------------
deployRouter.post("/ios-build", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = IOSBuildSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectPath } = parsed.data;
  const buildId = newBuildId();

  const build: ActiveBuild = {
    buildId,
    projectPath,
    proc: null,
    pty: null,
    listeners: new Set(),
    stdinWrite: null,
    output: "",
    lastProgress: null,
    lastInteractivePrompt: null,
    done: false,
    result: null,
  };

  activeBuilds.set(buildId, build);

  // Fire-and-forget — caller polls /stream/:buildId
  startBuild(buildId, projectPath).catch((err) => {
    console.error(`[Deploy] Build ${buildId} error:`, err);
    build.done = true;
    build.result = { success: false, error: String(err) };
    emitBuildEvent(build, "complete", build.result);
  });

  return c.json({ success: true, buildId });
});

// ---------------------------------------------------------------------------
// POST /api/deploy/ios-build-interactive
// ---------------------------------------------------------------------------
deployRouter.post("/ios-build-interactive", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = IOSBuildInteractiveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectPath, appleId, password } = parsed.data;
  const buildId = newBuildId();

  const build: ActiveBuild = {
    buildId,
    projectPath,
    proc: null,
    pty: null,
    listeners: new Set(),
    stdinWrite: null,
    output: "",
    lastProgress: null,
    lastInteractivePrompt: null,
    done: false,
    result: null,
  };

  activeBuilds.set(buildId, build);

  const extraEnv: Record<string, string> = {};
  if (appleId) {
    extraEnv.EXPO_APPLE_ID = appleId;
    extraEnv.FASTLANE_USER = appleId;
  }
  if (password) {
    extraEnv.EXPO_APPLE_PASSWORD = password;
    extraEnv.FASTLANE_PASSWORD = password;
  }

  startBuild(buildId, projectPath, extraEnv).catch((err) => {
    console.error(`[Deploy] Interactive build ${buildId} error:`, err);
    build.done = true;
    build.result = { success: false, error: String(err) };
    emitBuildEvent(build, "complete", build.result);
  });

  return c.json({ success: true, buildId });
});

// ---------------------------------------------------------------------------
// POST /api/deploy/submit-input
// ---------------------------------------------------------------------------
deployRouter.post("/submit-input", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SubmitInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { buildId, input } = parsed.data;
  const build = activeBuilds.get(buildId);

  if (!build || build.done) {
    return c.json({ success: false, error: "No active build found" }, 404);
  }

  if (build.stdinWrite) {
    await build.stdinWrite(input).catch(() => {});
    return c.json({ success: true });
  }

  return c.json({ success: false, error: "Build has no stdin writer" }, 500);
});

// ---------------------------------------------------------------------------
// GET /api/deploy/status/:buildId?offset=<number>
// ---------------------------------------------------------------------------
deployRouter.get("/status/:buildId", async (c) => {
  const buildId = c.req.param("buildId");
  const build = activeBuilds.get(buildId);

  if (!build) {
    return c.json({ success: false, exists: false, error: "Build not found" }, 404);
  }

  const query = BuildStatusQuerySchema.parse({
    offset: c.req.query("offset"),
  });

  const start = Math.min(query.offset, build.output.length);
  const outputChunk = build.output.slice(start);
  const nextOffset = build.output.length;

  return c.json({
    success: true,
    exists: true,
    buildId,
    done: build.done,
    outputChunk,
    nextOffset,
    lastProgress: build.lastProgress,
    result: build.result,
  });
});

// ---------------------------------------------------------------------------
// GET /api/deploy/stream/:buildId  (SSE)
// ---------------------------------------------------------------------------
deployRouter.get("/stream/current", async (c) => {
  const latestBuildId = getLatestBuildId();
  if (!latestBuildId) {
    return c.json({ error: "No active build found" }, 404);
  }

  // Rewrite into the param route behavior by looking up the latest build.
  const build = activeBuilds.get(latestBuildId);
  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  function write(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(payload)).catch(() => {});
  }

  const listener: BuildEventListener = ({ type, data }) => {
    write(type, data);
    if (type === "complete") {
      writer.close().catch(() => {});
    }
  };

  build.listeners.add(listener);

  // Replay buffered state so late subscribers still get immediate context.
  if (build.output) {
    write("log", { data: build.output.slice(-20_000) });
  }
  if (build.lastProgress) {
    write("progress", build.lastProgress);
  }
  if (build.done && build.result) {
    write("complete", build.result);
    writer.close().catch(() => {});
    build.listeners.delete(listener);
  }

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

deployRouter.get("/stream/:buildId", async (c) => {
  const buildId = c.req.param("buildId");
  const build = activeBuilds.get(buildId);

  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  function write(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(payload)).catch(() => {});
  }

  const listener: BuildEventListener = ({ type, data }) => {
    write(type, data);
    if (type === "complete") {
      writer.close().catch(() => {});
    }
  };

  build.listeners.add(listener);

  // Replay buffered state so late subscribers still get immediate context.
  if (build.output) {
    write("log", { data: build.output.slice(-20_000) });
  }
  if (build.lastProgress) {
    write("progress", build.lastProgress);
  }

  // If already done, immediately emit result and close
  if (build.done && build.result) {
    write("complete", build.result);
    writer.close().catch(() => {});
    build.listeners.delete(listener);
  }

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/deploy/cancel
// ---------------------------------------------------------------------------
deployRouter.post("/cancel", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const buildId = body?.buildId as string | undefined;

  // Cancel all active builds if no buildId specified
  if (!buildId) {
    for (const [id, build] of activeBuilds) {
      if (!build.done && build.proc) {
        build.proc.kill();
      }
      if (!build.done && build.pty) {
        build.pty.kill();
      }
      if (!build.done) {
        build.done = true;
        build.result = { success: false, error: "Cancelled" };
        emitBuildEvent(build, "complete", build.result);
      }
      activeBuilds.delete(id);
    }
    return c.json({ success: true });
  }

  const build = activeBuilds.get(buildId);
  if (build) {
    if (build.proc) build.proc.kill();
    if (build.pty) build.pty.kill();
    build.done = true;
    build.result = { success: false, error: "Cancelled" };
    emitBuildEvent(build, "complete", build.result);
    activeBuilds.delete(buildId);
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /api/deploy/save-asc-api-key
// ---------------------------------------------------------------------------
deployRouter.post("/save-asc-api-key", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SaveASCKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectPath, keyId, issuerId, keyContent } = parsed.data;

  // Decode base64 → UTF-8 PEM
  let decodedKey: string;
  try {
    decodedKey = Buffer.from(keyContent, "base64").toString("utf-8");
  } catch {
    return c.json({ success: false, error: "Invalid API key format. Could not decode." }, 400);
  }

  if (!decodedKey.includes("-----BEGIN PRIVATE KEY-----")) {
    return c.json({ success: false, error: "Invalid .p8 file. Must be a private key in PEM format." }, 400);
  }

  try {
    const keysDir = getASCKeysDir();
    await fsp.mkdir(keysDir, { recursive: true, mode: 0o700 });

    const keyFileName = `AuthKey_${keyId}.p8`;
    const keyFilePath = path.join(keysDir, keyFileName);
    await Bun.write(keyFilePath, decodedKey);
    await fsp.chmod(keyFilePath, 0o600);

    // Update eas.json
    const easJsonPath = path.join(projectPath, "eas.json");
    let easConfig: Record<string, unknown> = {};
    if (fs.existsSync(easJsonPath)) {
      try {
        easConfig = JSON.parse(await Bun.file(easJsonPath).text());
      } catch { /* start fresh */ }
    }

    if (!easConfig.submit) easConfig.submit = {};
    const submit = easConfig.submit as Record<string, unknown>;
    if (!submit.production) submit.production = {};
    const production = submit.production as Record<string, unknown>;
    if (!production.ios) production.ios = {};
    const ios = production.ios as Record<string, unknown>;
    ios.ascApiKeyPath = `~/.bfloat-ide/keys/asc/${keyFileName}`;
    ios.ascApiKeyId = keyId;
    ios.ascApiKeyIssuerId = issuerId;

    await Bun.write(easJsonPath, JSON.stringify(easConfig, null, 2));

    return c.json({
      success: true,
      keyPath: `~/.bfloat-ide/keys/asc/${keyFileName}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/deploy/check-asc-api-key?projectPath=...
// ---------------------------------------------------------------------------
deployRouter.get("/check-asc-api-key", async (c) => {
  const projectPath = c.req.query("projectPath");
  if (!projectPath) {
    return c.json({ error: "projectPath query parameter is required" }, 400);
  }

  const result = await checkASCApiKeyConfig(projectPath);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Apple session management
// Fastlane stores Apple sessions at ~/.app-store/auth/<appleId>/cookie.
// ---------------------------------------------------------------------------

async function listAppleSessionFiles(): Promise<string[]> {
  const sessDir = getAppleSessionsDir();
  try {
    const entries = await fsp.readdir(sessDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function getAppleCookiePath(appleId: string): string {
  return path.join(getAppleSessionsDir(), appleId, "cookie");
}

async function getAppleCookieStat(appleId: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(getAppleCookiePath(appleId));
  } catch {
    return null;
  }
}

function sessionAgeInDaysFromStat(stat: fs.Stats): number {
  const lastModified = stat.mtime.getTime();
  return (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
}

function isSessionValidFromStat(stat: fs.Stats): boolean {
  return sessionAgeInDaysFromStat(stat) < 30;
}

// GET /api/deploy/apple-sessions
deployRouter.get("/apple-sessions", async (c) => {
  const appleIds = await listAppleSessionFiles();
  const sessions = await Promise.all(
    appleIds.map(async (appleId) => {
      const stat = await getAppleCookieStat(appleId);
      if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) return null;
      const ageInDays = Math.floor(sessionAgeInDaysFromStat(stat));
      const valid = isSessionValidFromStat(stat);
      return {
        appleId,
        ageInDays,
        exists: true,
        isValid: valid,
        statusMessage: valid
          ? `Last authenticated ${ageInDays === 0 ? "today" : `${ageInDays} day(s) ago`}`
          : `Session expired (${ageInDays} day(s) old)`,
        lastModified: stat.mtime.toISOString(),
      };
    })
  );

  const filtered = sessions
    .filter(Boolean)
    .sort((a, b) => {
      const aTs = a?.lastModified ? new Date(a.lastModified).getTime() : 0;
      const bTs = b?.lastModified ? new Date(b.lastModified).getTime() : 0;
      return bTs - aTs;
    });

  return c.json({
    sessions: filtered,
    hasValidSession: filtered.some((s) => s?.isValid),
  });
});

// GET /api/deploy/check-apple-session?appleId=...
deployRouter.get("/check-apple-session", async (c) => {
  const appleId = c.req.query("appleId");
  if (!appleId) {
    return c.json({ error: "appleId query parameter is required" }, 400);
  }

  const stat = await getAppleCookieStat(appleId);
  if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) {
    return c.json({ exists: false, appleId, isValid: false });
  }

  const ageInDays = Math.floor(sessionAgeInDaysFromStat(stat));
  const valid = isSessionValidFromStat(stat);
  return c.json({
    exists: true,
    appleId,
    ageInDays,
    isValid: valid,
    statusMessage: valid
      ? `Last authenticated ${ageInDays === 0 ? "today" : `${ageInDays} day(s) ago`}`
      : `Session expired (${ageInDays} day(s) old)`,
    lastModified: stat.mtime.toISOString(),
  });
});

// POST /api/deploy/clear-apple-session
deployRouter.post("/clear-apple-session", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ClearAppleSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.appleId) {
    const sessFile = getAppleCookiePath(parsed.data.appleId);
    try {
      await fsp.unlink(sessFile);
      try {
        await fsp.rmdir(path.dirname(sessFile));
      } catch { /* ignore */ }
      return c.json({ success: true, cleared: 1 });
    } catch {
      return c.json({ success: true, cleared: 0 });
    }
  }

  // Clear all
  const appleIds = await listAppleSessionFiles();
  let cleared = 0;
  for (const appleId of appleIds) {
    try {
      const cookiePath = getAppleCookiePath(appleId);
      await fsp.unlink(cookiePath);
      try {
        await fsp.rmdir(path.dirname(cookiePath));
      } catch { /* ignore */ }
      cleared++;
    } catch { /* ignore */ }
  }
  return c.json({ success: true, cleared });
});

// ---------------------------------------------------------------------------
// POST /api/deploy/write-apple-creds
// ---------------------------------------------------------------------------
deployRouter.post("/write-apple-creds", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = WriteAppleCredsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { appleId, password, projectPath } = parsed.data;

  let credsPath: string;

  if (projectPath) {
    const credsDir = path.join(projectPath, ".bfloat-ide", "creds");
    await fsp.mkdir(credsDir, { recursive: true, mode: 0o700 });
    credsPath = path.join(credsDir, "ios-credentials.sh");
  } else {
    const credsDir = path.join(os.homedir(), ".bfloat-ide", "temp", "creds");
    await fsp.mkdir(credsDir, { recursive: true, mode: 0o700 });
    credsPath = path.join(credsDir, `ios-creds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.sh`);
  }

  const content = `# Temporary iOS deployment credentials\n# This file will be automatically deleted after deployment\nexport EXPO_APPLE_ID="${appleId}"\nexport EXPO_APPLE_PASSWORD="${password}"\nexport FASTLANE_USER="${appleId}"\nexport FASTLANE_PASSWORD="${password}"\n`;

  await Bun.write(credsPath, content);
  await fsp.chmod(credsPath, 0o600);

  return c.json({ success: true, path: credsPath });
});

// ---------------------------------------------------------------------------
// POST /api/deploy/delete-creds-file
// ---------------------------------------------------------------------------
deployRouter.post("/delete-creds-file", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = DeleteCredsFileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  try {
    await fsp.unlink(parsed.data.path);
  } catch { /* already gone — idempotent */ }

  return c.json({ success: true });
});
