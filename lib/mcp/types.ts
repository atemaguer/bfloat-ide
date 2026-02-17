/**
 * Shared MCP types for the server registry.
 */

import type { McpServerConfig } from '@/lib/agents/types'

/** Context passed to server definitions when building provider-specific configs. */
export interface McpServerContext {
  cwd: string
  env?: Record<string, string>
  authToken?: string
}

/**
 * A single MCP server definition that knows how to produce
 * provider-specific configuration objects.
 */
export interface McpServerDefinition {
  /** Unique server name (e.g. 'terminal', 'stripe'). */
  name: string

  /** Whether an auth token is required to configure this server. */
  requiresAuth: boolean

  /**
   * Build an MCP server config for the Claude / Bfloat provider (SDK-based).
   * Return `null` if the server is unavailable for this provider or context.
   */
  forClaude(ctx: McpServerContext): Promise<McpServerConfig | null> | McpServerConfig | null

  /**
   * Build an MCP server config for the Codex provider (CLI-based).
   * Return `null` if the server is unavailable for this provider or context.
   */
  forCodex(ctx: McpServerContext): Promise<McpServerConfig | null> | McpServerConfig | null
}
