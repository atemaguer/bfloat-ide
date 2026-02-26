/**
 * Screenshot MCP Server
 *
 * SDK MCP server that provides a `capture_preview_screenshot` tool so the
 * AI agent can visually inspect the app preview. Captures via Chrome headless.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { captureScreenshot, getPreviewUrl } from "./screenshot.ts";

const LOG_PREFIX = "[Screenshot MCP]";

export interface ScreenshotMcpOptions {
  cwd: string;
}

export function createScreenshotMcpServer(options: ScreenshotMcpOptions) {
  console.log(`${LOG_PREFIX} Creating screenshot MCP server for cwd: ${options.cwd}`);

  return createSdkMcpServer({
    name: "screenshot",
    version: "1.0.0",
    tools: [
      tool(
        "capture_preview_screenshot",
        "Capture a screenshot of the app preview. Use this to see how the UI currently looks. If no URL is provided, captures the current preview automatically.",
        {
          url: z.string().optional().describe("Explicit URL to capture. If omitted, captures the current preview."),
          route: z.string().optional().describe('Route to append to the base preview URL (e.g., "/settings")'),
        },
        async (args) => {
          // Resolve the target URL
          let targetUrl = args.url;

          if (!targetUrl) {
            targetUrl = getPreviewUrl(options.cwd);
            if (!targetUrl) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "No preview URL available. The dev server may not be running yet. Wait for the preview to load and try again.",
                  },
                ],
                isError: true,
              };
            }
          }

          // Append route if specified
          if (args.route) {
            const base = targetUrl.replace(/\/$/, "");
            const route = args.route.startsWith("/") ? args.route : `/${args.route}`;
            targetUrl = base + route;
          }

          console.log(`${LOG_PREFIX} Capturing preview at: ${targetUrl}`);

          const result = await captureScreenshot({ url: targetUrl });

          if (!result.success || !result.dataUrl) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to capture screenshot: ${result.error || "Unknown error"}`,
                },
              ],
              isError: true,
            };
          }

          // Extract base64 data from data URL
          const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, "");

          // Guard against empty/degenerate image data
          if (!base64Data || base64Data.length < 100) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Screenshot capture returned an empty image. The preview may not be fully rendered. Try again in a moment.",
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "image" as const,
                data: base64Data,
                mimeType: "image/png",
              },
              {
                type: "text" as const,
                text: `Screenshot captured of ${targetUrl}`,
              },
            ],
          };
        }
      ),
    ],
  });
}
