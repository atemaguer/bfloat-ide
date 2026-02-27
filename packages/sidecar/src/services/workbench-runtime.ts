import { URL } from "node:url";

export type RuntimeServerStatus = "starting" | "running" | "error" | "unknown";
export type RuntimeAppType = "web" | "mobile";

export interface WorkbenchRuntimeState {
  cwd: string;
  serverStatus: RuntimeServerStatus;
  previewUrl?: string;
  port?: number;
  expoUrl?: string;
  appType?: RuntimeAppType;
  devServerTerminalId?: string;
  updatedAt: number;
}

export interface DevServerChecks {
  portBound: boolean | null;
  httpReachable: boolean | null;
  stale: boolean;
}

export interface DevServerAssessment {
  status: RuntimeServerStatus;
  shouldStartServer: boolean;
  shouldRestartServer: boolean;
  reason: string;
  metadata: WorkbenchRuntimeState;
  checks: DevServerChecks;
}

const STALE_AFTER_MS = 15_000;
const HTTP_CHECK_TIMEOUT_MS = 1_500;

const runtimeStates = new Map<string, WorkbenchRuntimeState>();

function parsePortFromUrl(urlValue?: string): number | undefined {
  if (!urlValue) return undefined;
  try {
    const parsed = new URL(urlValue);
    const port = parsed.port ? parseInt(parsed.port, 10) : undefined;
    if (!port || Number.isNaN(port) || port < 1 || port > 65535) return undefined;
    return port;
  } catch {
    return undefined;
  }
}

function normalizeStatus(status?: string): RuntimeServerStatus {
  if (status === "running" || status === "starting" || status === "error") {
    return status;
  }
  return "unknown";
}

function baseState(cwd: string): WorkbenchRuntimeState {
  return {
    cwd,
    serverStatus: "unknown",
    updatedAt: Date.now(),
  };
}

export function upsertRuntimeState(
  state: Partial<WorkbenchRuntimeState> & { cwd: string }
): WorkbenchRuntimeState {
  const existing = runtimeStates.get(state.cwd) ?? baseState(state.cwd);

  const next: WorkbenchRuntimeState = {
    ...existing,
    ...state,
    serverStatus: normalizeStatus(state.serverStatus ?? existing.serverStatus),
    updatedAt: Date.now(),
  };

  if (!next.port) {
    const inferredPort = parsePortFromUrl(next.previewUrl);
    if (inferredPort) next.port = inferredPort;
  }

  runtimeStates.set(state.cwd, next);
  return next;
}

export function getRuntimeState(cwd: string): WorkbenchRuntimeState | null {
  return runtimeStates.get(cwd) ?? null;
}

async function isPortBound(port: number): Promise<boolean | null> {
  try {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("probe");
      },
    });
    server.stop(true);
    return false;
  } catch {
    return true;
  }
}

async function isHttpReachable(urlValue: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(urlValue, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function assessDevServer(
  cwd: string,
  includeChecks: boolean = true
): Promise<DevServerAssessment> {
  const metadata = getRuntimeState(cwd) ?? baseState(cwd);
  const stale = Date.now() - metadata.updatedAt > STALE_AFTER_MS;

  let portBound: boolean | null = null;
  let httpReachable: boolean | null = null;

  if (includeChecks) {
    if (metadata.port) {
      portBound = await isPortBound(metadata.port);
    }
    if (metadata.previewUrl) {
      httpReachable = await isHttpReachable(metadata.previewUrl);
    }
  }

  let status: RuntimeServerStatus = metadata.serverStatus;
  let reason = "runtime state reported by workbench";

  if (stale) {
    status = "unknown";
    reason = "runtime metadata is stale";
  } else if (metadata.serverStatus === "running") {
    if (httpReachable === false || portBound === false) {
      status = "error";
      reason = "runtime marked running but health checks failed";
    } else {
      reason = "runtime and health checks indicate server is healthy";
    }
  } else if (metadata.serverStatus === "starting") {
    reason = "server is currently starting";
  } else if (metadata.serverStatus === "error") {
    reason = "runtime reported server error";
  } else {
    reason = "runtime state is unknown";
  }

  const shouldStartServer = status === "unknown" || status === "error";
  const shouldRestartServer = status === "error";

  return {
    status,
    shouldStartServer,
    shouldRestartServer,
    reason,
    metadata,
    checks: {
      portBound,
      httpReachable,
      stale,
    },
  };
}
