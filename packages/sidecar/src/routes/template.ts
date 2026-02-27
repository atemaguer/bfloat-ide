/**
 * Template Routes
 *
 * Ports the Electron template-handler IPC handlers to Hono HTTP routes.
 * Templates are bundled alongside the sidecar binary in a "templates/"
 * sibling directory. When the sidecar runs from the Tauri bundle the layout is:
 *
 *   Contents/
 *     MacOS/
 *       bfloat-sidecar              ← the running binary
 *     Resources/
 *       templates/
 *         expo-default/
 *         nextjs-default/
 *
 * In development the working directory contains a "resources/templates/"
 * directory at the repo root level.
 *
 * Routes:
 *   GET  /api/template/list                 – list available templates
 *   GET  /api/template/path?appType=...     – get template path for an app type
 *   POST /api/template/initialize           – copy template into a project directory
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Template map (mirrors template-handler.ts TEMPLATE_MAP)
// ---------------------------------------------------------------------------

const TEMPLATE_MAP: Record<string, string> = {
  expo: "expo-default",
  mobile: "expo-default",
  nextjs: "nextjs-default",
  vite: "nextjs-default",
  web: "nextjs-default",
  node: "nextjs-default",
};

const PROJECT_ORIGIN_DIR = ".bfloat-ide";
const PROJECT_ORIGIN_FILE = "project-origin.json";
const TEMPLATE_BOOTSTRAP_ORIGIN = "template-bootstrap";

// ---------------------------------------------------------------------------
// Templates base path resolution
//
// Tauri sidecar binaries are placed at:
//   <bundle>/Contents/MacOS/<binary>        (macOS)
//   <bundle>/                                (Windows)
//
// The templates live in:
//   <bundle>/Contents/Resources/templates   (macOS)
//   <bundle>/resources/templates            (Windows / Linux)
//
// In development (bun run dev), the binary runs from the sidecar package root
// and templates live at <repo-root>/resources/templates.
// ---------------------------------------------------------------------------

function getTemplatesBasePath(): string {
  // For compiled Bun binaries, import.meta.dir returns "/$bunfs/" (virtual FS),
  // so we use process.execPath (the real binary on disk) instead.
  // In development (uncompiled), import.meta.dir works fine.
  const metaDir = (import.meta as { dir?: string }).dir ?? "";
  const isCompiledBinary = metaDir.startsWith("/$bunfs") || metaDir === "";
  const binaryDir: string = isCompiledBinary
    ? path.dirname(process.execPath)
    : metaDir || process.cwd();

  // Candidates in priority order
  const candidates: string[] = [
    // Tauri macOS bundle: binary in Contents/MacOS, resources in Contents/Resources
    path.join(binaryDir, "..", "Resources", "templates"),
    // Tauri Windows/Linux bundle
    path.join(binaryDir, "..", "resources", "templates"),
    // Development (compiled binary in target/debug/):
    //   target/debug/ → target/ → src-tauri/ → desktop/ → packages/ → bfloat-ide/
    path.join(binaryDir, "..", "..", "..", "..", "..", "resources", "templates"),
    path.join(binaryDir, "..", "..", "..", "..", "resources", "templates"),
    path.join(binaryDir, "..", "..", "..", "resources", "templates"),
    path.join(binaryDir, "..", "..", "resources", "templates"),
    path.join(binaryDir, "resources", "templates"),
    // CWD fallback (useful in development)
    //   CWD is typically src-tauri/ → desktop/ → packages/ → bfloat-ide/
    path.join(process.cwd(), "..", "..", "..", "resources", "templates"),
    path.join(process.cwd(), "..", "..", "resources", "templates"),
    path.join(process.cwd(), "resources", "templates"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Return the first candidate as the canonical path even if it doesn't exist
  // so callers get a clear "not found" error rather than a cryptic ENOENT.
  return candidates[0];
}

function getTemplatePath(appType: string): string {
  const folder = TEMPLATE_MAP[appType] ?? TEMPLATE_MAP.web;
  return path.join(getTemplatesBasePath(), folder);
}

function getTemplateFolder(appType: string): string {
  return TEMPLATE_MAP[appType] ?? TEMPLATE_MAP.web;
}

// ---------------------------------------------------------------------------
// Directory copy helper (mirrors template-handler.ts copyDirectory)
// ---------------------------------------------------------------------------

async function copyDirectory(src: string, dest: string): Promise<void> {
  const SKIP_ENTRIES = new Set(["node_modules", ".git", ".DS_Store"]);
  await fsp.mkdir(dest, { recursive: true });

  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Template listing
// ---------------------------------------------------------------------------

interface TemplateInfo {
  id: string;
  name: string;
  type: string;
}

async function listTemplates(): Promise<TemplateInfo[]> {
  const basePath = getTemplatesBasePath();

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(basePath, { withFileTypes: true });
  } catch (err) {
    console.error(`[Template] Failed to read templates dir (${basePath}):`, err);
    return [];
  }

  const templates: TemplateInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const launchPath = path.join(basePath, entry.name, ".bfloat-ide", "launch.json");
      const launchContent = await Bun.file(launchPath).text();
      const launchConfig = JSON.parse(launchContent) as { type?: string };

      templates.push({
        id: entry.name,
        name: entry.name.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        type: launchConfig.type ?? "web",
      });
    } catch {
      // No launch.json — skip this directory
    }
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Initialize a project from a template
// ---------------------------------------------------------------------------

export async function initializeFromTemplate(
  projectPath: string,
  appType: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const templatePath = getTemplatePath(appType);
    const templateFolder = getTemplateFolder(appType);

    // Verify the template exists
    try {
      await fsp.access(templatePath);
    } catch {
      return {
        success: false,
        error: `Template not found for app type '${appType}' at ${templatePath}`,
      };
    }

    // If the project directory already has substantive files (beyond .git,
    // .claude, .agents which are injected by the skills system), skip copy.
    const SKIP_DIRS = new Set([".git", ".claude", ".agents"]);
    try {
      const existingFiles = await fsp.readdir(projectPath);
      if (existingFiles.length > 0 && existingFiles.some((f) => !SKIP_DIRS.has(f))) {
        console.log("[Template] Project directory already has files, skipping template copy");
        return { success: true };
      }
    } catch {
      // Directory doesn't exist or is empty — continue
    }

    await fsp.mkdir(projectPath, { recursive: true });
    await copyDirectory(templatePath, projectPath);
    await writeProjectOriginMarker(projectPath, appType, templateFolder);

    console.log(`[Template] Initialized project at ${projectPath} from template '${appType}'`);
    return { success: true };
  } catch (err) {
    console.error("[Template] Failed to initialize template:", err);
    return { success: false, error: String(err) };
  }
}

async function writeProjectOriginMarker(
  projectPath: string,
  appType: string,
  templateId: string
): Promise<void> {
  const originDir = path.join(projectPath, PROJECT_ORIGIN_DIR);
  const markerPath = path.join(originDir, PROJECT_ORIGIN_FILE);
  const payload = {
    origin: TEMPLATE_BOOTSTRAP_ORIGIN,
    appType,
    templateId,
    initializedAt: new Date().toISOString(),
  };

  await fsp.mkdir(originDir, { recursive: true });
  await fsp.writeFile(markerPath, JSON.stringify(payload, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const InitializeSchema = z.object({
  projectPath: z.string().min(1),
  appType: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const templateRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/template/list
// ---------------------------------------------------------------------------
templateRouter.get("/list", async (c) => {
  try {
    const templates = await listTemplates();
    return c.json({ templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/template/path?appType=expo
// ---------------------------------------------------------------------------
templateRouter.get("/path", (c) => {
  const appType = c.req.query("appType");
  if (!appType) {
    return c.json({ error: "appType query parameter is required" }, 400);
  }
  return c.json({ path: getTemplatePath(appType) });
});

// ---------------------------------------------------------------------------
// GET /api/template/base-path  – expose the resolved templates base path
// ---------------------------------------------------------------------------
templateRouter.get("/base-path", (c) => {
  return c.json({
    basePath: getTemplatesBasePath(),
    exists: fs.existsSync(getTemplatesBasePath()),
  });
});

// ---------------------------------------------------------------------------
// POST /api/template/initialize  { projectPath, appType }
// ---------------------------------------------------------------------------
templateRouter.post("/initialize", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = InitializeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { projectPath, appType } = parsed.data;

  // Validate that the project path doesn't escape ~/.bfloat-ide/projects
  // or other allowed roots. We are permissive here because templates may be
  // initialized into any user-owned directory.
  const normalHome = os.homedir();
  const resolvedPath = path.resolve(projectPath);
  if (!resolvedPath.startsWith(normalHome)) {
    return c.json({ error: "Project path must be inside the user home directory" }, 403);
  }

  const result = await initializeFromTemplate(resolvedPath, appType);
  return c.json(result, result.success ? 200 : 500);
});
