/**
 * Project Sync Routes
 *
 * Ports the Electron project-sync-handler IPC handlers to Hono HTTP routes.
 * Manages git-based project synchronization: clone, watch, commit, push, pull.
 *
 * The Electron handler delegated to the ProjectSync class from
 * lib/main/git-ops/project-sync.ts. In the sidecar we re-implement the same
 * semantics using Bun's subprocess API + simple-git (spawned via Bun.spawn).
 *
 * State (running syncs) is kept in a module-level Map so it survives across
 * HTTP requests for the lifetime of the sidecar process.
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Base paths
// ---------------------------------------------------------------------------

const PROJECTS_BASE = path.join(os.homedir(), ".bfloat-ide", "projects");

function getProjectPath(projectId: string): string {
  return path.join(PROJECTS_BASE, projectId);
}

// ---------------------------------------------------------------------------
// FileChange type (mirrors the Electron handler)
// ---------------------------------------------------------------------------

export interface FileChange {
  type: "create" | "update" | "delete";
  path: string; // relative to project root
  content?: string; // base64 for binary, utf-8 text for text
  encoding?: "utf8" | "base64";
}

// ---------------------------------------------------------------------------
// In-process sync registry
// The Electron handler stored ProjectSync instances in a Map. Here we track
// the project paths of "started" syncs so REST endpoints can query status.
// ---------------------------------------------------------------------------

interface SyncEntry {
  projectId: string;
  projectPath: string;
  remoteUrl: string;
  isStarted: boolean;
  watcher: ReturnType<typeof Bun.spawn> | null;
}

const syncRegistry = new Map<string, SyncEntry>();

// ---------------------------------------------------------------------------
// Git helpers (thin wrappers around Bun.spawn)
// ---------------------------------------------------------------------------

async function runGit(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
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

async function ensureProjectsDir(): Promise<void> {
  await fsp.mkdir(PROJECTS_BASE, { recursive: true });
}

async function cloneOrPullProject(projectId: string, remoteUrl: string): Promise<{ ok: boolean; error?: string }> {
  await ensureProjectsDir();
  const projectPath = getProjectPath(projectId);

  // If the directory exists and has a .git folder, just pull
  if (fs.existsSync(path.join(projectPath, ".git"))) {
    const result = await runGit(["pull", "--ff-only"], projectPath);
    if (!result.ok) {
      // Non-fast-forward or conflict — try a hard reset to remote
      await runGit(["fetch", "origin"], projectPath);
      const reset = await runGit(["reset", "--hard", "origin/HEAD"], projectPath);
      if (!reset.ok) {
        return { ok: false, error: reset.stderr };
      }
    }
    return { ok: true };
  }

  // Fresh clone
  await fsp.mkdir(projectPath, { recursive: true });
  const result = await runGit(["clone", remoteUrl, "."], projectPath);
  if (!result.ok) {
    return { ok: false, error: result.stderr };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

async function applyFileChanges(projectPath: string, changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    const absPath = path.join(projectPath, change.path);

    if (change.type === "delete") {
      if (fs.existsSync(absPath)) {
        await fsp.unlink(absPath);
      }
      continue;
    }

    // create or update
    await fsp.mkdir(path.dirname(absPath), { recursive: true });

    if (change.content !== undefined) {
      if (change.encoding === "base64") {
        await Bun.write(absPath, Buffer.from(change.content, "base64"));
      } else {
        await Bun.write(absPath, change.content);
      }
    }
  }
}

async function commitAndPush(projectPath: string, message: string): Promise<{ ok: boolean; error?: string }> {
  // Stage all changes
  const add = await runGit(["add", "-A"], projectPath);
  if (!add.ok) return { ok: false, error: add.stderr };

  // Check if there is anything to commit
  const status = await runGit(["status", "--porcelain"], projectPath);
  if (status.stdout === "") {
    // Nothing to commit
    return { ok: true };
  }

  const commit = await runGit(["commit", "-m", message, "--allow-empty"], projectPath);
  if (!commit.ok) return { ok: false, error: commit.stderr };

  const push = await runGit(["push"], projectPath);
  if (!push.ok) return { ok: false, error: push.stderr };

  return { ok: true };
}

async function hasUncommittedChanges(projectPath: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], projectPath);
  return result.stdout.length > 0;
}

async function getProjectFiles(projectPath: string): Promise<{ path: string; content: string; isBinary: boolean }[]> {
  const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg", ".woff", ".woff2", ".ttf", ".eot"]);
  const IGNORED_DIRS = new Set([".git", "node_modules"]);

  const files: { path: string; content: string; isBinary: boolean }[] = [];

  async function walk(dir: string, rel: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const entryAbs = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryAbs, entryRel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isBinary = BINARY_EXTS.has(ext);
        if (isBinary) {
          files.push({ path: entryRel, content: "", isBinary: true });
        } else {
          try {
            const content = await Bun.file(entryAbs).text();
            files.push({ path: entryRel, content, isBinary: false });
          } catch {
            files.push({ path: entryRel, content: "", isBinary: true });
          }
        }
      }
    }
  }

  await walk(projectPath, "");
  return files;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const StartSchema = z.object({
  projectId: z.string().min(1),
  remoteUrl: z.string().url(),
  appType: z.string().optional(),
});

const ExecuteSchema = z.object({
  projectId: z.string().min(1),
  changes: z.array(
    z.object({
      type: z.enum(["create", "update", "delete"]),
      path: z.string().min(1),
      content: z.string().optional(),
      encoding: z.enum(["utf8", "base64"]).optional(),
    })
  ),
  commitMessage: z.string().optional(),
});

const CommitSchema = z.object({
  projectId: z.string().min(1),
  message: z.string().min(1),
  messageId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const projectSyncRouter = new Hono();

// POST /api/project-sync/start
projectSyncRouter.post("/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectId, remoteUrl, appType } = parsed.data;

  // Check if already started
  const existing = syncRegistry.get(projectId);
  if (existing?.isStarted) {
    return c.json({ success: true, projectPath: existing.projectPath });
  }

  const projectPath = getProjectPath(projectId);

  try {
    const result = await cloneOrPullProject(projectId, remoteUrl);
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, 500);
    }

    syncRegistry.set(projectId, {
      projectId,
      projectPath,
      remoteUrl,
      isStarted: true,
      watcher: null,
    });

    console.log(`[ProjectSync] Sync started for project ${projectId} at ${projectPath}`);
    return c.json({ success: true, projectPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ProjectSync] Failed to start sync for ${projectId}:`, err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// POST /api/project-sync/stop
projectSyncRouter.post("/stop", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const projectId = body?.projectId as string | undefined;

  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const entry = syncRegistry.get(projectId);
  if (entry) {
    entry.isStarted = false;
    if (entry.watcher) {
      try { entry.watcher.kill(); } catch { /* ignore */ }
    }
    syncRegistry.delete(projectId);
    console.log(`[ProjectSync] Sync stopped for project ${projectId}`);
  }

  return c.json({ success: true });
});

// POST /api/project-sync/execute
projectSyncRouter.post("/execute", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ExecuteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectId, changes, commitMessage } = parsed.data;
  const entry = syncRegistry.get(projectId);
  if (!entry?.isStarted) {
    return c.json({ success: false, error: `No sync running for project ${projectId}` }, 404);
  }

  try {
    await applyFileChanges(entry.projectPath, changes as FileChange[]);
    if (commitMessage) {
      const result = await commitAndPush(entry.projectPath, commitMessage);
      if (!result.ok) {
        return c.json({ success: false, error: result.error }, 500);
      }
    }
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// POST /api/project-sync/commit
projectSyncRouter.post("/commit", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CommitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectId, message } = parsed.data;
  const entry = syncRegistry.get(projectId);
  if (!entry?.isStarted) {
    return c.json({ success: false, error: `No sync running for project ${projectId}` }, 404);
  }

  try {
    const result = await commitAndPush(entry.projectPath, message);
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, 500);
    }
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// GET /api/project-sync/files/:projectId
projectSyncRouter.get("/files/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const entry = syncRegistry.get(projectId);
  if (!entry?.isStarted) {
    return c.json({ success: false, error: `No sync running for project ${projectId}` }, 404);
  }

  try {
    const files = await getProjectFiles(entry.projectPath);
    return c.json({ success: true, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// GET /api/project-sync/read-file/:projectId
// Reads a single file relative to the project root.
// ?path=src/App.tsx
projectSyncRouter.get("/read-file/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.query("path");

  if (!filePath) {
    return c.json({ error: "path query parameter is required" }, 400);
  }

  const entry = syncRegistry.get(projectId);
  if (!entry?.isStarted) {
    return c.json({ success: false, error: `No sync running for project ${projectId}` }, 404);
  }

  try {
    const absPath = path.join(entry.projectPath, filePath);
    // Basic path traversal guard
    if (!absPath.startsWith(entry.projectPath + path.sep) && absPath !== entry.projectPath) {
      return c.json({ error: "Forbidden: path traversal detected" }, 403);
    }
    const content = await Bun.file(absPath).text();
    return c.json({ success: true, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// POST /api/project-sync/pull
projectSyncRouter.post("/pull", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const projectId = body?.projectId as string | undefined;

  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const entry = syncRegistry.get(projectId);
  if (!entry?.isStarted) {
    return c.json({ success: false, error: `No sync running for project ${projectId}` }, 404);
  }

  try {
    const result = await runGit(["pull", "--ff-only"], entry.projectPath);
    if (!result.ok) {
      return c.json({ success: false, error: result.stderr }, 500);
    }
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// GET /api/project-sync/status/:projectId
projectSyncRouter.get("/status/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const entry = syncRegistry.get(projectId);

  if (!entry?.isStarted) {
    return c.json({ isRunning: false });
  }

  let uncommitted = false;
  try {
    uncommitted = await hasUncommittedChanges(entry.projectPath);
  } catch { /* ignore */ }

  return c.json({
    isRunning: true,
    projectPath: entry.projectPath,
    hasUncommittedChanges: uncommitted,
  });
});

// GET /api/project-sync/project-path/:projectId
projectSyncRouter.get("/project-path/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const entry = syncRegistry.get(projectId);
  return c.json({ projectPath: entry?.projectPath ?? null });
});
