/**
 * Screenshot MCP Server
 *
 * SDK MCP server that lets the AI agent capture screenshots of the preview.
 * Returns the image as MCP image content so the agent can "see" the UI.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { BrowserWindow } from 'electron'
import { capturePreviewScreenshot } from '@/lib/screenshot/capture'

const LOG_PREFIX = '[Screenshot MCP]'

export interface ScreenshotMcpOptions {
  cwd: string
}

interface PreviewInfo {
  url: string | null
  webContentsId: number | null
}

/**
 * Read the current preview URL and webview webContentsId from the renderer.
 * The webContentsId allows capturing the actual webview content (same auth
 * state, same page) instead of loading a fresh window.
 */
async function getPreviewInfoFromRenderer(): Promise<PreviewInfo> {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (win.isDestroyed()) continue
    try {
      const info = await win.webContents.executeJavaScript(
        `({ url: window.__bfloatPreviewUrl || "", webContentsId: window.__bfloatPreviewWebContentsId || 0 })`
      )
      if (info.url) {
        return {
          url: info.url,
          webContentsId: info.webContentsId || null,
        }
      }
    } catch {
      // Window may not have the variables set
    }
  }
  return { url: null, webContentsId: null }
}

export function createScreenshotMcpServer(_options: ScreenshotMcpOptions) {
  console.log(`${LOG_PREFIX} Creating screenshot MCP server`)

  const server = createSdkMcpServer({
    name: 'screenshot',
    version: '1.0.0',
    tools: [
      tool(
        'capture_preview_screenshot',
        'Capture a screenshot of the app preview. Use this to see how the UI currently looks. If no URL is provided, captures the current preview automatically.',
        {
          url: z.string().optional().describe('Explicit URL to capture. If omitted, captures the current preview.'),
          route: z.string().optional().describe('Route to append to the base preview URL (e.g., "/settings")'),
        },
        async (args) => {
          const previewInfo = await getPreviewInfoFromRenderer()
          let targetUrl = args.url
          let webContentsId = previewInfo.webContentsId

          if (!targetUrl) {
            if (!previewInfo.url) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'No preview URL available. The dev server may not be running yet. Wait for the preview to load and try again.',
                  },
                ],
                isError: true,
              }
            }
            targetUrl = previewInfo.url
          }

          // If a route is specified or an explicit URL is given, we can't use the
          // webview capture (it shows a different page), so fall back to URL-based
          if (args.route || args.url) {
            webContentsId = null
          }

          // Append route if specified
          if (args.route) {
            const base = targetUrl.replace(/\/$/, '')
            const route = args.route.startsWith('/') ? args.route : `/${args.route}`
            targetUrl = base + route
          }

          console.log(`${LOG_PREFIX} Capturing preview at: ${targetUrl}${webContentsId ? ` (webContentsId: ${webContentsId})` : ''}`)

          const result = await capturePreviewScreenshot({
            url: targetUrl,
            webContentsId: webContentsId ?? undefined,
          })

          if (!result.success || !result.dataUrl) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to capture screenshot: ${result.error || 'Unknown error'}`,
                },
              ],
              isError: true,
            }
          }

          // Extract base64 data from data URL
          const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '')

          // Notify renderer that a screenshot was captured (for UI feedback)
          const windows = BrowserWindow.getAllWindows()
          windows.forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send('screenshot-captured', { url: targetUrl })
            }
          })

          return {
            content: [
              {
                type: 'image' as const,
                data: base64Data,
                mimeType: 'image/png',
              },
              {
                type: 'text' as const,
                text: `Screenshot captured of ${targetUrl}`,
              },
            ],
          }
        }
      ),
    ],
  })

  return server
}
