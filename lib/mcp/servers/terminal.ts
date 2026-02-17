/**
 * Terminal MCP server definition.
 *
 * Wraps the existing createTerminalMcpServer() as a McpServerDefinition.
 * Only available for Claude/Bfloat (SDK in-process server).
 * Codex has native shell execution — no terminal MCP needed.
 */

import type { McpServerDefinition, McpServerContext } from '../types'
import { createTerminalMcpServer } from '../terminal-mcp-server'

export const terminalServer: McpServerDefinition = {
  name: 'terminal',
  requiresAuth: false,

  forClaude(ctx: McpServerContext) {
    return createTerminalMcpServer({ cwd: ctx.cwd, env: ctx.env }) as any
  },

  forCodex() {
    // Codex has native shell execution — no need for a terminal MCP server.
    return null
  },
}
