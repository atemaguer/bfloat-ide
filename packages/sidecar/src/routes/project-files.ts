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
 *   POST /api/project-files/:projectId/git-clone       – clone remote into project dir
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
import { initializeFromTemplate } from "./template.ts";
import { ensureSkillsInjected } from "../skills-injector.ts";

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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const projectFilesRouter = new Hono();

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
        // Template not found is OK for new projects — agent can still work in empty dir
        console.warn(`[project-files] Template init failed: ${templateResult.error}, continuing with empty project`);
      }
    }

    // Inject skills (Claude Code settings, skill SKILL.md files)
    await ensureSkillsInjected(root);

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
    return c.json({ isGitRepo: true, files, clean: files.length === 0 });
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
    // Stage everything
    const addResult = await runGit(["add", "-A"], root);
    if (!addResult.ok) {
      return c.json({ success: false, error: addResult.stderr }, 500);
    }

    // Commit
    const commitResult = await runGit(
      ["commit", "-m", parsed.data.message, "--allow-empty"],
      root
    );
    if (!commitResult.ok) {
      return c.json({ success: false, error: commitResult.stderr }, 500);
    }

    // Optionally push
    if (parsed.data.push) {
      const pushResult = await runGit(["push"], root);
      if (!pushResult.ok) {
        return c.json({ success: false, error: pushResult.stderr }, 500);
      }
    }

    return c.json({ success: true, sha: commitResult.stdout });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
    const result = await runGit(["push"], root);
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
