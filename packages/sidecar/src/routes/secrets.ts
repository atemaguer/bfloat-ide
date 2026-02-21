/**
 * Secrets Routes
 *
 * Ports the Electron secrets-handler IPC handlers to Hono HTTP routes.
 * Reads and writes project environment variables stored in .env.local files
 * under ~/.bfloat-ide/projects/<projectId>/.
 *
 * Routes:
 *   GET    /api/secrets/:projectId          – read all secrets
 *   POST   /api/secrets/:projectId          – set (upsert) a secret
 *   DELETE /api/secrets/:projectId/:key     – delete a secret
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Paths (mirror secrets-handler.ts)
// ---------------------------------------------------------------------------

const PROJECTS_DIR = path.join(os.homedir(), ".bfloat-ide", "projects");

function getEnvLocalPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, ".env.local");
}

function getLegacyEnvPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, ".env");
}

// ---------------------------------------------------------------------------
// .env file parsing (mirrors secrets-handler parseEnvFile)
// ---------------------------------------------------------------------------

export interface Secret {
  key: string;
  value: string;
}

function parseEnvFile(content: string): Secret[] {
  const secrets: Secret[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = trimmed.substring(0, equalsIndex).trim();
    let value = trimmed.substring(equalsIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    secrets.push({ key, value });
  }

  return secrets;
}

// ---------------------------------------------------------------------------
// .env file update helpers (mirror secrets-handler updateEnvContent / removeFromEnvContent)
// ---------------------------------------------------------------------------

function updateEnvContent(content: string, key: string, value: string): string {
  const needsQuotes =
    value.includes(" ") ||
    value.includes("#") ||
    value.includes('"') ||
    value.includes("'");
  const formattedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;

  const lines = content.split("\n");
  let found = false;

  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) return line;

    const lineKey = trimmed.substring(0, eqIdx).trim();
    if (lineKey === key) {
      found = true;
      return `${key}=${formattedValue}`;
    }
    return line;
  });

  if (!found) {
    // Append at end, preserving trailing newline
    if (updated.length > 0 && updated[updated.length - 1].trim() !== "") {
      updated.push(`${key}=${formattedValue}`);
    } else if (updated.length === 0) {
      updated.push(`${key}=${formattedValue}`);
    } else {
      updated[updated.length - 1] = `${key}=${formattedValue}`;
      updated.push("");
    }
  }

  return updated.join("\n");
}

function removeFromEnvContent(content: string, key: string): string {
  const lines = content.split("\n");

  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) return true;

      return trimmed.substring(0, eqIdx).trim() !== key;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Preferred env file path (prefer .env.local, fall back to .env)
// ---------------------------------------------------------------------------

function resolveEnvPath(projectId: string): { readPath: string; writePath: string } {
  const envLocal = getEnvLocalPath(projectId);
  const legacy = getLegacyEnvPath(projectId);

  // Always write to .env.local
  const writePath = envLocal;

  // Read from whichever exists (prefer .env.local)
  const readPath = fs.existsSync(envLocal) ? envLocal : fs.existsSync(legacy) ? legacy : envLocal;

  return { readPath, writePath };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SetSecretSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Key must be a valid environment variable name"),
  value: z.string(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const secretsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/secrets/:projectId
// ---------------------------------------------------------------------------
secretsRouter.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const { readPath } = resolveEnvPath(projectId);

  if (!fs.existsSync(readPath)) {
    return c.json({ secrets: [] });
  }

  try {
    const content = await Bun.file(readPath).text();
    const secrets = parseEnvFile(content);
    return c.json({ secrets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Secrets] Error reading secrets for ${projectId}:`, err);
    return c.json({ secrets: [], error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/secrets/:projectId  { key, value }
// ---------------------------------------------------------------------------
secretsRouter.post("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = SetSecretSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { key, value } = parsed.data;
  const { readPath, writePath } = resolveEnvPath(projectId);

  try {
    // Ensure project directory exists
    await fsp.mkdir(path.dirname(writePath), { recursive: true });

    let content = "";
    if (fs.existsSync(readPath)) {
      content = await Bun.file(readPath).text();
    }

    const updated = updateEnvContent(content, key, value);
    await Bun.write(writePath, updated);

    console.log(`[Secrets] Set secret: ${key} for project ${projectId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Secrets] Error setting secret ${key}:`, err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/secrets/:projectId/:key
// ---------------------------------------------------------------------------
secretsRouter.delete("/:projectId/:key", async (c) => {
  const projectId = c.req.param("projectId");
  const key = c.req.param("key");
  const { readPath } = resolveEnvPath(projectId);

  if (!fs.existsSync(readPath)) {
    return c.json({ success: true }); // nothing to delete
  }

  try {
    const content = await Bun.file(readPath).text();
    const updated = removeFromEnvContent(content, key);
    await Bun.write(readPath, updated);

    console.log(`[Secrets] Deleted secret: ${key} for project ${projectId}`);
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Secrets] Error deleting secret ${key}:`, err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/secrets/:projectId/bulk  [{ key, value }, ...]
// (convenience endpoint not in original handler but useful for init)
// ---------------------------------------------------------------------------
secretsRouter.post("/:projectId/bulk", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));

  const BulkSchema = z.array(SetSecretSchema);
  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { readPath, writePath } = resolveEnvPath(projectId);

  try {
    await fsp.mkdir(path.dirname(writePath), { recursive: true });

    let content = "";
    if (fs.existsSync(readPath)) {
      content = await Bun.file(readPath).text();
    }

    for (const { key, value } of parsed.data) {
      content = updateEnvContent(content, key, value);
    }

    await Bun.write(writePath, content);
    return c.json({ success: true, count: parsed.data.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});
