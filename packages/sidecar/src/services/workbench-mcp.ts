/**
 * Workbench MCP Server
 *
 * Provides app-control tools for the local workbench runtime.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { assessDevServer, getRuntimeState } from "./workbench-runtime.ts";

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
