/**
 * MCP Server Registry
 *
 * Central registry that manages all MCP server definitions and produces
 * provider-specific configurations for Claude, Codex, and Bfloat sessions.
 */

import type { McpServerConfig, AgentProviderId } from '@/lib/agents/types'
import type { McpServerDefinition, McpServerContext } from './types'

// Server definitions
import { terminalServer } from './servers/terminal'
import { stripeServer } from './servers/stripe'
import { revenuecatServer } from './servers/revenuecat'

const LOG_PREFIX = '[MCP Registry]'

export class McpServerRegistry {
  private servers: McpServerDefinition[] = []

  /** Register a server definition. */
  register(server: McpServerDefinition): void {
    this.servers.push(server)
    console.log(`${LOG_PREFIX} Registered server: ${server.name}`)
  }

  /** Build MCP server configs for the Claude / Bfloat provider. */
  async getServersForClaude(
    ctx: McpServerContext
  ): Promise<Record<string, McpServerConfig>> {
    const result: Record<string, McpServerConfig> = {}

    for (const server of this.servers) {
      if (server.requiresAuth && !ctx.authToken) continue
      const config = await server.forClaude(ctx)
      if (config) {
        result[server.name] = config
      }
    }

    console.log(`${LOG_PREFIX} Claude servers: ${Object.keys(result).join(', ') || '(none)'}`)
    return result
  }

  /** Build MCP server configs for the Codex provider. */
  async getServersForCodex(
    ctx: McpServerContext
  ): Promise<Record<string, McpServerConfig>> {
    const result: Record<string, McpServerConfig> = {}

    for (const server of this.servers) {
      if (server.requiresAuth && !ctx.authToken) continue
      const config = await server.forCodex(ctx)
      if (config) {
        result[server.name] = config
      }
    }

    console.log(`${LOG_PREFIX} Codex servers: ${Object.keys(result).join(', ') || '(none)'}`)
    return result
  }

  /**
   * Dispatch to the correct provider method.
   * 'bfloat' is treated as Claude (same SDK-based runtime).
   */
  async getServersForProvider(
    providerId: AgentProviderId,
    ctx: McpServerContext
  ): Promise<Record<string, McpServerConfig>> {
    if (providerId === 'codex') {
      return this.getServersForCodex(ctx)
    }
    return this.getServersForClaude(ctx)
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let _registry: McpServerRegistry | undefined

/** Get (or create) the singleton MCP server registry with all servers registered. */
export function getMcpRegistry(): McpServerRegistry {
  if (!_registry) {
    _registry = new McpServerRegistry()
    _registry.register(terminalServer)
    _registry.register(stripeServer)
    _registry.register(revenuecatServer)
  }
  return _registry
}
