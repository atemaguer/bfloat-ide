/**
 * Local Projects Routes
 *
 * Ports the Electron local-projects-handler IPC handlers to Hono HTTP routes.
 * Stores project metadata in ~/.bfloat-ide/projects.json (same format as
 * the Electron handler).
 *
 * Routes (all require auth via the global middleware):
 *   GET    /api/local-projects                             – list all projects
 *   GET    /api/local-projects/:id                        – get single project
 *   POST   /api/local-projects                            – create project
 *   PUT    /api/local-projects/:id                        – update project
 *   DELETE /api/local-projects/:id                        – delete project
 *
 *   GET    /api/local-projects/:id/sessions               – list sessions
 *   POST   /api/local-projects/:id/sessions               – add / upsert session
 *   PUT    /api/local-projects/:id/sessions/:sessionId    – update session fields
 *   DELETE /api/local-projects/:id/sessions/:sessionId    – delete session
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

const BFLOAT_DIR = path.join(os.homedir(), ".bfloat-ide");
const PROJECTS_FILE = path.join(BFLOAT_DIR, "projects.json");
const PROJECTS_BASE = path.join(BFLOAT_DIR, "projects");

// ---------------------------------------------------------------------------
// Type definitions (mirror app/types/project)
// We define them inline so the sidecar has no dependency on the Electron app.
// ---------------------------------------------------------------------------

export interface AgentSession {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt?: string;
  status?: string;
  totalTokens?: number;
  totalCostUsd?: number;
  [key: string]: unknown;
}

export interface Deployment {
  id: string;
  projectId?: string;
  platform: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  url?: string;
  error?: string;
  [key: string]: unknown;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
  sessions?: AgentSession[];
  deployments?: Deployment[];
  launchConfig?: Record<string, unknown> | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// File I/O helpers (mirror local-projects-handler.ts)
// ---------------------------------------------------------------------------

async function ensureDir(): Promise<void> {
  if (!fs.existsSync(BFLOAT_DIR)) {
    await fsp.mkdir(BFLOAT_DIR, { recursive: true });
  }
}

async function readProjects(): Promise<Project[]> {
  await ensureDir();

  if (!fs.existsSync(PROJECTS_FILE)) {
    return [];
  }

  try {
    const content = await Bun.file(PROJECTS_FILE).text();
    return JSON.parse(content) as Project[];
  } catch (err) {
    console.error("[LocalProjects] Failed to read projects:", err);
    return [];
  }
}

async function writeProjects(projects: Project[]): Promise<void> {
  await ensureDir();
  await Bun.write(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const projects = await readProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// Loose schema — we accept any extra fields so the sidecar stays compatible
// with whatever shape the Tauri frontend sends.
const AgentSessionSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  status: z.string().optional(),
  totalTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
}).passthrough();

const DeploymentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().optional(),
  platform: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

const ProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  sessions: z.array(AgentSessionSchema).optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Shared helper — update a session within a project (used by routes + agent-session)
// ---------------------------------------------------------------------------

export async function updateSessionInProject(
  projectId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const projects = await readProjects();
  const projectIndex = projects.findIndex((p) => p.id === projectId);
  if (projectIndex === -1) {
    console.warn(`[LocalProjects] updateSessionInProject: project ${projectId} not found`);
    return;
  }

  const sessions = projects[projectIndex].sessions ?? [];
  const sessionIndex = sessions.findIndex((s) => s.sessionId === sessionId);
  if (sessionIndex === -1) {
    console.warn(`[LocalProjects] updateSessionInProject: session ${sessionId} not found in project ${projectId}`);
    return;
  }

  sessions[sessionIndex] = { ...sessions[sessionIndex], ...data };
  projects[projectIndex].sessions = sessions;
  projects[projectIndex].updatedAt = new Date().toISOString();

  await writeProjects(projects);
  console.log(`[LocalProjects] updateSessionInProject: updated session ${sessionId} in project ${projectId}`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const localProjectsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/local-projects  – list all
// ---------------------------------------------------------------------------
localProjectsRouter.get("/", async (c) => {
  try {
    const projects = await readProjects();
    console.log(`[LocalProjects] list called, returning ${projects.length} projects`);
    return c.json(projects);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/local-projects/:id  – get single
// ---------------------------------------------------------------------------
localProjectsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const projects = await readProjects();
    const project = projects.find((p) => p.id === id) ?? null;
    if (!project) {
      return c.json({ error: "Project not found", id }, 404);
    }
    return c.json(project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/local-projects  – create
// ---------------------------------------------------------------------------
localProjectsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ProjectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid project data", details: parsed.error.flatten() }, 400);
  }

  const project = parsed.data as Project;

  try {
    const projects = await readProjects();
    projects.push(project);
    await writeProjects(projects);
    console.log(`[LocalProjects] created project ${project.id} "${project.title}", total: ${projects.length}`);
    return c.json({ success: true }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/local-projects/:id/launch-config  – cache launch config
// (Registered before PUT /:id so the more specific route matches first)
// ---------------------------------------------------------------------------
localProjectsRouter.put("/:id/launch-config", async (c) => {
  const projectId = c.req.param("id");
  const body = await c.req.json().catch(() => null);

  try {
    const projects = await readProjects();
    const index = projects.findIndex((p) => p.id === projectId);
    if (index === -1) {
      return c.json({ error: "Project not found", projectId }, 404);
    }

    projects[index].launchConfig = body;
    projects[index].updatedAt = new Date().toISOString();
    await writeProjects(projects);

    console.log(`[LocalProjects] Updated launch config for project ${projectId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/local-projects/:id  – update (full replace)
// ---------------------------------------------------------------------------
localProjectsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ProjectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid project data", details: parsed.error.flatten() }, 400);
  }

  const project = parsed.data as Project;

  try {
    const projects = await readProjects();
    const index = projects.findIndex((p) => p.id === id);
    if (index === -1) {
      return c.json({ error: "Project not found", id }, 404);
    }

    projects[index] = project;
    await writeProjects(projects);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/local-projects/:id  – delete
// ---------------------------------------------------------------------------
localProjectsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Path-traversal guard
  if (/[/\\]|\.\./.test(id)) {
    return c.json({ error: "Invalid project id" }, 400);
  }

  try {
    const projects = await readProjects();
    const filtered = projects.filter((p) => p.id !== id);
    await writeProjects(filtered);

    // Clean up the project directory on disk
    let warning: string | undefined;
    const projectDir = path.join(PROJECTS_BASE, id);
    try {
      await fsp.rm(projectDir, { recursive: true, force: true });
      console.log(`[LocalProjects] Removed project directory: ${projectDir}`);
    } catch (rmErr: unknown) {
      if ((rmErr as NodeJS.ErrnoException).code !== "ENOENT") {
        warning = `Metadata removed but failed to delete project directory: ${(rmErr as Error).message}`;
        console.warn(`[LocalProjects] ${warning}`);
      }
    }

    return c.json({ success: true, ...(warning ? { warning } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/local-projects/:id/sessions  – list sessions
// ---------------------------------------------------------------------------
localProjectsRouter.get("/:id/sessions", async (c) => {
  const id = c.req.param("id");
  try {
    const projects = await readProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) {
      return c.json({ error: "Project not found", id }, 404);
    }
    return c.json(project.sessions ?? []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/local-projects/:id/sessions  – add / upsert session
// ---------------------------------------------------------------------------
localProjectsRouter.post("/:id/sessions", async (c) => {
  const projectId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid session data", details: parsed.error.flatten() }, 400);
  }

  const session = parsed.data as AgentSession;

  try {
    const projects = await readProjects();
    const index = projects.findIndex((p) => p.id === projectId);
    if (index === -1) {
      console.error(`[LocalProjects] Project not found: ${projectId}`);
      return c.json({ error: "Project not found", projectId }, 404);
    }

    if (!projects[index].sessions) projects[index].sessions = [];

    const existingIdx = projects[index].sessions!.findIndex(
      (s) => s.sessionId === session.sessionId
    );

    if (existingIdx >= 0) {
      projects[index].sessions![existingIdx] = session;
      console.log(`[LocalProjects] Updated existing session ${session.sessionId}`);
    } else {
      projects[index].sessions!.push(session);
      console.log(`[LocalProjects] Added session ${session.sessionId}, total: ${projects[index].sessions!.length}`);
    }

    projects[index].updatedAt = new Date().toISOString();
    await writeProjects(projects);

    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/local-projects/:id/sessions/:sessionId  – partial update
// ---------------------------------------------------------------------------
localProjectsRouter.put("/:id/sessions/:sessionId", async (c) => {
  const projectId = c.req.param("id");
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json().catch(() => ({}));

  try {
    const projects = await readProjects();
    const projectIndex = projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) {
      return c.json({ error: "Project not found", projectId }, 404);
    }

    const sessions = projects[projectIndex].sessions ?? [];
    const sessionIndex = sessions.findIndex((s) => s.sessionId === sessionId);
    if (sessionIndex === -1) {
      return c.json({ error: "Session not found", sessionId }, 404);
    }

    sessions[sessionIndex] = { ...sessions[sessionIndex], ...body };
    projects[projectIndex].sessions = sessions;
    projects[projectIndex].updatedAt = new Date().toISOString();

    await writeProjects(projects);
    console.log(`[LocalProjects] Updated session ${sessionId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/local-projects/:id/sessions/:sessionId  – delete session
// ---------------------------------------------------------------------------
localProjectsRouter.delete("/:id/sessions/:sessionId", async (c) => {
  const projectId = c.req.param("id");
  const sessionId = c.req.param("sessionId");

  try {
    const projects = await readProjects();
    const projectIndex = projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) {
      return c.json({ error: "Project not found", projectId }, 404);
    }

    const sessions = projects[projectIndex].sessions ?? [];
    projects[projectIndex].sessions = sessions.filter((s) => s.sessionId !== sessionId);
    projects[projectIndex].updatedAt = new Date().toISOString();

    await writeProjects(projects);
    console.log(`[LocalProjects] Deleted session ${sessionId} from project ${projectId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/local-projects/:id/deployments  – list deployments
// ---------------------------------------------------------------------------
localProjectsRouter.get("/:id/deployments", async (c) => {
  const id = c.req.param("id");
  try {
    const projects = await readProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) {
      return c.json({ error: "Project not found", id }, 404);
    }
    return c.json(project.deployments ?? []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/local-projects/:id/deployments  – add / upsert deployment (cap 50)
// ---------------------------------------------------------------------------
localProjectsRouter.post("/:id/deployments", async (c) => {
  const projectId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = DeploymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid deployment data", details: parsed.error.flatten() }, 400);
  }

  const deployment = parsed.data as Deployment;

  try {
    const projects = await readProjects();
    const index = projects.findIndex((p) => p.id === projectId);
    if (index === -1) {
      return c.json({ error: "Project not found", projectId }, 404);
    }

    if (!projects[index].deployments) projects[index].deployments = [];

    const existingIdx = projects[index].deployments!.findIndex(
      (d) => d.id === deployment.id
    );

    if (existingIdx >= 0) {
      projects[index].deployments![existingIdx] = deployment;
      console.log(`[LocalProjects] Updated existing deployment ${deployment.id}`);
    } else {
      projects[index].deployments!.unshift(deployment);
      // Cap at 50 deployments
      if (projects[index].deployments!.length > 50) {
        projects[index].deployments = projects[index].deployments!.slice(0, 50);
      }
      console.log(`[LocalProjects] Added deployment ${deployment.id}, total: ${projects[index].deployments!.length}`);
    }

    projects[index].updatedAt = new Date().toISOString();
    await writeProjects(projects);

    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/local-projects/:id/deployments/:deploymentId  – partial update
// ---------------------------------------------------------------------------
localProjectsRouter.put("/:id/deployments/:deploymentId", async (c) => {
  const projectId = c.req.param("id");
  const deploymentId = c.req.param("deploymentId");
  const body = await c.req.json().catch(() => ({}));

  try {
    const projects = await readProjects();
    const projectIndex = projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) {
      return c.json({ error: "Project not found", projectId }, 404);
    }

    const deployments = projects[projectIndex].deployments ?? [];
    const deploymentIndex = deployments.findIndex((d) => d.id === deploymentId);
    if (deploymentIndex === -1) {
      return c.json({ error: "Deployment not found", deploymentId }, 404);
    }

    deployments[deploymentIndex] = { ...deployments[deploymentIndex], ...body };
    projects[projectIndex].deployments = deployments;
    projects[projectIndex].updatedAt = new Date().toISOString();

    await writeProjects(projects);
    console.log(`[LocalProjects] Updated deployment ${deploymentId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/local-projects/:id/deployments/:deploymentId  – delete deployment
// ---------------------------------------------------------------------------
localProjectsRouter.delete("/:id/deployments/:deploymentId", async (c) => {
  const projectId = c.req.param("id");
  const deploymentId = c.req.param("deploymentId");

  try {
    const projects = await readProjects();
    const projectIndex = projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) {
      return c.json({ error: "Project not found", projectId }, 404);
    }

    const deployments = projects[projectIndex].deployments ?? [];
    projects[projectIndex].deployments = deployments.filter((d) => d.id !== deploymentId);
    projects[projectIndex].updatedAt = new Date().toISOString();

    await writeProjects(projects);
    console.log(`[LocalProjects] Deleted deployment ${deploymentId} from project ${projectId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});
