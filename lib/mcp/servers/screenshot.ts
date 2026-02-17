/**
 * Screenshot MCP server definition.
 *
 * Wraps the existing createScreenshotMcpServer() as a McpServerDefinition.
 * Only available for Claude/Bfloat (SDK in-process server).
 * No Codex support — would need a stdio wrapper for Electron APIs.
 */

import type { McpServerDefinition, McpServerContext } from '../types'
import { createScreenshotMcpServer } from '../screenshot-mcp-server'

export const screenshotServer: McpServerDefinition = {
  name: 'screenshot',
  requiresAuth: false,

  forClaude(ctx: McpServerContext) {
    return createScreenshotMcpServer({ cwd: ctx.cwd }) as any
  },

  forCodex() {
    // Codex runs out-of-process — can't access Electron webContents for screenshots.
    return null
  },
}
