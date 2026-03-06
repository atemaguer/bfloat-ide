/**
 * Workbench MCP Server
 *
 * Provides app-control tools for the local workbench runtime.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { assessDevServer, getRuntimeState } from "./workbench-runtime.ts";
import { captureScreenshot, getPreviewUrl } from "./screenshot.ts";
import { getRedactedTerminalTail } from "./workbench-verification.ts";

export interface WorkbenchMcpOptions {
  cwd: string;
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
        "restart_app",
        "Restart the current app's dev server using the workbench's built-in restart flow.",
        {
          reason: z
            .string()
            .optional()
            .describe("Optional short reason for why the restart is needed."),
        },
        async (args) => {
          const assessment = await assessDevServer(options.cwd, true);
          const isManagedHealthy =
            assessment.status === "running" || assessment.status === "starting";
          if (isManagedHealthy) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    "Restart blocked: dev server is healthy and managed by the workbench. Use get_dev_server_status first and only restart on error.",
                },
              ],
              isError: true,
            };
          }

          const reasonSuffix =
            typeof args.reason === "string" && args.reason.trim().length > 0
              ? ` Reason: ${args.reason.trim()}`
              : "";

          return {
            content: [
              {
                type: "text" as const,
                text: `Restart requested.${reasonSuffix}`.trim(),
              },
            ],
          };
        }
      ),
    ],
  });
}
