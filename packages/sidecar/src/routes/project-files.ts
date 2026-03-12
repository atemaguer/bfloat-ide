/**
 * Project Files Routes
 *
 * Provides direct file-system operations scoped to managed project directories
 * under ~/.bfloat-ide/projects/<projectId>/.
 *
 * Operations:
 *   GET  /api/project-files/:projectId/tree            – recursive directory listing
 *   GET  /api/project-files/:projectId/read            – read single file (?path=)
 *   POST /api/project-files/:projectId/write           – write single file
 *   POST /api/project-files/:projectId/delete          – delete a file or directory
 *   POST /api/project-files/:projectId/mkdir           – create directory
 *   POST /api/project-files/:projectId/rename          – rename / move
 *   GET  /api/project-files/:projectId/git-status      – git working tree status
 *   POST /api/project-files/:projectId/git-add         – git add
 *   POST /api/project-files/:projectId/git-commit      – git commit (stages all first)
 *   POST /api/project-files/:projectId/git-push        – git push
 *   POST /api/project-files/:projectId/git-pull        – git pull
 *   POST /api/project-files/:projectId/git-clone       – clone remote into project dir
 *   POST /api/project-files/git-connect/start          – interactive git remote setup
 *   GET  /api/project-files/git-connect/stream/:id     – git setup SSE events
 *   POST /api/project-files/git-connect/input          – submit auth input
 *   POST /api/project-files/git-connect/cancel         – cancel setup session
 *   GET  /api/project-files/:projectId/git-log         – recent git log
 *
 * All paths are resolved relative to the project root and validated to prevent
 * directory traversal outside of it.
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { IPty } from "bun-pty";
import { spawn as bunPtySpawn } from "bun-pty";
import { initializeFromTemplate } from "./template.ts";
import { ensureSkillsInjected } from "../skills-injector.ts";
import { getProjectById } from "./local-projects.ts";
import { syncAgentInstructionFiles } from "../services/agent-instructions.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECTS_BASE = path.join(os.homedir(), ".bfloat-ide", "projects");

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".svg", ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".bz2", ".7z",
  ".pdf", ".mov", ".mp4", ".mp3", ".wav",
]);

const IGNORED_DIRS = new Set([".git", "node_modules", ".expo"]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function projectRoot(projectId: string): string {
  return path.join(PROJECTS_BASE, projectId);
}

/**
 * Resolve a caller-supplied relative path against the project root and verify
 * it stays within it. Throws a typed error on traversal.
 */
function resolveSafe(projectId: string, relPath: string): string {
  const root = projectRoot(projectId);
  const resolved = path.resolve(root, relPath.replace(/^[/\\]+/, ""));
  const normalRoot = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(normalRoot)) {
    const err = new Error(`Path outside project root: ${relPath}`);
    Object.assign(err, { status: 403 });
    throw err;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Git helper
// ---------------------------------------------------------------------------

async function runGit(
  args: string[],
  cwd: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function runGitProbe(
  args: string[],
  cwd: string,
  timeoutMs = 12000
): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      // Diagnostics must never block on interactive prompts.
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      // Prevent SSH from prompting for passwords/passphrases in diagnostics.
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=5",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();

  let timedOut = false;
  const exitCode = await Promise.race<number>([
    proc.exited,
    new Promise<number>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // best effort
        }
        resolve(124);
      }, timeoutMs);
    }),
  ]);

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return {
    ok: !timedOut && exitCode === 0,
    stdout: stdout.trim(),
    stderr: timedOut ? `${stderr.trim()}\nDiagnostics probe timed out.`.trim() : stderr.trim(),
    timedOut,
  };
}

async function getConfiguredRemoteBranch(cwd: string): Promise<string> {
  const configured = await runGit(["config", "--get", "bfloat.remoteBranch"], cwd);
  if (configured.ok && configured.stdout) {
    return configured.stdout.trim();
  }

  const currentBranch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (currentBranch.ok && currentBranch.stdout && currentBranch.stdout !== "HEAD") {
    return currentBranch.stdout.trim();
  }

  return "main";
}

function maskRemoteUrlForLog(remoteUrl: string): string {
  try {
    const parsed = new URL(remoteUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return remoteUrl.replace(/\/\/[^@\s]*@/, "//***@");
  }
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

interface TreeEntry {
  name: string;
  path: string; // relative to project root
  type: "file" | "directory";
  size?: number;
  isBinary?: boolean;
}

async function walkTree(absDir: string, relBase: string, maxDepth: number, depth = 0): Promise<TreeEntry[]> {
  if (depth > maxDepth) return [];
  const results: TreeEntry[] = [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push({ name: entry.name, path: relPath, type: "directory" });
      const children = await walkTree(path.join(absDir, entry.name), relPath, maxDepth, depth + 1);
      results.push(...children);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = BINARY_EXTS.has(ext);
      let size: number | undefined;
      try {
        const stat = await fsp.stat(path.join(absDir, entry.name));
        size = stat.size;
      } catch { /* ignore */ }
      results.push({ name: entry.name, path: relPath, type: "file", size, isBinary });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const WriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});

const DeleteSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional().default(false),
});

const MkdirSchema = z.object({
  path: z.string().min(1),
});

const RenameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const CommitSchema = z.object({
  message: z.string().min(1),
  push: z.boolean().optional().default(false),
});

const CloneSchema = z.object({
  remoteUrl: z.string().url(),
});

const OpenSchema = z.object({
  projectId: z.string().min(1),
  remoteUrl: z.string().optional().default(""),
  appType: z.string().optional().default("web"),
});

const SyncAgentInstructionsSchema = z.object({
  agentInstructions: z.string().optional(),
});

const GitConnectStartSchema = z.object({
  projectId: z.string().min(1),
  remoteUrl: z.string().min(1),
  remoteBranch: z.string().min(1).default("main"),
});

const GitConnectDiagnosticsSchema = z.object({
  projectId: z.string().min(1),
  remoteUrl: z.string().min(1),
});

const GitConnectInputSchema = z.object({
  sessionId: z.string().min(1),
  input: z.string().min(1),
});

const GitConnectCancelSchema = z.object({
  sessionId: z.string().min(1),
});

type GitConnectPromptType =
  | "https_username"
  | "https_password"
  | "ssh_passphrase"
  | "otp"
  | "yes_no"
  | "unknown";

interface GitConnectInteractiveAuthPayload {
  type: GitConnectPromptType;
  confidence: number;
  context: string;
  suggestion?: string;
}

interface GitConnectResult {
  success: boolean;
  projectId: string;
  projectPath: string;
  remoteUrl: string;
  remoteBranch: string;
  error?: string;
}

type GitConnectEventType = "log" | "interactive_auth" | "complete";

interface GitConnectEvent {
  type: GitConnectEventType;
  data: unknown;
}

type GitConnectListener = (event: GitConnectEvent) => void;

interface ActiveGitConnectSession {
  sessionId: string;
  projectId: string;
  projectPath: string;
  remoteUrl: string;
  remoteBranch: string;
  pty: IPty | null;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null;
  stdinWrite: ((input: string) => Promise<void>) | null;
  listeners: Set<GitConnectListener>;
  output: string;
  sshAgentHasIdentities: boolean | null;
  done: boolean;
  result: GitConnectResult | null;
  lastPromptKey: string | null;
}

const gitConnectSessions = new Map<string, ActiveGitConnectSession>();

function newGitConnectSessionId(): string {
  return `git-connect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emitGitConnectEvent(session: ActiveGitConnectSession, type: GitConnectEventType, data: unknown): void {
  const event = { type, data };
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[project-files] git-connect listener error:", err);
    }
  }
}

export function detectGitConnectPrompt(rawChunk: string): GitConnectInteractiveAuthPayload | null {
  const text = rawChunk.trim();
  if (!text) return null;

  if (/enter passphrase for key|passphrase.*private key|ssh key passphrase/i.test(text)) {
    return {
      type: "ssh_passphrase",
      confidence: 0.95,
      context: text,
      suggestion: "Enter your SSH key passphrase.",
    };
  }

  if (/username for ['"]?https?:\/\/|^username:\s*$/im.test(text)) {
    return {
      type: "https_username",
      confidence: 0.95,
      context: text,
      suggestion: "Enter your Git username.",
    };
  }

  if (/password for ['"]?https?:\/\/|^password:\s*$/im.test(text)) {
    return {
      type: "https_password",
      confidence: 0.95,
      context: text,
      suggestion: "Enter your Git password or personal access token.",
    };
  }

  if (/(verification code|one-time|otp|2fa|two[- ]factor|authenticator code)/i.test(text)) {
    return {
      type: "otp",
      confidence: 0.9,
      context: text,
      suggestion: "Enter the verification code.",
    };
  }

  if (/\((Y\/n|y\/N|y\/n|yes\/no)\)|are you sure|continue\?/i.test(text)) {
    return {
      type: "yes_no",
      confidence: 0.8,
      context: text,
      suggestion: "Reply with y or n.",
    };
  }

  if (/:\s*$|\?\s*$/.test(text)) {
    return {
      type: "unknown",
      confidence: 0.6,
      context: text,
      suggestion: "Enter a response and submit.",
    };
  }

  return null;
}

function isSshRemoteUrl(remoteUrl: string): boolean {
  const value = remoteUrl.trim();
  return /^git@/i.test(value) || /^ssh:\/\//i.test(value);
}

async function checkSshAgentHasIdentities(): Promise<boolean | null> {
  try {
    const proc = Bun.spawn(["ssh-add", "-l"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    const output = `${stdout}\n${stderr}`.toLowerCase();
    if (code === 0) return true;
    if (output.includes("the agent has no identities")) return false;

    // Could not determine reliably (no ssh-agent, command missing, etc).
    return null;
  } catch {
    return null;
  }
}

function sshNoIdentityGuidance(): string {
  return [
    "SSH authentication failed: no identities are loaded in ssh-agent.",
    "Run `ssh-add ~/.ssh/<your-key>` (or switch to HTTPS remote URL) and try again.",
  ].join(" ");
}

function sshRepoNotFoundGuidance(): string {
  return [
    "Repository not found or SSH authentication failed.",
    "Verify the SSH URL and repository access, then run `ssh-add ~/.ssh/<your-key>` and try again (or use HTTPS with a token).",
  ].join(" ");
}

interface GitConnectDiagnosticsResult {
  success: boolean;
  remoteUrl: string;
  remoteType: "ssh" | "https" | "other";
  sshAgentHasIdentities: boolean | null;
  remoteReachable: boolean | null;
  probeError?: string;
  suggestedHttpsUrl?: string;
}

function toHttpsRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (scpLikeMatch) {
    const [, host, repoPath] = scpLikeMatch;
    return `https://${host}/${repoPath}`;
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@([^/]+)\/(.+)$/i);
  if (sshUrlMatch) {
    const [, host, repoPath] = sshUrlMatch;
    return `https://${host}/${repoPath}`;
  }

  return null;
}

export function resolveGitConnectFailureReason(params: {
  output: string;
  remoteUrl: string;
  sshAgentHasIdentities: boolean | null;
}): string {
  let reason = classifyGitConnectFailure(params.output);
  const isSshRemote = isSshRemoteUrl(params.remoteUrl);
  if (
    isSshRemote &&
    params.sshAgentHasIdentities === false &&
    (reason === "Git remote validation failed. Check credentials and try again." ||
      reason === "Repository not found. Verify the remote URL and your access permissions.")
  ) {
    reason = sshNoIdentityGuidance();
  } else if (
    isSshRemote &&
    reason === "Repository not found. Verify the remote URL and your access permissions."
  ) {
    // GitHub private repos over SSH can report "repository not found" for auth failures.
    reason = sshRepoNotFoundGuidance();
  }
  return reason;
}

export function classifyGitConnectFailure(output: string): string {
  const text = output.toLowerCase();

  if (text.includes("permission denied (publickey)") || text.includes("no such identity")) {
    return "SSH authentication failed: no usable SSH key was found. Load your key with ssh-add and try again.";
  }

  if (text.includes("host key verification failed")) {
    return "SSH host verification failed. Add the host to known_hosts and try again.";
  }

  if (text.includes("authentication failed") || text.includes("invalid username or password")) {
    return "HTTPS authentication failed. Check your username/password or personal access token.";
  }

  if (text.includes("repository not found")) {
    return "Repository not found. Verify the remote URL and your access permissions.";
  }

  return "Git remote validation failed. Check credentials and try again.";
}

function maybeEmitGitConnectPrompt(session: ActiveGitConnectSession, chunk: string): void {
  const prompt = detectGitConnectPrompt(chunk);
  if (!prompt) return;

  const promptKey = `${prompt.type}:${prompt.context.slice(0, 120)}`;
  if (session.lastPromptKey === promptKey) return;
  session.lastPromptKey = promptKey;
  emitGitConnectEvent(session, "interactive_auth", prompt);
}

function appendGitConnectOutput(session: ActiveGitConnectSession, chunk: string): void {
  if (!chunk) return;
  session.output += chunk;
  emitGitConnectEvent(session, "log", { data: chunk });
  maybeEmitGitConnectPrompt(session, chunk);
}

async function streamReaderToOutput(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

async function finishGitConnectSession(
  session: ActiveGitConnectSession,
  success: boolean,
  error?: string
): Promise<void> {
  if (session.done) return;
  session.done = true;
  session.result = {
    success,
    projectId: session.projectId,
    projectPath: session.projectPath,
    remoteUrl: session.remoteUrl,
    remoteBranch: session.remoteBranch,
    ...(error ? { error } : {}),
  };
  emitGitConnectEvent(session, "complete", session.result);
}

async function runGitConnectSession(session: ActiveGitConnectSession): Promise<void> {
  const buildCommands = [
    "set -e",
    'if [ ! -d .git ]; then git init; fi',
    'if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin \"$GIT_REMOTE_URL\"; else git remote add origin \"$GIT_REMOTE_URL\"; fi',
    'git config bfloat.remoteBranch \"$GIT_REMOTE_BRANCH\"',
    "git ls-remote origin HEAD",
  ].join(" && ");

  const env = {
    ...process.env,
    GIT_REMOTE_URL: session.remoteUrl,
    GIT_REMOTE_BRANCH: session.remoteBranch,
  };
  let exitCode = 1;

  try {
    await fsp.mkdir(session.projectPath, { recursive: true });

    const isSshRemote = isSshRemoteUrl(session.remoteUrl);

    if (isSshRemote) {
      const hasIdentities = await checkSshAgentHasIdentities();
      session.sshAgentHasIdentities = hasIdentities;
      if (hasIdentities === false) {
        appendGitConnectOutput(
          session,
          "[git-connect] ssh-agent has no loaded identities; SSH auth may fail unless key files are otherwise configured.\n"
        );
      }
    }

    try {
      const ptyProc = bunPtySpawn("bash", ["-lc", buildCommands], {
        cwd: session.projectPath,
        env,
      });
      session.pty = ptyProc;
      session.proc = null;
      session.stdinWrite = async (input: string) => {
        ptyProc.write(input);
      };

      await new Promise<void>((resolve) => {
        ptyProc.onData((data) => {
          appendGitConnectOutput(session, typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
        });
        ptyProc.onExit(({ exitCode: code }) => {
          exitCode = code;
          resolve();
        });
      });
    } catch (ptyErr) {
      appendGitConnectOutput(session, `[git-connect] PTY unavailable, using subprocess fallback: ${String(ptyErr)}\n`);
      session.pty = null;
      const proc = Bun.spawn(["bash", "-lc", buildCommands], {
        cwd: session.projectPath,
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      session.proc = proc;
      session.stdinWrite = async (input: string) => {
        if (!proc.stdin) throw new Error("git-connect stdin unavailable");
        await proc.stdin.write(new TextEncoder().encode(input));
      };

      await Promise.all([
        streamReaderToOutput(proc.stdout, (chunk) => appendGitConnectOutput(session, chunk)),
        streamReaderToOutput(proc.stderr, (chunk) => appendGitConnectOutput(session, chunk)),
      ]);
      exitCode = await proc.exited;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishGitConnectSession(session, false, msg);
    return;
  } finally {
    session.stdinWrite = null;
  }

  if (exitCode === 0) {
    await finishGitConnectSession(session, true);
  } else {
    const reason = resolveGitConnectFailureReason({
      output: session.output,
      remoteUrl: session.remoteUrl,
      sshAgentHasIdentities: session.sshAgentHasIdentities,
    });
    await finishGitConnectSession(session, false, reason);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const projectFilesRouter = new Hono();

// ---------------------------------------------------------------------------
// Git connect interactive session routes
// ---------------------------------------------------------------------------

projectFilesRouter.post("/git-connect/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = GitConnectStartSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectId, remoteUrl, remoteBranch } = parsed.data;
  const sessionId = newGitConnectSessionId();
  const session: ActiveGitConnectSession = {
    sessionId,
    projectId,
    projectPath: projectRoot(projectId),
    remoteUrl: remoteUrl.trim(),
    remoteBranch: remoteBranch.trim() || "main",
    pty: null,
    proc: null,
    stdinWrite: null,
    listeners: new Set(),
    output: "",
    sshAgentHasIdentities: null,
    done: false,
    result: null,
    lastPromptKey: null,
  };

  gitConnectSessions.set(sessionId, session);

  runGitConnectSession(session)
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[project-files] git-connect[${sessionId}] unexpected error:`, msg);
      await finishGitConnectSession(session, false, msg);
    })
    .finally(() => {
      setTimeout(() => {
        gitConnectSessions.delete(sessionId);
      }, 5 * 60 * 1000);
    });

  return c.json({ success: true, sessionId, remoteBranch: session.remoteBranch });
});

projectFilesRouter.post("/git-connect/diagnostics", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = GitConnectDiagnosticsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectId, remoteUrl } = parsed.data;
  const root = projectRoot(projectId);
  const isSsh = isSshRemoteUrl(remoteUrl);
  const isHttps = /^https:\/\//i.test(remoteUrl.trim());

  const result: GitConnectDiagnosticsResult = {
    success: true,
    remoteUrl: remoteUrl.trim(),
    remoteType: isSsh ? "ssh" : isHttps ? "https" : "other",
    sshAgentHasIdentities: null,
    remoteReachable: null,
    suggestedHttpsUrl: isSsh ? toHttpsRemoteUrl(remoteUrl) ?? undefined : undefined,
  };

  try {
    await fsp.mkdir(root, { recursive: true });
  } catch {
    // best effort; ls-remote does not require a repo working tree
  }

  if (isSsh) {
    result.sshAgentHasIdentities = await checkSshAgentHasIdentities();
  }

  try {
    const probe = await runGitProbe(["ls-remote", remoteUrl.trim(), "HEAD"], root);
    result.remoteReachable = probe.ok;
    if (!probe.ok) {
      if (probe.timedOut) {
        result.probeError = "Diagnostics timed out while contacting remote. Check network/connectivity and try again.";
      } else {
        result.probeError = resolveGitConnectFailureReason({
          output: [probe.stderr, probe.stdout].filter(Boolean).join("\n"),
          remoteUrl: remoteUrl.trim(),
          sshAgentHasIdentities: result.sshAgentHasIdentities,
        });
      }
    }
  } catch (err) {
    result.remoteReachable = false;
    result.probeError = err instanceof Error ? err.message : String(err);
  }

  return c.json(result);
});

projectFilesRouter.post("/git-connect/input", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = GitConnectInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const session = gitConnectSessions.get(parsed.data.sessionId);
  if (!session || session.done) {
    return c.json({ success: false, error: "No active git connect session found" }, 404);
  }

  if (!session.stdinWrite) {
    return c.json({ success: false, error: "Session is not accepting input" }, 409);
  }

  await session.stdinWrite(parsed.data.input).catch(() => {});
  return c.json({ success: true });
});

projectFilesRouter.post("/git-connect/cancel", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = GitConnectCancelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const session = gitConnectSessions.get(parsed.data.sessionId);
  if (!session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  try {
    if (session.pty) session.pty.kill();
    if (session.proc) session.proc.kill();
  } catch {
    // best effort
  }

  await finishGitConnectSession(session, false, "Cancelled by user");
  return c.json({ success: true });
});

projectFilesRouter.get("/git-connect/stream/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = gitConnectSessions.get(sessionId);
  if (!session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  function write(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(payload)).catch(() => {});
  }

  const listener: GitConnectListener = ({ type, data }) => {
    write(type, data);
    if (type === "complete") {
      writer.close().catch(() => {});
    }
  };

  session.listeners.add(listener);

  if (session.output) {
    write("log", { data: session.output.slice(-20_000) });
  }
  if (session.done && session.result) {
    write("complete", session.result);
    writer.close().catch(() => {});
    session.listeners.delete(listener);
  }

  const onAbort = () => {
    session.listeners.delete(listener);
    writer.close().catch(() => {});
  };
  c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

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
// POST /open – Open (or create) a project
//
// Replicates the Electron ProjectService.open() flow:
//   1. Create project directory if missing
//   2. If project already exists on disk → use as-is
//   3. Else if remoteUrl → git clone
//   4. Else → initialize from template
//   5. Scan file tree
//   6. Return ProjectState
// ---------------------------------------------------------------------------
projectFilesRouter.post("/open", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = OpenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectId, remoteUrl, appType } = parsed.data;
  const root = projectRoot(projectId);

  console.log(`[project-files] ========== OPEN PROJECT ==========`);
  console.log(`[project-files] projectId: ${projectId}`);
  console.log(`[project-files] remoteUrl: "${remoteUrl}"`);
  console.log(`[project-files] appType: ${appType}`);

  try {
    // Ensure base projects directory exists
    await fsp.mkdir(PROJECTS_BASE, { recursive: true });

    const projectExists = fs.existsSync(root);
    console.log(`[project-files] Project path: ${root}`);
    console.log(`[project-files] Project exists on disk: ${projectExists}`);

    if (projectExists) {
      // Project directory exists — use existing files, no git operations
      console.log(`[project-files] USING EXISTING FILES`);
    } else if (remoteUrl && remoteUrl.trim() !== "") {
      // Clone from remote
      console.log(`[project-files] Cloning from: ${remoteUrl}`);
      await fsp.mkdir(root, { recursive: true });

      // Add auth token if available
      const GIT_ACCESS_TOKEN = process.env.GIT_ACCESS_TOKEN || "";
      let authenticatedUrl = remoteUrl;
      if (GIT_ACCESS_TOKEN) {
        try {
          const urlObj = new URL(remoteUrl);
          if (urlObj.protocol === "https:") {
            authenticatedUrl = `${urlObj.protocol}//${GIT_ACCESS_TOKEN}@${urlObj.host}${urlObj.pathname}`;
          }
        } catch { /* URL parsing failed, use as-is */ }
      }

      const cloneResult = await runGit(["clone", authenticatedUrl, "."], root);
      if (!cloneResult.ok) {
        console.error(`[project-files] Clone failed:`, cloneResult.stderr);
        return c.json({
          projectId,
          projectPath: root,
          status: "error" as const,
          error: `Git clone failed: ${cloneResult.stderr}`,
          fileTree: [],
        });
      }

      // Update remote with authenticated URL for future operations
      if (authenticatedUrl !== remoteUrl) {
        await runGit(["remote", "set-url", "origin", authenticatedUrl], root);
      }
      console.log(`[project-files] Clone complete`);
    } else {
      // No remote URL — initialize from template
      console.log(`[project-files] No remote URL — initializing from template (${appType})`);
      await fsp.mkdir(root, { recursive: true });

      const templateResult = await initializeFromTemplate(root, appType);
      if (!templateResult.success) {
        const templateError = templateResult.error || `Failed to initialize template for app type '${appType}'`;
        console.error(`[project-files] Template init failed: ${templateError}`);
        return c.json({
          projectId,
          projectPath: root,
          status: "error" as const,
          error: templateError,
          fileTree: [],
        });
      }
    }

    // Inject skills (Claude Code settings, skill SKILL.md files)
    await ensureSkillsInjected(root);

    // Ensure managed instruction files are present for all projects.
    try {
      const projectMeta = await getProjectById(projectId);
      await syncAgentInstructionFiles(root, projectMeta?.agentInstructions as string | undefined);
    } catch (err) {
      console.warn("[project-files] Failed to sync AGENTS.md / CLAUDE.md:", err);
    }

    // Scan file tree
    console.log(`[project-files] Scanning file tree...`);
    const fileTree = await walkTree(root, "", 10);
    console.log(`[project-files] Found ${fileTree.length} entries`);

    return c.json({
      projectId,
      projectPath: root,
      status: "ready" as const,
      fileTree: fileTree.map((entry) => ({
        path: entry.path,
        type: entry.type,
        size: entry.size,
      })),
    });
  } catch (err) {
    console.error(`[project-files] Failed to open project:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({
      projectId,
      projectPath: root,
      status: "error" as const,
      error: msg,
      fileTree: [],
    });
  }
});

// ---------------------------------------------------------------------------
// POST /:projectId/sync-agent-instructions
// ---------------------------------------------------------------------------
projectFilesRouter.post("/:projectId/sync-agent-instructions", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = SyncAgentInstructionsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const root = projectRoot(projectId);
  if (!fs.existsSync(root)) {
    return c.json({ success: false, error: "Project not found", projectId }, 404);
  }

  try {
    const filesWritten = await syncAgentInstructionFiles(root, parsed.data.agentInstructions);
    return c.json({ success: true, filesWritten });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /close – Close a project (cleanup, no-op for stateless sidecar)
// ---------------------------------------------------------------------------
projectFilesRouter.post("/close", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const projectId = body?.projectId;
  console.log(`[project-files] Close project: ${projectId}`);
  // The sidecar is stateless per-request; nothing to tear down.
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /tree/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.get("/tree/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const maxDepth = parseInt(c.req.query("depth") ?? "10", 10);
  const root = projectRoot(projectId);

  if (!fs.existsSync(root)) {
    return c.json({ error: "Project not found", projectId }, 404);
  }

  try {
    const tree = await walkTree(root, "", Math.min(maxDepth, 20));
    return c.json({ success: true, tree });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /read/:projectId  ?path=src/App.tsx
// ---------------------------------------------------------------------------
projectFilesRouter.get("/read/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const relPath = c.req.query("path");

  if (!relPath) {
    return c.json({ error: "path query parameter is required" }, 400);
  }

  let absPath: string;
  try {
    absPath = resolveSafe(projectId, relPath);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    return c.json({ error: e.message }, e.status ?? 400);
  }

  if (!fs.existsSync(absPath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    const buf = await Bun.file(absPath).arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return c.json({ success: true, content: base64, encoding: "base64", isBinary: true });
  }

  try {
    const content = await Bun.file(absPath).text();
    return c.json({ success: true, content, encoding: "utf8", isBinary: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /write/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/write/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = WriteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  let absPath: string;
  try {
    absPath = resolveSafe(projectId, parsed.data.path);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    return c.json({ error: e.message }, e.status ?? 400);
  }

  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });

    if (parsed.data.encoding === "base64") {
      await Bun.write(absPath, Buffer.from(parsed.data.content, "base64"));
    } else {
      await Bun.write(absPath, parsed.data.content);
    }

    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /delete/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/delete/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  let absPath: string;
  try {
    absPath = resolveSafe(projectId, parsed.data.path);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    return c.json({ error: e.message }, e.status ?? 400);
  }

  if (!fs.existsSync(absPath)) {
    return c.json({ success: true }); // idempotent
  }

  try {
    const stat = await fsp.stat(absPath);
    if (stat.isDirectory()) {
      await fsp.rm(absPath, { recursive: parsed.data.recursive, force: true });
    } else {
      await fsp.unlink(absPath);
    }
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /mkdir/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/mkdir/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = MkdirSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  let absPath: string;
  try {
    absPath = resolveSafe(projectId, parsed.data.path);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    return c.json({ error: e.message }, e.status ?? 400);
  }

  try {
    await fsp.mkdir(absPath, { recursive: true });
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rename/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/rename/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = RenameSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  let fromAbs: string;
  let toAbs: string;
  try {
    fromAbs = resolveSafe(projectId, parsed.data.from);
    toAbs = resolveSafe(projectId, parsed.data.to);
  } catch (err: unknown) {
    const e = err as { status?: number; message: string };
    return c.json({ error: e.message }, e.status ?? 400);
  }

  if (!fs.existsSync(fromAbs)) {
    return c.json({ error: "Source path not found" }, 404);
  }

  try {
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.rename(fromAbs, toAbs);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /git-status/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.get("/git-status/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);

  if (!fs.existsSync(root)) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ isGitRepo: false, files: [] });
  }

  try {
    const result = await runGit(["status", "--porcelain"], root);
    const files = result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    console.log("[project-files] git-status", {
      projectId,
      ok: result.ok,
      changedFiles: files.length,
    });
    return c.json({ isGitRepo: true, files, clean: files.length === 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[project-files] git-status error", { projectId, error: msg });
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /git-sync-status/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.get("/git-sync-status/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);

  if (!fs.existsSync(root)) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ isGitRepo: false });
  }

  try {
    const branch = await getConfiguredRemoteBranch(root);
    const localHeadResult = await runGit(["rev-parse", "HEAD"], root);
    const localHasCommits = localHeadResult.ok && Boolean(localHeadResult.stdout);

    // Refresh remote tracking ref for accurate ahead/behind counts.
    const fetchResult = await runGit(["fetch", "origin", branch], root);
    const missingRemoteRef = /couldn't find remote ref/i.test(fetchResult.stderr || "");
    if (!fetchResult.ok && !missingRemoteRef) {
      return c.json({ success: false, error: fetchResult.stderr || "Failed to fetch remote branch" }, 500);
    }

    const remoteHeadResult = missingRemoteRef
      ? { ok: false, stdout: "", stderr: fetchResult.stderr }
      : await runGit(["rev-parse", `origin/${branch}`], root);
    const remoteHasCommits = remoteHeadResult.ok && Boolean(remoteHeadResult.stdout);

    if (!localHasCommits && !remoteHasCommits) {
      return c.json({
        isGitRepo: true,
        branch,
        localHead: null,
        remoteHead: null,
        ahead: 0,
        behind: 0,
        diverged: false,
        inSync: true,
        remoteMissing: true,
      });
    }

    if (localHasCommits && !remoteHasCommits) {
      const localCount = await runGit(["rev-list", "--count", "HEAD"], root);
      const ahead = localCount.ok ? Number.parseInt(localCount.stdout || "0", 10) : 0;
      return c.json({
        isGitRepo: true,
        branch,
        localHead: localHeadResult.stdout.trim(),
        remoteHead: null,
        ahead,
        behind: 0,
        diverged: false,
        inSync: false,
        remoteMissing: true,
      });
    }

    if (!localHasCommits && remoteHasCommits) {
      const remoteCount = await runGit(["rev-list", "--count", `origin/${branch}`], root);
      const behind = remoteCount.ok ? Number.parseInt(remoteCount.stdout || "0", 10) : 0;
      return c.json({
        isGitRepo: true,
        branch,
        localHead: null,
        remoteHead: remoteHeadResult.stdout.trim(),
        ahead: 0,
        behind,
        diverged: false,
        inSync: behind === 0,
        remoteMissing: false,
      });
    }

    const countsResult = await runGit(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], root);
    if (!countsResult.ok || !countsResult.stdout) {
      return c.json({ success: false, error: countsResult.stderr || "Failed to compute sync status" }, 500);
    }

    const [aheadRaw, behindRaw] = countsResult.stdout.trim().split(/\s+/);
    const ahead = Number.parseInt(aheadRaw ?? "0", 10);
    const behind = Number.parseInt(behindRaw ?? "0", 10);
    const diverged = ahead > 0 && behind > 0;
    const inSync = ahead === 0 && behind === 0;

    return c.json({
      isGitRepo: true,
      branch,
      localHead: localHeadResult.stdout.trim(),
      remoteHead: remoteHeadResult.stdout.trim(),
      ahead,
      behind,
      diverged,
      inSync,
      remoteMissing: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /git-add/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/git-add/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ success: false, error: "No git repository in project" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const filePaths: string[] = Array.isArray(body?.paths) ? body.paths : ["-A"];

  try {
    const result = await runGit(["add", ...filePaths], root);
    if (!result.ok) {
      return c.json({ success: false, error: result.stderr }, 500);
    }
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /git-commit/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/git-commit/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ success: false, error: "No git repository in project" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = CommitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  try {
    console.log("[project-files] git-commit start", {
      projectId,
      push: parsed.data.push,
      message: parsed.data.message,
    });
    // Stage everything
    const addResult = await runGit(["add", "-A"], root);
    if (!addResult.ok) {
      console.warn("[project-files] git-commit add failed", { projectId, error: addResult.stderr });
      return c.json({ success: false, error: addResult.stderr }, 500);
    }

    // Commit
    const commitResult = await runGit(
      ["commit", "-m", parsed.data.message, "--allow-empty"],
      root
    );
    if (!commitResult.ok) {
      console.warn("[project-files] git-commit commit failed", { projectId, error: commitResult.stderr });
      return c.json({ success: false, error: commitResult.stderr }, 500);
    }

    // Optionally push
    if (parsed.data.push) {
      const remoteBranch = await getConfiguredRemoteBranch(root);
      console.log("[project-files] git-commit pushing", { projectId, remoteBranch });
      const pushResult = await runGit(["push", "-u", "origin", `HEAD:${remoteBranch}`], root);
      if (!pushResult.ok) {
        console.warn("[project-files] git-commit push failed", { projectId, remoteBranch, error: pushResult.stderr });
        return c.json({ success: false, error: pushResult.stderr }, 500);
      }
    }

    console.log("[project-files] git-commit complete", { projectId });
    return c.json({ success: true, sha: commitResult.stdout });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[project-files] git-commit error", { projectId, error: msg });
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /git-push/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/git-push/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ success: false, error: "No git repository in project" }, 400);
  }

  try {
    const remoteBranch = await getConfiguredRemoteBranch(root);
    console.log("[project-files] git-push start", { projectId, remoteBranch });
    const result = await runGit(["push", "-u", "origin", `HEAD:${remoteBranch}`], root);
    if (!result.ok) {
      console.warn("[project-files] git-push failed", { projectId, remoteBranch, error: result.stderr });
      return c.json({ success: false, error: result.stderr }, 500);
    }
    console.log("[project-files] git-push complete", { projectId, remoteBranch });
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[project-files] git-push error", { projectId, error: msg });
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /git-clone/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/git-pull/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ success: false, error: "No git repository in project" }, 400);
  }

  try {
    const remoteBranch = await getConfiguredRemoteBranch(root);
    const result = await runGit(["pull", "origin", remoteBranch], root);
    if (!result.ok) {
      return c.json({ success: false, error: result.stderr }, 500);
    }
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /git-clone/:projectId
// ---------------------------------------------------------------------------
projectFilesRouter.post("/git-clone/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = CloneSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const root = projectRoot(projectId);

  try {
    await fsp.mkdir(root, { recursive: true });

    // If already a git repo, skip clone
    if (fs.existsSync(path.join(root, ".git"))) {
      return c.json({ success: true, projectPath: root, alreadyCloned: true });
    }

    const result = await runGit(["clone", parsed.data.remoteUrl, "."], root);
    if (!result.ok) {
      return c.json({ success: false, error: result.stderr }, 500);
    }

    return c.json({ success: true, projectPath: root });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /git-log/:projectId  ?limit=20
// ---------------------------------------------------------------------------
projectFilesRouter.get("/git-log/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const root = projectRoot(projectId);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);

  if (!fs.existsSync(path.join(root, ".git"))) {
    return c.json({ isGitRepo: false, commits: [] });
  }

  try {
    const format = "--format=%H%x1F%an%x1F%ae%x1F%ai%x1F%s";
    const result = await runGit(["log", `--max-count=${limit}`, format], root);
    if (!result.ok) {
      return c.json({ success: false, error: result.stderr }, 500);
    }

    const commits = result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, author, email, date, subject] = line.split("\x1F");
        return { sha, author, email, date, subject };
      });

    return c.json({ isGitRepo: true, commits });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});
