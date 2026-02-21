/**
 * MCP server exports.
 *
 * The IDE uses hosted MCP servers (Stripe, RevenueCat, etc.) configured
 * via the MCP registry. Terminal and screenshot MCP servers have been
 * moved to the sidecar process.
 */

// Registry
export { getMcpRegistry, McpServerRegistry } from './registry'
export type { McpServerContext, McpServerDefinition } from './types'
