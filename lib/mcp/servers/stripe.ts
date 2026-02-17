/**
 * Stripe hosted MCP server definition.
 *
 * Fetches an OAuth access token and configures the hosted Stripe MCP endpoint
 * for both Claude (HTTP transport) and Codex (url + http_headers).
 */

import type { McpServerDefinition, McpServerContext } from '../types'
import type { McpHttpServerConfig } from '@/lib/agents/types'
import { fetchStripeToken } from '@/lib/conveyor/handlers/stripe-handler'

const STRIPE_MCP_URL = 'https://mcp.stripe.com'
const LOG_PREFIX = '[Stripe MCP]'

async function buildStripeConfig(
  ctx: McpServerContext
): Promise<McpHttpServerConfig | null> {
  if (!ctx.authToken) return null

  try {
    const result = await fetchStripeToken(ctx.authToken)
    if (!result.success || !result.accessToken || !result.accountId) {
      console.log(`${LOG_PREFIX} Not connected:`, result.error || 'No credentials')
      return null
    }

    console.log(`${LOG_PREFIX} Connected for account: ${result.accountId}`)
    return {
      type: 'http',
      url: STRIPE_MCP_URL,
      headers: {
        Authorization: `Bearer ${result.accessToken}`,
      },
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to fetch credentials:`, error)
    return null
  }
}

export const stripeServer: McpServerDefinition = {
  name: 'stripe',
  requiresAuth: true,

  async forClaude(ctx: McpServerContext) {
    return buildStripeConfig(ctx)
  },

  async forCodex(ctx: McpServerContext) {
    return buildStripeConfig(ctx)
  },
}
