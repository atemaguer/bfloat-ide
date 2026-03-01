/**
 * Screenshot Capture Service
 *
 * Captures screenshots of localhost preview URLs using a persistent headless
 * Chrome instance controlled via the Chrome DevTools Protocol (CDP) over
 * WebSocket. The browser is lazily launched on first capture and reused for
 * subsequent requests, avoiding the ~2-3s cold start of spawning a new Chrome
 * process per capture.
 *
 * No npm dependencies — uses system Chrome + native WebSocket + child_process.
 *
 * Also maintains a preview URL registry so the MCP tool can look up the current
 * preview URL for a given project working directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const LOG_PREFIX = "[Screenshot]";

// ---------------------------------------------------------------------------
// Preview URL registry
// ---------------------------------------------------------------------------

/** Maps project cwd → preview URL */
const previewUrls = new Map<string, string>();

export function registerPreviewUrl(cwd: string, url: string): void {
  previewUrls.set(cwd, url);
  console.log(`${LOG_PREFIX} Registered preview URL for ${cwd}: ${url}`);
}

export function getPreviewUrl(cwd: string): string | undefined {
  return previewUrls.get(cwd);
}

// ---------------------------------------------------------------------------
// Chrome binary detection (searched once, cached)
// ---------------------------------------------------------------------------

let cachedChromePath: string | null = null;

function findChromeBinary(): string | null {
  const platform = process.platform;

  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
  } else if (platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    );
  } else if (platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    candidates.push(
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`${LOG_PREFIX} Found Chrome at: ${candidate}`);
      return candidate;
    }
  }

  console.warn(`${LOG_PREFIX} Chrome binary not found. Checked: ${candidates.join(", ")}`);
  return null;
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

let chromeProcess: ChildProcess | null = null;
let wsEndpoint: string | null = null;
let msgIdCounter = 1;

/**
 * Send a CDP command over a WebSocket and wait for the response.
 */
function cdpSend(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const id = msgIdCounter++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`CDP command '${method}' timed out after 15s`));
    }, 15_000);

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data));
      if (data.id === id) {
        ws.removeEventListener("message", handler);
        clearTimeout(timeout);
        if (data.error) {
          reject(new Error(`CDP error: ${data.error.message}`));
        } else {
          resolve(data.result ?? {});
        }
      }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/**
 * Wait for a specific CDP event.
 */
function cdpWaitForEvent(
  ws: WebSocket,
  eventName: string,
  timeoutMs: number = 15_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`CDP event '${eventName}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data));
      if (data.method === eventName) {
        ws.removeEventListener("message", handler);
        clearTimeout(timeout);
        resolve(data.params ?? {});
      }
    };

    ws.addEventListener("message", handler);
  });
}

// ---------------------------------------------------------------------------
// Persistent Chrome instance
// ---------------------------------------------------------------------------

async function ensureChrome(): Promise<string> {
  if (chromeProcess && !chromeProcess.killed && wsEndpoint) {
    return wsEndpoint;
  }

  // Clean up stale state
  await shutdownBrowser();

  if (!cachedChromePath) {
    cachedChromePath = findChromeBinary();
  }
  if (!cachedChromePath) {
    throw new Error("Chrome/Chromium not found. Install Google Chrome to enable screenshots.");
  }

  // Use a random port to avoid collisions
  const debugPort = 9222 + Math.floor(Math.random() * 1000);

  console.log(`${LOG_PREFIX} Launching persistent headless Chrome on debug port ${debugPort}...`);

  const userDataDir = path.join(os.tmpdir(), `bfloat-chrome-${Date.now()}`);

  chromeProcess = spawn(cachedChromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  chromeProcess.on("exit", (code, signal) => {
    console.log(`${LOG_PREFIX} Chrome exited (code=${code} signal=${signal})`);
    chromeProcess = null;
    wsEndpoint = null;
  });

  // Wait for Chrome to print the DevTools WebSocket URL to stderr
  wsEndpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Chrome failed to start within 10s"));
    }, 10_000);

    let stderrBuf = "";

    chromeProcess!.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      // Chrome prints: DevTools listening on ws://127.0.0.1:PORT/devtools/browser/UUID
      const match = stderrBuf.match(/ws:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });

    chromeProcess!.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Chrome: ${err.message}`));
    });

    chromeProcess!.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited prematurely with code ${code}`));
    });
  });

  console.log(`${LOG_PREFIX} Chrome ready at ${wsEndpoint} (pid=${chromeProcess.pid})`);
  return wsEndpoint;
}

// ---------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  url: string;
  width?: number;
  height?: number;
  mobile?: boolean;
  deviceScaleFactor?: number;
  /** Extra delay (ms) after page load before capturing. Default: 500 */
  renderDelay?: number;
}

export interface CaptureResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export async function captureScreenshot(options: CaptureOptions): Promise<CaptureResult> {
  const isMobile = options.mobile ?? false;
  const width = Math.max(1, Math.round(options.width ?? (isMobile ? 390 : 1280)));
  const height = Math.max(1, Math.round(options.height ?? (isMobile ? 844 : 800)));
  const deviceScaleFactor = options.deviceScaleFactor ?? (isMobile ? 2 : 1);
  const renderDelay = options.renderDelay ?? 500;

  try {
    const browserWsUrl = await ensureChrome();

    // Create a new target (tab)
    const createTargetWs = new WebSocket(browserWsUrl);
    await new Promise<void>((resolve, reject) => {
      createTargetWs.addEventListener("open", () => resolve());
      createTargetWs.addEventListener("error", (e) => reject(new Error(`WebSocket error: ${e}`)));
    });

    const targetResult = await cdpSend(createTargetWs, "Target.createTarget", {
      url: "about:blank",
    });
    const targetId = targetResult.targetId as string;

    // Get the page's WebSocket debugger URL
    const response = await fetch(`http://127.0.0.1:${new URL(browserWsUrl).port}/json`);
    const targets = (await response.json()) as Array<{
      id: string;
      webSocketDebuggerUrl: string;
    }>;
    const target = targets.find((t) => t.id === targetId);
    if (!target) throw new Error("Could not find created target");

    // Connect to the page
    const pageWs = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      pageWs.addEventListener("open", () => resolve());
      pageWs.addEventListener("error", (e) => reject(new Error(`Page WebSocket error: ${e}`)));
    });

    try {
      // Set viewport
      await cdpSend(pageWs, "Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor,
        mobile: isMobile,
      });

      // Enable page events so we can wait for load
      await cdpSend(pageWs, "Page.enable");

      // Navigate
      const loadPromise = cdpWaitForEvent(pageWs, "Page.loadEventFired", 15_000);
      await cdpSend(pageWs, "Page.navigate", { url: options.url });
      await loadPromise;

      // Small extra wait for rendering to settle
      await new Promise((r) => setTimeout(r, renderDelay));

      // Capture screenshot
      const screenshotResult = await cdpSend(pageWs, "Page.captureScreenshot", {
        format: "png",
      });

      const base64 = screenshotResult.data as string;
      const dataUrl = `data:image/png;base64,${base64}`;

      console.log(`${LOG_PREFIX} Captured screenshot of ${options.url}`);
      return { success: true, dataUrl };
    } finally {
      // Close the tab
      pageWs.close();
      await cdpSend(createTargetWs, "Target.closeTarget", { targetId }).catch(() => {});
      createTargetWs.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Capture failed:`, message);

    // If Chrome died, clear state so next call re-launches
    if (chromeProcess?.killed || !chromeProcess) {
      wsEndpoint = null;
    }

    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export async function shutdownBrowser(): Promise<void> {
  if (chromeProcess) {
    console.log(`${LOG_PREFIX} Shutting down headless Chrome (pid=${chromeProcess.pid})...`);
    try {
      chromeProcess.kill("SIGTERM");
    } catch {
      // Process may already be gone
    }
    chromeProcess = null;
    wsEndpoint = null;
  }
}
