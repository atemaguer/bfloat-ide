import * as fs from "node:fs";
import * as path from "node:path";

export type DetectedFramework =
  | "expo"
  | "react-native"
  | "next"
  | "vite"
  | "remix"
  | "react-web"
  | "unknown";

export interface WorkspaceProfile {
  cwd: string;
  hasPackageJson: boolean;
  hasAppSource: boolean;
  hasFrameworkMarkers: boolean;
  isEffectivelyEmpty: boolean;
  isExistingApp: boolean;
  isTemplateBootstrap: boolean;
  designMode: "greenfield-template" | "adapt-existing";
  detectedFramework: DetectedFramework;
  reasons: string[];
}

export interface ScaffoldBlockDecision {
  shouldBlock: boolean;
  command: string;
  reason?: string;
}

const TOOL_DIRS = new Set([
  ".git",
  ".bfloat-ide",
  ".bfloat",
  ".claude",
  ".agents",
  "node_modules",
  ".vscode",
  ".idea",
  ".DS_Store",
]);

const APP_SOURCE_MARKERS = [
  "app",
  "src",
  "pages",
  "components",
  "app.json",
  "eas.json",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "remix.config.js",
  "remix.config.mjs",
] as const;

const PROJECT_ORIGIN_MARKER = path.join(".bfloat-ide", "project-origin.json");

const SCAFFOLD_COMMAND_PATTERNS: RegExp[] = [
  /\bnpx\s+create-expo-app(?:@latest)?\b/i,
  /\bnpm\s+create\s+expo(?:@latest)?\b/i,
  /\bpnpm\s+create\s+expo(?:@latest)?\b/i,
  /\bbunx?\s+create-expo-app(?:@latest)?\b/i,
  /\bnpx\s+create-next-app(?:@latest)?\b/i,
  /\bnpm\s+create\s+next-app(?:@latest)?\b/i,
  /\bpnpm\s+create\s+next-app(?:@latest)?\b/i,
  /\bbunx?\s+create-next-app(?:@latest)?\b/i,
  /\bnpm\s+create\s+vite(?:@latest)?\b/i,
  /\bpnpm\s+create\s+vite(?:@latest)?\b/i,
  /\byarn\s+create\s+vite(?:@latest)?\b/i,
  /\bbunx?\s+create-vite(?:@latest)?\b/i,
];

function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStringProperty(
  obj: Record<string, unknown> | null,
  key: string
): string | null {
  const value = obj?.[key];
  return typeof value === "string" ? value : null;
}

function isTemplateBootstrapWorkspace(cwd: string): boolean {
  const markerPath = path.join(cwd, PROJECT_ORIGIN_MARKER);
  const marker = safeReadJson(markerPath);
  return marker?.origin === "template-bootstrap";
}

function looksLikeStarterTemplateWorkspace(
  cwd: string,
  packageJson: Record<string, unknown> | null
): boolean {
  const packageName = readStringProperty(packageJson, "name");
  if (packageName === "expo-template-default" || packageName === "nextjs-app") {
    return true;
  }

  const scripts = (packageJson?.scripts as Record<string, unknown> | undefined) || {};
  if (typeof scripts["reset-project"] === "string") {
    return true;
  }

  const starterMarkers = [
    path.join("app", "(tabs)", "index.tsx"),
    path.join("app", "(tabs)", "_layout.tsx"),
    path.join("components", "themed-text.tsx"),
    path.join("components", "parallax-scroll-view.tsx"),
    path.join("scripts", "reset-project.js"),
  ];

  return starterMarkers.some((marker) => fs.existsSync(path.join(cwd, marker)));
}

function getDependencies(pkg: Record<string, unknown> | null): Record<string, unknown> {
  if (!pkg) return {};
  const deps = pkg.dependencies as Record<string, unknown> | undefined;
  const devDeps = pkg.devDependencies as Record<string, unknown> | undefined;
  return { ...(deps || {}), ...(devDeps || {}) };
}

function detectFrameworkFromDependencies(deps: Record<string, unknown>): DetectedFramework {
  if (deps.expo) return "expo";
  if (deps["react-native"]) return "react-native";
  if (deps.next) return "next";
  if (deps.vite || deps["@vitejs/plugin-react"]) return "vite";
  if (deps["@remix-run/react"] || deps["@remix-run/node"]) return "remix";
  if (deps.react && deps["react-dom"]) return "react-web";
  return "unknown";
}

export function buildWorkspaceProfile(cwd: string): WorkspaceProfile {
  const reasons: string[] = [];
  const packageJsonPath = path.join(cwd, "package.json");
  const hasPackageJson = fs.existsSync(packageJsonPath);
  const packageJson = hasPackageJson ? safeReadJson(packageJsonPath) : null;
  const deps = getDependencies(packageJson);

  const detectedFramework = detectFrameworkFromDependencies(deps);
  if (detectedFramework !== "unknown") {
    reasons.push(`framework:${detectedFramework}`);
  }

  const entries = fs.existsSync(cwd) ? fs.readdirSync(cwd, { withFileTypes: true }) : [];
  const meaningfulEntries = entries.filter((entry) => !TOOL_DIRS.has(entry.name));
  const isEffectivelyEmpty = meaningfulEntries.length === 0;
  if (isEffectivelyEmpty) {
    reasons.push("effectively-empty");
  }

  const hasAppSource = APP_SOURCE_MARKERS.some((marker) => fs.existsSync(path.join(cwd, marker)));
  if (hasAppSource) {
    reasons.push("app-source-markers");
  }

  const hasFrameworkMarkers = detectedFramework !== "unknown" || hasAppSource;
  const isExistingApp = !isEffectivelyEmpty && (hasPackageJson || hasFrameworkMarkers);
  const hasTemplateOriginMarker = isTemplateBootstrapWorkspace(cwd);
  const hasStarterTemplateSignature = looksLikeStarterTemplateWorkspace(cwd, packageJson);
  const isTemplateBootstrap = hasTemplateOriginMarker || hasStarterTemplateSignature;
  const designMode = isTemplateBootstrap ? "greenfield-template" : "adapt-existing";

  if (hasPackageJson) {
    reasons.push("package.json");
  }
  if (!isEffectivelyEmpty) {
    reasons.push("non-empty-workspace");
  }
  if (isTemplateBootstrap) {
    if (hasTemplateOriginMarker) {
      reasons.push("origin:template-bootstrap-marker");
    } else {
      reasons.push("origin:template-bootstrap-signature");
    }
  } else {
    reasons.push("origin:unknown-or-imported");
  }

  return {
    cwd,
    hasPackageJson,
    hasAppSource,
    hasFrameworkMarkers,
    isEffectivelyEmpty,
    isExistingApp,
    isTemplateBootstrap,
    designMode,
    detectedFramework,
    reasons,
  };
}

export function shouldBlockScaffoldCommand(
  command: string,
  profile: WorkspaceProfile
): ScaffoldBlockDecision {
  const normalizedCommand = command.trim();
  const isScaffoldCommand = SCAFFOLD_COMMAND_PATTERNS.some((pattern) => pattern.test(normalizedCommand));

  if (!isScaffoldCommand) {
    return { shouldBlock: false, command: normalizedCommand };
  }

  if (!profile.isExistingApp) {
    return { shouldBlock: false, command: normalizedCommand };
  }

  return {
    shouldBlock: true,
    command: normalizedCommand,
    reason: `existing workspace markers: ${profile.reasons.join(", ")}`,
  };
}
