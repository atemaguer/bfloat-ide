/**
 * RevenueCat hosted MCP server definition.
 *
 * Fetches an OAuth access token and configures the official RevenueCat MCP
 * cloud endpoint for both Claude (HTTP transport) and Codex (url + http_headers).
 */

import type { McpServerDefinition, McpServerContext } from '../types'
import type { McpHttpServerConfig } from '@/lib/agents/types'
import { fetchRevenueCatToken } from '@/lib/conveyor/handlers/revenuecat-handler'

const REVENUECAT_MCP_URL = 'https://mcp.revenuecat.ai/mcp'
const LOG_PREFIX = '[RevenueCat MCP]'

async function buildRevenueCatConfig(
  ctx: McpServerContext
): Promise<McpHttpServerConfig | null> {
  if (!ctx.authToken) return null

  try {
    const result = await fetchRevenueCatToken(ctx.authToken)
    if (!result.success || !result.accessToken) {
      console.log(`${LOG_PREFIX} Not connected:`, result.error || 'No credentials')
      return null
    }

    console.log(`${LOG_PREFIX} Connected (account: ${result.accountId || 'unknown'})`)
    return {
      type: 'http',
      url: REVENUECAT_MCP_URL,
      headers: {
        Authorization: `Bearer ${result.accessToken}`,
      },
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to fetch credentials:`, error)
    return null
  }
}

export const revenuecatServer: McpServerDefinition = {
  name: 'revenuecat',
  requiresAuth: true,

  async forClaude(ctx: McpServerContext) {
    return buildRevenueCatConfig(ctx)
  },

  async forCodex(ctx: McpServerContext) {
    return buildRevenueCatConfig(ctx)
  },
}
