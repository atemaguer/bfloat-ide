import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Allowed-roots security model
//
// All incoming paths are resolved to absolute paths and then checked against
// a set of allowed roots before any filesystem operation is performed. This
// prevents directory traversal attacks (e.g. "../../../../etc/passwd").
//
// The default roots are:
//   1. The user's home directory   (~/)
//   2. The bfloat-ide working dir  (~/.bfloat-ide)
//   3. /tmp  (for temporary files)
//
// Additional roots can be registered at runtime via POST /api/fs/roots.
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ROOTS: string[] = [
  os.homedir(),
  path.join(os.homedir(), ".bfloat-ide"),
  os.tmpdir(),
];

// Mutable at runtime so Tauri can register project directories as they are
// opened. Uses a Set to deduplicate identical roots.
const allowedRoots = new Set<string>(DEFAULT_ALLOWED_ROOTS);

/**
 * Resolve `inputPath` to an absolute path and verify that it sits inside one
 * of the registered allowed roots. Throws a structured error if the path is
 * outside all roots.
 */
function resolveSafePath(inputPath: string): string {
  // path.resolve handles relative paths by joining with cwd, but we want
  // absolute paths only — callers should always send absolute paths.
  const resolved = path.resolve(inputPath);

  const isAllowed = [...allowedRoots].some((root) => {
    // Normalise root so it always has a trailing separator, which prevents
    // "/home/user-evil" from matching root "/home/user".
    const normalised = root.endsWith(path.sep) ? root : root + path.sep;
    return resolved === root || resolved.startsWith(normalised);
  });

  if (!isAllowed) {
    throw Object.assign(
      new Error(`Path is outside allowed roots: ${resolved}`),
      { code: "FORBIDDEN", status: 403 }
    );
  }

  return resolved;
}

/** Resolve both src and dest, returning them as a tuple. */
function resolveSafePaths(src: string, dest: string): [string, string] {
  return [resolveSafePath(src), resolveSafePath(dest)];
}

// ---------------------------------------------------------------------------
// Filesystem entry metadata helper
// ---------------------------------------------------------------------------

type EntryType = "file" | "directory" | "symlink" | "other";

function statToType(stat: fs.Stats): EntryType {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

interface EntryMeta {
  name: string;
  path: string;
  type: EntryType;
  size: number;
  modifiedAt: string;
  createdAt: string;
  isDir: boolean;
}

async function statEntry(entryPath: string): Promise<EntryMeta> {
  // Use lstat so we see symlinks as symlinks, not as their targets.
  const stat = await fsp.lstat(entryPath);
  return {
    name: path.basename(entryPath),
    path: entryPath,
    type: statToType(stat),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
    isDir: stat.isDirectory(),
  };
}

// ---------------------------------------------------------------------------
// Recursive directory copy helper (fs/promises has no built-in cp in older
// Bun runtimes, so we roll our own safe version).
// ---------------------------------------------------------------------------

async function copyRecursive(src: string, dest: string, overwrite: boolean): Promise<void> {
  const stat = await fsp.lstat(src);

  if (stat.isSymbolicLink()) {
    const target = await fsp.readlink(src);
    // Remove existing symlink if overwrite is requested.
    if (overwrite) {
      await fsp.rm(dest, { force: true });
    }
    await fsp.symlink(target, dest);
    return;
  }

  if (stat.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(
        path.join(src, entry.name),
        path.join(dest, entry.name),
        overwrite
      );
    }
    return;
  }

  // Regular file — use Bun.write + Bun.file for an efficient zero-copy path.
  if (!overwrite) {
    // Check that destination does not already exist.
    const exists = await fsp.access(dest).then(() => true).catch(() => false);
    if (exists) {
      throw Object.assign(
        new Error(`Destination already exists: ${dest}`),
        { code: "EEXIST", status: 409 }
      );
    }
  }

  await Bun.write(dest, Bun.file(src));
}

// ---------------------------------------------------------------------------
// File watcher registry
//
// Each watch session is keyed by a UUID. Clients subscribe via
// POST /api/fs/watch (returns { watchId }) then open
// GET  /api/fs/watch/:id as a Server-Sent Events stream.
//
// When the SSE response is closed (client disconnects) the watcher is
// automatically cleaned up.
// ---------------------------------------------------------------------------

interface WatchSession {
  paths: string[];
  watcher: ReturnType<typeof fs.watch> | null;
  // Queue of events accumulated before a client connects (small buffer).
  queue: WatchEvent[];
  // SSE controller — set once the client connects via GET /watch/:id.
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  createdAt: number;
}

interface WatchEvent {
  type: "change" | "rename" | "add" | "unlink" | "error";
  path: string;
  timestamp: string;
}

const watchSessions = new Map<string, WatchSession>();

// Prune stale sessions (created more than 30 s ago with no client).
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of watchSessions.entries()) {
    if (!session.controller && now - session.createdAt > 30_000) {
      session.watcher?.close();
      watchSessions.delete(id);
    }
  }
}, 10_000).unref();

function encodeSSE(event: WatchEvent): Uint8Array {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  return new TextEncoder().encode(data);
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ReadFileSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(["utf-8", "base64", "binary"]).optional().default("utf-8"),
});

const WriteFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf-8", "base64"]).optional().default("utf-8"),
  createDirs: z.boolean().optional().default(false),
});

const ExistsSchema = z.object({
  path: z.string().min(1),
});

const MkdirSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional().default(true),
});

const ReaddirSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional().default(false),
});

const DeleteSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional().default(false),
});

const MoveSchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
  overwrite: z.boolean().optional().default(false),
});

const CopySchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
  overwrite: z.boolean().optional().default(false),
});

const StatSchema = z.object({
  path: z.string().min(1),
});

const WatchSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  recursive: z.boolean().optional().default(false),
});

const AddRootSchema = z.object({
  root: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleError(_c: unknown, err: unknown) {
  const e = err as { code?: string; status?: number; message?: string };
  if (e.code === "FORBIDDEN" || e.status === 403) {
    return { status: 403, body: { error: "Forbidden", message: e.message } };
  }
  if (e.code === "ENOENT") {
    return { status: 404, body: { error: "Not Found", message: e.message } };
  }
  if (e.code === "EEXIST" || e.status === 409) {
    return { status: 409, body: { error: "Conflict", message: e.message } };
  }
  if (e.code === "EACCES" || e.code === "EPERM") {
    return { status: 403, body: { error: "Forbidden", message: e.message } };
  }
  return {
    status: 500,
    body: { error: "Internal Server Error", message: String(e.message ?? err) },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const filesystemRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/fs/read?path=<absolute-path>&encoding=utf-8|base64|binary
//
// Read the contents of a file.
// Returns: { content: string, encoding: string, size: number, path: string }
// ---------------------------------------------------------------------------

filesystemRouter.get("/read", async (c) => {
  const parseResult = ReadFileSchema.safeParse({
    path: c.req.query("path"),
    encoding: c.req.query("encoding"),
  });

  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { encoding } = parseResult.data;

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 403);
  }

  try {
    const file = Bun.file(resolvedPath);
    const size = file.size;

    // Validate the file exists (Bun.file() is lazy — it doesn't throw on
    // missing files until you attempt to read it, but size is 0 for missing
    // files AND truly empty files, so we stat to distinguish).
    const stat = await fsp.stat(resolvedPath);
    if (stat.isDirectory()) {
      return c.json(
        { error: "Bad Request", message: "Path is a directory, not a file." },
        400
      );
    }

    let content: string;

    if (encoding === "base64") {
      const buffer = await file.arrayBuffer();
      content = Buffer.from(buffer).toString("base64");
    } else if (encoding === "binary") {
      // Return raw bytes as a base64 string (callee requested binary; they
      // can decode on their end). Same transport as base64 but signalled
      // differently so the consumer knows the intent.
      const buffer = await file.arrayBuffer();
      content = Buffer.from(buffer).toString("base64");
    } else {
      content = await file.text();
    }

    return c.json({
      content,
      encoding,
      size,
      path: resolvedPath,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/fs/write
//
// Write content to a file, optionally creating parent directories.
// Body: { path, content, encoding?, createDirs? }
// Returns: { ok: true, bytesWritten: number, path: string }
// ---------------------------------------------------------------------------

filesystemRouter.post("/write", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = WriteFileSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { content, encoding, createDirs } = parseResult.data;

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 403);
  }

  try {
    if (createDirs) {
      await fsp.mkdir(path.dirname(resolvedPath), { recursive: true });
    }

    let bytesWritten: number;

    if (encoding === "base64") {
      const buffer = Buffer.from(content, "base64");
      await Bun.write(resolvedPath, buffer);
      bytesWritten = buffer.byteLength;
    } else {
      // utf-8 — use Bun.write for efficiency.
      await Bun.write(resolvedPath, content);
      bytesWritten = Buffer.byteLength(content, "utf-8");
    }

    return c.json({ ok: true, bytesWritten, path: resolvedPath });
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/fs/exists?path=<absolute-path>
//
// Check whether a path exists on the filesystem.
// Returns: { exists: boolean, type: "file" | "directory" | "symlink" | "other" | null, path: string }
// ---------------------------------------------------------------------------

filesystemRouter.get("/exists", async (c) => {
  const parseResult = ExistsSchema.safeParse({ path: c.req.query("path") });
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 403);
  }

  try {
    const stat = await fsp.lstat(resolvedPath);
    return c.json({
      exists: true,
      type: statToType(stat),
      path: resolvedPath,
    });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") {
      return c.json({ exists: false, type: null, path: resolvedPath });
    }
    const { status, body } = handleError(null, err);
    return c.json(body, status as 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/fs/mkdir
//
// Create a directory (and optionally all missing parent directories).
// Body: { path, recursive? }
// Returns: { ok: true, path: string }
// ---------------------------------------------------------------------------

filesystemRouter.post("/mkdir", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = MkdirSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { recursive } = parseResult.data;

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 403);
  }

  try {
    await fsp.mkdir(resolvedPath, { recursive });
    return c.json({ ok: true, path: resolvedPath });
  } catch (err) {
    const e = err as { code?: string };
    // mkdir with recursive:true returns undefined (not an error) if the dir
    // already exists. Without recursive it throws EEXIST.
    if (e.code === "EEXIST") {
      return c.json({ ok: true, path: resolvedPath, alreadyExisted: true });
    }
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/fs/readdir?path=<absolute-path>&recursive=false
//
// List directory contents.
// Returns: { entries: EntryMeta[], path: string }
// ---------------------------------------------------------------------------

filesystemRouter.get("/readdir", async (c) => {
  const parseResult = ReaddirSchema.safeParse({
    path: c.req.query("path"),
    recursive: c.req.query("recursive") === "true" ? true : c.req.query("recursive") === "false" ? false : undefined,
  });
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { recursive } = parseResult.data;

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 403);
  }

  try {
    const stat = await fsp.lstat(resolvedPath);
    if (!stat.isDirectory()) {
      return c.json(
        { error: "Bad Request", message: "Path is not a directory." },
        400
      );
    }

    if (recursive) {
      // Recursively walk the tree and collect all entries.
      const entries: EntryMeta[] = [];

      async function walk(dir: string): Promise<void> {
        const items = await fsp.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const itemPath = path.join(dir, item.name);
          try {
            const meta = await statEntry(itemPath);
            entries.push(meta);
            if (item.isDirectory()) {
              await walk(itemPath);
            }
          } catch {
            // Skip entries we cannot stat (e.g. broken symlinks, EPERM).
          }
        }
      }

      await walk(resolvedPath);
      return c.json({ entries, path: resolvedPath, recursive: true });
    } else {
      const items = await fsp.readdir(resolvedPath, { withFileTypes: true });
      const entries = await Promise.all(
        items.map(async (item) => {
          const itemPath = path.join(resolvedPath, item.name);
          try {
            return await statEntry(itemPath);
          } catch {
            // Fallback for broken symlinks / EPERM.
            return {
              name: item.name,
              path: itemPath,
              type: item.isDirectory() ? "directory" : item.isSymbolicLink() ? "symlink" : "file",
              size: 0,
              modifiedAt: new Date(0).toISOString(),
              createdAt: new Date(0).toISOString(),
              isDir: item.isDirectory(),
            } satisfies EntryMeta;
          }
        })
      );
      return c.json({ entries, path: resolvedPath, recursive: false });
    }
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/fs/delete
//
// Delete a file or directory.
// Body: { path, recursive? }
// Returns: { ok: true, path: string }
// ---------------------------------------------------------------------------

filesystemRouter.delete("/delete", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = DeleteSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { recursive } = parseResult.data;

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 403);
  }

  // Safety guard: never allow deleting an allowed root itself.
  if (allowedRoots.has(resolvedPath)) {
    return c.json(
      {
        error: "Forbidden",
        message: "Cannot delete an allowed root directory.",
      },
      403
    );
  }

  try {
    const stat = await fsp.lstat(resolvedPath);

    if (stat.isDirectory()) {
      await fsp.rm(resolvedPath, { recursive, force: false });
    } else {
      await fsp.unlink(resolvedPath);
    }

    return c.json({ ok: true, path: resolvedPath });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // fsp.rm without recursive on a non-empty dir throws ENOTEMPTY.
    if (e.code === "ENOTEMPTY") {
      return c.json(
        {
          error: "Conflict",
          message:
            "Directory is not empty. Pass recursive: true to delete it and its contents.",
        },
        409
      );
    }
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/fs/move
//
// Move (rename) a file or directory. Works across filesystems via copy+delete
// when rename(2) fails with EXDEV.
// Body: { src, dest, overwrite? }
// Returns: { ok: true, src: string, dest: string }
// ---------------------------------------------------------------------------

filesystemRouter.post("/move", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = MoveSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { overwrite } = parseResult.data;

  let src: string;
  let dest: string;
  try {
    [src, dest] = resolveSafePaths(parseResult.data.src, parseResult.data.dest);
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 403);
  }

  try {
    // Check destination existence.
    const destExists = await fsp.access(dest).then(() => true).catch(() => false);
    if (destExists && !overwrite) {
      return c.json(
        {
          error: "Conflict",
          message: `Destination already exists: ${dest}. Pass overwrite: true to replace it.`,
        },
        409
      );
    }
    if (destExists && overwrite) {
      const destStat = await fsp.lstat(dest);
      await fsp.rm(dest, { recursive: destStat.isDirectory(), force: true });
    }

    // Ensure parent directory of dest exists.
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    try {
      // Optimistic rename — works when src and dest are on the same filesystem.
      await fsp.rename(src, dest);
    } catch (renameErr) {
      const e = renameErr as { code?: string };
      if (e.code === "EXDEV") {
        // Cross-device: copy then delete.
        await copyRecursive(src, dest, overwrite);
        await fsp.rm(src, {
          recursive: (await fsp.lstat(src)).isDirectory(),
          force: true,
        });
      } else {
        throw renameErr;
      }
    }

    return c.json({ ok: true, src, dest });
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/fs/copy
//
// Copy a file or directory (recursively).
// Body: { src, dest, overwrite? }
// Returns: { ok: true, src: string, dest: string }
// ---------------------------------------------------------------------------

filesystemRouter.post("/copy", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = CopySchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { overwrite } = parseResult.data;

  let src: string;
  let dest: string;
  try {
    [src, dest] = resolveSafePaths(parseResult.data.src, parseResult.data.dest);
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 403);
  }

  try {
    // Ensure parent directory of dest exists.
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await copyRecursive(src, dest, overwrite);
    return c.json({ ok: true, src, dest });
  } catch (err) {
    const { status, body: errBody } = handleError(null, err);
    return c.json(errBody, status as 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/fs/stat?path=<absolute-path>
//
// Retrieve detailed metadata about a path.
// Returns: EntryMeta & { permissions: string }
// ---------------------------------------------------------------------------

filesystemRouter.get("/stat", async (c) => {
  const parseResult = StatSchema.safeParse({ path: c.req.query("path") });
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(parseResult.data.path);
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 403);
  }

  try {
    const stat = await fsp.lstat(resolvedPath);
    const type = statToType(stat);

    // Build a human-readable permissions string (Unix-style, e.g. "rwxr-xr--").
    const mode = stat.mode;
    const perms = [
      (mode & 0o400 ? "r" : "-"),
      (mode & 0o200 ? "w" : "-"),
      (mode & 0o100 ? "x" : "-"),
      (mode & 0o040 ? "r" : "-"),
      (mode & 0o020 ? "w" : "-"),
      (mode & 0o010 ? "x" : "-"),
      (mode & 0o004 ? "r" : "-"),
      (mode & 0o002 ? "w" : "-"),
      (mode & 0o001 ? "x" : "-"),
    ].join("");

    return c.json({
      name: path.basename(resolvedPath),
      path: resolvedPath,
      type,
      isDir: stat.isDirectory(),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      createdAt: stat.birthtime.toISOString(),
      accessedAt: stat.atime.toISOString(),
      permissions: perms,
      mode: stat.mode.toString(8),
      uid: stat.uid,
      gid: stat.gid,
      nlink: stat.nlink,
      ino: stat.ino,
    });
  } catch (err) {
    const { status, body } = handleError(null, err);
    return c.json(body, status as 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/fs/watch
//
// Start watching one or more paths for filesystem changes.
// Body: { paths: string[], recursive?: boolean }
// Returns: { watchId: string }
//
// After receiving the watchId, open a GET /api/fs/watch/:id SSE stream to
// receive change events in real time.
//
// Event payload format (sent over SSE):
//   data: { "type": "change"|"rename"|"add"|"unlink"|"error", "path": "...", "timestamp": "..." }
// ---------------------------------------------------------------------------

filesystemRouter.post("/watch", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = WatchSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const { recursive } = parseResult.data;

  // Validate all paths up front.
  const resolvedPaths: string[] = [];
  for (const p of parseResult.data.paths) {
    try {
      resolvedPaths.push(resolveSafePath(p));
    } catch (err) {
      const { status, body: errBody } = handleError(null, err);
      return c.json(errBody, status as 403);
    }
  }

  const watchId = crypto.randomUUID();

  const session: WatchSession = {
    paths: resolvedPaths,
    watcher: null,
    queue: [],
    controller: null,
    createdAt: Date.now(),
  };

  watchSessions.set(watchId, session);

  // We set up a single fs.watch per registered path.  For simplicity we watch
  // the first path provided (common use-case: watch a project root).  Multiple
  // paths would require multiple watchers; callers can POST /watch again for
  // each root they care about and multiplex watch IDs themselves.
  //
  // Note: Node/Bun fs.watch is not perfectly reliable on all platforms
  // (especially macOS kqueue vs Linux inotify), but it is the best available
  // without an external native module.

  function setupWatcher(): void {
    const pathsToWatch = resolvedPaths;

    for (const watchPath of pathsToWatch) {
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(watchPath);
      } catch {
        // Path does not exist yet — skip (client is welcome to watch a
        // directory that doesn't exist yet; we simply won't emit events for it).
        continue;
      }

      const watcher = fs.watch(
        watchPath,
        { recursive: recursive && stat.isDirectory(), persistent: false },
        (eventType, filename) => {
          const absoluteFilename = filename
            ? path.resolve(watchPath, filename)
            : watchPath;

          const event: WatchEvent = {
            type: eventType === "rename" ? "rename" : "change",
            path: absoluteFilename,
            timestamp: new Date().toISOString(),
          };

          const sess = watchSessions.get(watchId);
          if (!sess) return;

          if (sess.controller) {
            try {
              sess.controller.enqueue(encodeSSE(event));
            } catch {
              // Controller is closed — clean up.
              sess.watcher?.close();
              watchSessions.delete(watchId);
            }
          } else {
            // Buffer up to 50 events before a client connects.
            if (sess.queue.length < 50) {
              sess.queue.push(event);
            }
          }
        }
      );

      watcher.on("error", (err) => {
        const sess = watchSessions.get(watchId);
        if (!sess) return;

        const event: WatchEvent = {
          type: "error",
          path: watchPath,
          timestamp: new Date().toISOString(),
        };

        if (sess.controller) {
          try {
            sess.controller.enqueue(encodeSSE(event));
          } catch {
            // ignore
          }
        }
      });

      // Store the last watcher (one per session — callers typically watch a
      // single root; if they need multi-root they use multiple watch sessions).
      session.watcher = watcher;
    }
  }

  setupWatcher();

  return c.json({ watchId, paths: resolvedPaths });
});

// ---------------------------------------------------------------------------
// GET /api/fs/watch/:id   (Server-Sent Events stream)
//
// Subscribe to filesystem change events for a previously created watch session.
// Events are pushed as SSE `data:` lines containing JSON WatchEvent objects.
//
// The connection stays open until the client closes it or the server shuts down.
// ---------------------------------------------------------------------------

filesystemRouter.get("/watch/:id", (c) => {
  const watchId = c.req.param("id");
  const session = watchSessions.get(watchId);

  if (!session) {
    return c.json(
      {
        error: "Not Found",
        message: `Watch session '${watchId}' does not exist or has expired.`,
      },
      404
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Attach this controller to the session so the watcher can push events.
      session.controller = controller;

      // Flush any buffered events that arrived before the client connected.
      for (const event of session.queue) {
        controller.enqueue(encodeSSE(event));
      }
      session.queue = [];

      // Send an initial "connected" heartbeat so the client knows the stream
      // is live.
      const connected = `data: ${JSON.stringify({
        type: "connected",
        watchId,
        paths: session.paths,
        timestamp: new Date().toISOString(),
      })}\n\n`;
      controller.enqueue(encoder.encode(connected));

      // Heartbeat every 30 seconds to keep the connection alive through
      // proxies and load balancers.
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Clean up when the stream is cancelled (client disconnects).
      return () => {
        clearInterval(heartbeatInterval);
        session.watcher?.close();
        watchSessions.delete(watchId);
      };
    },

    cancel() {
      session.watcher?.close();
      watchSessions.delete(watchId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Allow Tauri's renderer (tauri://localhost) to read this stream.
      "X-Accel-Buffering": "no",
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/fs/watch/:id
//
// Explicitly stop a watch session. The SSE stream (if open) will be closed.
// ---------------------------------------------------------------------------

filesystemRouter.delete("/watch/:id", (c) => {
  const watchId = c.req.param("id");
  const session = watchSessions.get(watchId);

  if (!session) {
    return c.json({ error: "Not Found", message: `Watch session '${watchId}' not found.` }, 404);
  }

  session.watcher?.close();

  if (session.controller) {
    try {
      session.controller.close();
    } catch {
      // Already closed — ignore.
    }
  }

  watchSessions.delete(watchId);
  return c.json({ ok: true, watchId });
});

// ---------------------------------------------------------------------------
// POST /api/fs/roots
//
// Register an additional allowed root at runtime. Useful when the Tauri
// backend opens a project located outside the default allowed paths.
// Body: { root: string }
// Returns: { ok: true, roots: string[] }
// ---------------------------------------------------------------------------

filesystemRouter.post("/roots", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Request body must be JSON." }, 400);
  }

  const parseResult = AddRootSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      { error: "Bad Request", details: parseResult.error.flatten() },
      400
    );
  }

  const resolved = path.resolve(parseResult.data.root);
  allowedRoots.add(resolved);

  return c.json({ ok: true, roots: [...allowedRoots] });
});

// ---------------------------------------------------------------------------
// GET /api/fs/roots
//
// List all currently registered allowed roots.
// ---------------------------------------------------------------------------

filesystemRouter.get("/roots", (c) => {
  return c.json({ roots: [...allowedRoots] });
});

// ---------------------------------------------------------------------------
// WebSocket upgrade: /api/fs/ws/watch
//
// Retained for backward-compatibility with clients that attempt a WebSocket
// upgrade here. The recommended approach is now the SSE-based
// POST /api/fs/watch + GET /api/fs/watch/:id pattern above, which does not
// require touching Bun.serve()'s websocket handler.
// ---------------------------------------------------------------------------

filesystemRouter.get("/ws/watch", (c) => {
  return c.json(
    {
      error: "Gone",
      message:
        "WebSocket-based watching has been superseded by Server-Sent Events. " +
        "Use POST /api/fs/watch to create a watch session, then open " +
        "GET /api/fs/watch/:id as an SSE stream.",
      migration: {
        step1: "POST /api/fs/watch  body: { paths: string[], recursive?: boolean }",
        step2: "GET  /api/fs/watch/:watchId  (EventSource / fetch stream)",
      },
    },
    410
  );
});
