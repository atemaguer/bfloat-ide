/**
 * Workbench MCP Server
 *
 * Provides app-control tools for the local workbench runtime.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { assessDevServer, getRuntimeState } from "./workbench-runtime.ts";
import { captureScreenshot, getPreviewUrl } from "./screenshot.ts";
import {
  getRedactedTerminalTail,
  getRedactedTerminalTailForTerminalId,
} from "./workbench-verification.ts";
import { listTerminalSessionsForCwd } from "../routes/terminal.ts";

export interface WorkbenchMcpOptions {
  cwd: string;
}

type AppLifecycleAction = "already_running" | "already_stopped" | "start_requested" | "stop_requested";

async function evaluateStartApp(cwd: string): Promise<{
  action: AppLifecycleAction;
  assessment: Awaited<ReturnType<typeof assessDevServer>>;
}> {
  const assessment = await assessDevServer(cwd, true);
  const isManagedHealthy =
    assessment.status === "running" || assessment.status === "starting";
  return {
    action: isManagedHealthy ? "already_running" : "start_requested",
    assessment,
  };
}

async function evaluateStopApp(cwd: string): Promise<{
  action: AppLifecycleAction;
  assessment: Awaited<ReturnType<typeof assessDevServer>>;
}> {
  const assessment = await assessDevServer(cwd, true);
  const isManagedHealthy =
    assessment.status === "running" || assessment.status === "starting";
  return {
    action: isManagedHealthy ? "stop_requested" : "already_stopped",
    assessment,
  };
}

export function createWorkbenchMcpServer(options: WorkbenchMcpOptions) {
  return createSdkMcpServer({
    name: "workbench",
    version: "1.0.0",
    tools: [
      tool(
        "get_dev_server_status",
        "Get managed dev server status for this project, including port, preview URL, health checks, and whether start/restart is needed.",
        {
          include_checks: z
            .boolean()
            .optional()
            .default(true)
            .describe("Run active health checks (port binding and HTTP reachability)."),
          require_healthy: z
            .boolean()
            .optional()
            .default(false)
            .describe("If true, return an error when the server is not healthy."),
        },
        async (args) => {
          const assessment = await assessDevServer(options.cwd, args.include_checks);
          const runtime = getRuntimeState(options.cwd);
          const isManagedHealthy =
            assessment.status === "running" || assessment.status === "starting";

          const payload = {
            cwd: options.cwd,
            status: assessment.status,
            reason: assessment.reason,
            shouldStartServer: assessment.shouldStartServer,
            shouldRestartServer: assessment.shouldRestartServer,
            checks: assessment.checks,
            metadata: runtime,
          };

          if (args.require_healthy && !isManagedHealthy) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dev server is not healthy.\n${JSON.stringify(payload, null, 2)}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "get_app_logs",
        "Get recent redacted terminal logs from the active dev-server terminal for this project.",
        {
          require_logs: z
            .boolean()
            .optional()
            .default(true)
            .describe("Fail the tool call if logs cannot be collected."),
          log_max_chars: z
            .number()
            .int()
            .min(200)
            .max(20_000)
            .optional()
            .default(6_000)
            .describe("Maximum number of terminal log characters to return."),
        },
        async (args) => {
          const checkedAt = new Date().toISOString();
          const runtime = getRuntimeState(options.cwd);
          const logPayload = getRedactedTerminalTail(options.cwd, args.log_max_chars);

          const payload = {
            cwd: options.cwd,
            checkedAt,
            terminalId: logPayload.terminalId ?? null,
            source: logPayload.source,
            warning: logPayload.warning ?? null,
            chars: logPayload.logChars ?? 0,
            redactionCount: logPayload.redactionCount ?? 0,
            text: logPayload.logText ?? "",
            runtime: runtime ?? null,
          };

          if (args.require_logs && !logPayload.logText) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(payload, null, 2),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "list_terminals",
        "List active terminal sessions for this project and identify the runtime-linked terminal.",
        {},
        async () => {
          const runtime = getRuntimeState(options.cwd);
          const sessions = listTerminalSessionsForCwd(options.cwd);
          const runtimeTerminalId = runtime?.devServerTerminalId ?? null;

          const payload = {
            cwd: options.cwd,
            checkedAt: new Date().toISOString(),
            runtimeTerminalId,
            runtimeTerminalActive:
              runtimeTerminalId !== null &&
              sessions.some((session) => session.id === runtimeTerminalId),
            count: sessions.length,
            sessions,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "get_terminal_output",
        "Get recent redacted output from a terminal session. Defaults to the runtime-resolved dev-server terminal.",
        {
          terminal_id: z
            .string()
            .optional()
            .describe(
              "Specific terminal session ID. If omitted, resolves from runtime devServerTerminalId with cwd fallback."
            ),
          require_output: z
            .boolean()
            .optional()
            .default(true)
            .describe("Fail the tool call if terminal output cannot be collected."),
          max_chars: z
            .number()
            .int()
            .min(200)
            .max(20_000)
            .optional()
            .default(6_000)
            .describe("Maximum number of terminal output characters to return."),
        },
        async (args) => {
          const checkedAt = new Date().toISOString();
          const runtime = getRuntimeState(options.cwd);

          const terminalPayload = args.terminal_id
            ? getRedactedTerminalTailForTerminalId(args.terminal_id, args.max_chars)
            : getRedactedTerminalTail(options.cwd, args.max_chars);

          const payload = {
            cwd: options.cwd,
            checkedAt,
            requestedTerminalId: args.terminal_id ?? null,
            terminalId: terminalPayload.terminalId ?? null,
            source: terminalPayload.source,
            warning: terminalPayload.warning ?? null,
            chars: terminalPayload.logChars ?? 0,
            redactionCount: terminalPayload.redactionCount ?? 0,
            text: terminalPayload.logText ?? "",
            runtime: runtime ?? null,
          };

          if (args.require_output && !terminalPayload.logText) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(payload, null, 2),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "verify_app_state",
        "Capture one-shot app verification evidence: managed runtime status, recent redacted terminal logs, and a fresh preview screenshot.",
        {
          include_logs: z
            .boolean()
            .optional()
            .default(true)
            .describe("Include recent terminal output from the active dev-server terminal."),
          include_screenshot: z
            .boolean()
            .optional()
            .default(true)
            .describe("Include a fresh screenshot of the current preview."),
          require_logs: z
            .boolean()
            .optional()
            .default(true)
            .describe("Fail the tool call if logs cannot be collected."),
          require_screenshot: z
            .boolean()
            .optional()
            .default(true)
            .describe("Fail the tool call if screenshot capture fails."),
          route: z
            .string()
            .optional()
            .describe('Optional route to append to preview URL (e.g. "/settings").'),
          log_max_chars: z
            .number()
            .int()
            .min(200)
            .max(20_000)
            .optional()
            .default(6_000)
            .describe("Maximum number of terminal log characters to return."),
        },
        async (args) => {
          const checkedAt = new Date().toISOString();
          const assessment = await assessDevServer(options.cwd, true);
          const runtime = getRuntimeState(options.cwd);

          const evidence: {
            logs?: Record<string, unknown>;
            screenshot?: Record<string, unknown>;
          } = {};
          const failures: Array<{ code: string; message: string }> = [];

          if (args.include_logs) {
            const logPayload = getRedactedTerminalTail(options.cwd, args.log_max_chars);
            evidence.logs = {
              terminalId: logPayload.terminalId ?? null,
              source: logPayload.source,
              warning: logPayload.warning ?? null,
              chars: logPayload.logChars ?? 0,
              redactionCount: logPayload.redactionCount ?? 0,
              text: logPayload.logText ?? "",
              checkedAt,
            };

            if (args.require_logs && !logPayload.logText) {
              failures.push({
                code: "logs_unavailable",
                message:
                  logPayload.warning ??
                  "Terminal logs could not be resolved for this runtime.",
              });
            }
          }

          let screenshotImage:
            | { type: "image"; data: string; mimeType: "image/png" }
            | null = null;

          if (args.include_screenshot) {
            let previewUrl = runtime?.previewUrl ?? getPreviewUrl(options.cwd);
            if (previewUrl && args.route) {
              const base = previewUrl.replace(/\/$/, "");
              const route = args.route.startsWith("/") ? args.route : `/${args.route}`;
              previewUrl = `${base}${route}`;
            }

            if (!previewUrl) {
              evidence.screenshot = {
                success: false,
                error:
                  "No preview URL available. Start or refresh preview before verification.",
                checkedAt,
              };
              if (args.require_screenshot) {
                failures.push({
                  code: "preview_url_missing",
                  message:
                    "Screenshot verification failed: no preview URL is available for this project.",
                });
              }
            } else {
              const isMobileRuntime = runtime?.appType === "mobile";
              const screenshotResult = await captureScreenshot({
                url: previewUrl,
                mobile: isMobileRuntime,
                width: isMobileRuntime ? 390 : undefined,
                height: isMobileRuntime ? 844 : undefined,
                deviceScaleFactor: isMobileRuntime ? 2 : undefined,
              });

              if (!screenshotResult.success || !screenshotResult.dataUrl) {
                evidence.screenshot = {
                  success: false,
                  url: previewUrl,
                  error: screenshotResult.error ?? "Unknown screenshot error.",
                  checkedAt,
                };
                if (args.require_screenshot) {
                  failures.push({
                    code: "screenshot_failed",
                    message:
                      `Screenshot verification failed for ${previewUrl}: ` +
                      `${screenshotResult.error ?? "Unknown error."}`,
                  });
                }
              } else {
                const base64Data = screenshotResult.dataUrl.replace(
                  /^data:image\/png;base64,/,
                  ""
                );
                evidence.screenshot = {
                  success: true,
                  url: previewUrl,
                  appType: runtime?.appType ?? null,
                  bytes: Math.floor((base64Data.length * 3) / 4),
                  checkedAt,
                };
                screenshotImage = {
                  type: "image",
                  data: base64Data,
                  mimeType: "image/png",
                };
              }
            }
          }

          const payload = {
            cwd: options.cwd,
            checkedAt,
            status: failures.length > 0 ? "failed" : "ok",
            runtime: {
              status: assessment.status,
              reason: assessment.reason,
              shouldStartServer: assessment.shouldStartServer,
              shouldRestartServer: assessment.shouldRestartServer,
              checks: assessment.checks,
              metadata: runtime,
            },
            evidence,
            failures,
          };

          const content: Array<
            | { type: "text"; text: string }
            | { type: "image"; data: string; mimeType: "image/png" }
          > = [];

          if (screenshotImage) {
            content.push(screenshotImage);
          }
          content.push({
            type: "text",
            text: JSON.stringify(payload, null, 2),
          });

          if (failures.length > 0) {
            return {
              content,
              isError: true,
            };
          }

          return { content };
        }
      ),
      tool(
        "stop_app",
        "Request stopping the current app's dev server. Idempotent: returns already_stopped when no active managed server is running.",
        {
          reason: z
            .string()
            .optional()
            .describe("Optional short reason for why stopping the app is needed."),
        },
        async (args) => {
          const { action, assessment } = await evaluateStopApp(options.cwd);
          const reasonSuffix =
            typeof args.reason === "string" && args.reason.trim().length > 0
              ? ` Reason: ${args.reason.trim()}`
              : "";
          const payload = {
            cwd: options.cwd,
            checkedAt: new Date().toISOString(),
            action,
            reason: reasonSuffix ? args.reason?.trim() : null,
            status: assessment.status,
            shouldStartServer: assessment.shouldStartServer,
            shouldRestartServer: assessment.shouldRestartServer,
            checks: assessment.checks,
            metadata: assessment.metadata,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "start_app",
        "Request starting the current app's dev server. Idempotent: returns already_running when the managed server is healthy.",
        {
          reason: z
            .string()
            .optional()
            .describe("Optional short reason for why starting the app is needed."),
        },
        async (args) => {
          const { action, assessment } = await evaluateStartApp(options.cwd);
          const reasonSuffix =
            typeof args.reason === "string" && args.reason.trim().length > 0
              ? ` Reason: ${args.reason.trim()}`
              : "";
          const payload = {
            cwd: options.cwd,
            checkedAt: new Date().toISOString(),
            action,
            reason: reasonSuffix ? args.reason?.trim() : null,
            status: assessment.status,
            shouldStartServer: assessment.shouldStartServer,
            shouldRestartServer: assessment.shouldRestartServer,
            checks: assessment.checks,
            metadata: assessment.metadata,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "restart_app",
        "Restart the current app's dev server by composing stop_app then start_app checks without failing on healthy/already-stopped states.",
        {
          reason: z
            .string()
            .optional()
            .describe("Optional short reason for why the restart is needed."),
        },
        async (args) => {
          const stop = await evaluateStopApp(options.cwd);
          const start = await evaluateStartApp(options.cwd);
          const reason =
            typeof args.reason === "string" && args.reason.trim().length > 0
              ? args.reason.trim()
              : null;
          const payload = {
            cwd: options.cwd,
            checkedAt: new Date().toISOString(),
            reason,
            steps: [
              { name: "stop_app", action: stop.action, status: stop.assessment.status },
              { name: "start_app", action: start.action, status: start.assessment.status },
            ],
            status: "restart_requested",
            message:
              "Restart flow requested. Use get_dev_server_status after this call to confirm runtime health.",
            assessments: {
              stop: {
                shouldStartServer: stop.assessment.shouldStartServer,
                shouldRestartServer: stop.assessment.shouldRestartServer,
                checks: stop.assessment.checks,
                metadata: stop.assessment.metadata,
              },
              start: {
                shouldStartServer: start.assessment.shouldStartServer,
                shouldRestartServer: start.assessment.shouldRestartServer,
                checks: start.assessment.checks,
                metadata: start.assessment.metadata,
              },
            },
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        }
      ),
    ],
  });
}
