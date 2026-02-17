/**
 * MCP server exports.
 *
 * The IDE now uses hosted MCP servers (Stripe, RevenueCat, etc.) directly,
 * so no local server factories are required for those integrations.
 * The terminal MCP server is still needed for agent terminal sessions.
 */

export { createTerminalMcpServer, type TerminalMcpOptions } from './terminal-mcp-server'
export { createScreenshotMcpServer, type ScreenshotMcpOptions } from './screenshot-mcp-server'

// Registry
export { getMcpRegistry, McpServerRegistry } from './registry'
export type { McpServerContext, McpServerDefinition } from './types'
