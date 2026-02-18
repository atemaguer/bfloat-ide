/**
 * SkillsInjector - Injects bundled skills into project directories
 *
 * Skills are bundled alongside the sidecar binary in a "skills/" sibling
 * directory (same layout as templates). When running as a compiled Bun binary,
 * we resolve the path using process.execPath; in development we use import.meta.dir.
 *
 * Layout (Tauri macOS bundle):
 *   Contents/
 *     MacOS/
 *       bfloat-sidecar
 *     Resources/
 *       skills/
 *         version.json
 *         building-native-ui/
 *         ...
 */

import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";

const LOG_PREFIX = "[SkillsInjector]";
const VERSION_FILE = ".bfloat-skills-version";

interface SkillsVersion {
  version: string;
  updatedAt: string;
  skills: {
    claude: string[];
    codex: string[];
  };
}

// ---------------------------------------------------------------------------
// Claude Code settings (permissions + sandbox config)
// ---------------------------------------------------------------------------

const CLAUDE_SETTINGS = {
  permissions: {
    allow: [
      // Package managers
      "Bash(npm install *)",
      "Bash(npm run *)",
      "Bash(npm uninstall *)",
      "Bash(npm ci*)",
      "Bash(npx *)",
      "Bash(bun install *)",
      "Bash(bun run *)",
      "Bash(bun add *)",
      "Bash(bun remove *)",
      "Bash(bunx *)",
      "Bash(yarn install *)",
      "Bash(yarn add *)",
      "Bash(yarn remove *)",
      "Bash(pnpm install *)",
      "Bash(pnpm add *)",
      "Bash(pnpm remove *)",
      "Bash(pnpm run *)",
      // npx wrappers (explicit)
      "Bash(npx expo *)",
      "Bash(npx convex *)",
      "Bash(npx eas *)",
      // Common dev commands
      "Bash(git *)",
      "Bash(expo *)",
      "Bash(eas *)",
      // Build tools
      "Bash(tsc *)",
      "Bash(node *)",
      // File system
      "Bash(mkdir *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(find *)",
      "Bash(grep *)",
      // Core tools
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      // Skills and subagents
      "Skill(*)",
      "Task",
    ],
  },
  sandbox: {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    excludedCommands: [
      "npm",
      "npx",
      "bun",
      "bunx",
      "yarn",
      "pnpm",
      "git",
      "expo",
      "eas",
    ],
  },
};

// ---------------------------------------------------------------------------
// Skills base path resolution
// Uses the same compiled-binary detection as template.ts
// ---------------------------------------------------------------------------

function getSkillsBasePath(): string {
  const metaDir = (import.meta as { dir?: string }).dir ?? "";
  const isCompiledBinary = metaDir.startsWith("/$bunfs") || metaDir === "";
  const binaryDir: string = isCompiledBinary
    ? path.dirname(process.execPath)
    : metaDir || process.cwd();

  const candidates: string[] = [
    // Tauri macOS bundle
    path.join(binaryDir, "..", "Resources", "skills"),
    // Tauri Windows/Linux bundle
    path.join(binaryDir, "..", "resources", "skills"),
    // Development (compiled binary in target/debug/):
    //   target/debug/ → target/ → src-tauri/ → desktop/ → packages/ → bfloat-ide/
    path.join(binaryDir, "..", "..", "..", "..", "..", "resources", "skills"),
    path.join(binaryDir, "..", "..", "..", "..", "resources", "skills"),
    path.join(binaryDir, "..", "..", "..", "resources", "skills"),
    path.join(binaryDir, "..", "..", "resources", "skills"),
    path.join(binaryDir, "resources", "skills"),
    // CWD fallback (CWD is typically src-tauri/)
    path.join(process.cwd(), "..", "..", "..", "resources", "skills"),
    path.join(process.cwd(), "..", "..", "resources", "skills"),
    path.join(process.cwd(), "resources", "skills"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBundledVersion(): Promise<SkillsVersion | null> {
  const skillsPath = getSkillsBasePath();
  const versionPath = path.join(skillsPath, "version.json");

  try {
    const content = await Bun.file(versionPath).text();
    return JSON.parse(content) as SkillsVersion;
  } catch {
    console.error(`${LOG_PREFIX} Failed to read bundled version from ${versionPath}`);
    return null;
  }
}

async function getProjectVersion(projectPath: string): Promise<string | null> {
  const versionPath = path.join(projectPath, ".claude", VERSION_FILE);

  try {
    const content = await Bun.file(versionPath).text();
    return content.trim();
  } catch {
    return null;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });

  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function needsSkillsInjection(
  projectPath: string
): Promise<boolean> {
  const bundledVersion = await getBundledVersion();
  if (!bundledVersion) {
    console.log(`${LOG_PREFIX} No bundled skills found`);
    return false;
  }

  const projectVersion = await getProjectVersion(projectPath);

  if (!projectVersion) {
    console.log(
      `${LOG_PREFIX} No skills installed in project - injection needed`
    );
    return true;
  }

  if (projectVersion !== bundledVersion.version) {
    console.log(
      `${LOG_PREFIX} Skills version mismatch: project=${projectVersion}, bundled=${bundledVersion.version}`
    );
    return true;
  }

  console.log(
    `${LOG_PREFIX} Skills are up to date (version ${projectVersion})`
  );
  return false;
}

export async function injectSkills(projectPath: string): Promise<void> {
  console.log(`${LOG_PREFIX} Injecting skills into: ${projectPath}`);

  const skillsPath = getSkillsBasePath();
  const bundledVersion = await getBundledVersion();

  if (!bundledVersion) {
    console.error(`${LOG_PREFIX} No bundled skills version found`);
    return;
  }

  // Ensure .claude directory exists
  const claudeDir = path.join(projectPath, ".claude");
  await fsp.mkdir(claudeDir, { recursive: true });

  // Write Claude settings.local.json with permissions
  const settingsPath = path.join(claudeDir, "settings.local.json");
  console.log(
    `${LOG_PREFIX} Writing Claude settings.local.json with latest permissions...`
  );
  await Bun.write(settingsPath, JSON.stringify(CLAUDE_SETTINGS, null, 2));
  console.log(`${LOG_PREFIX} Claude settings written`);

  // Clean stale skills before copying
  const claudeSkillsDest = path.join(projectPath, ".claude", "skills");
  const codexSkillsDest = path.join(projectPath, ".agents", "skills");

  await fsp.rm(claudeSkillsDest, { recursive: true, force: true });
  await fsp.rm(codexSkillsDest, { recursive: true, force: true });

  // Inject Claude skills (flatten nested paths for Claude Code discovery)
  console.log(`${LOG_PREFIX} Copying Claude skills...`);
  for (const skillName of bundledVersion.skills.claude) {
    const src = path.join(skillsPath, skillName);
    const flatName = skillName.replace(/\//g, "-");
    const dest = path.join(claudeSkillsDest, flatName);
    if (fs.existsSync(src)) {
      await copyDir(src, dest);
    } else {
      console.warn(`${LOG_PREFIX} Claude skill not found: ${skillName}`);
    }
  }
  console.log(
    `${LOG_PREFIX} Claude skills copied: ${bundledVersion.skills.claude.join(", ")}`
  );

  // Inject Codex skills
  console.log(`${LOG_PREFIX} Copying Codex skills...`);
  for (const skillName of bundledVersion.skills.codex) {
    const src = path.join(skillsPath, skillName);
    const flatName = skillName.replace(/\//g, "-");
    const dest = path.join(codexSkillsDest, flatName);
    if (fs.existsSync(src)) {
      await copyDir(src, dest);
    } else {
      console.warn(`${LOG_PREFIX} Codex skill not found: ${skillName}`);
    }
  }
  console.log(
    `${LOG_PREFIX} Codex skills copied: ${bundledVersion.skills.codex.join(", ")}`
  );

  // Write version marker
  const versionPath = path.join(projectPath, ".claude", VERSION_FILE);
  await Bun.write(versionPath, bundledVersion.version);
  console.log(
    `${LOG_PREFIX} Version marker written: ${bundledVersion.version}`
  );

  console.log(`${LOG_PREFIX} Skills injection complete`);
}

/**
 * Ensure skills are injected into the project (idempotent).
 * Silently catches errors — skills injection failure should never block project opening.
 */
export async function ensureSkillsInjected(
  projectPath: string
): Promise<void> {
  try {
    if (await needsSkillsInjection(projectPath)) {
      await injectSkills(projectPath);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to inject skills:`, error);
  }
}
