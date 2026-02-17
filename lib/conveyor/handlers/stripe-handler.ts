/**
 * Stripe Handler
 *
 * IPC handlers for Stripe MCP integration.
 * Supports two authentication modes:
 * 1. Direct API key (STRIPE_SECRET_KEY environment variable)
 * 2. Backend OAuth (requires BACKEND_URL to be configured)
 */

import { handle } from '@/lib/main/shared'
import dotenv from 'dotenv'

dotenv.config()

const LOG_PREFIX = '[Stripe Handler]'

export interface StripeTokenResult {
  success: boolean
  accessToken?: string
  accountId?: string
  publishableKey?: string
  scope?: string
  error?: string
  connected?: boolean
}

/**
 * Get backend URL from environment, or undefined if not configured
 */
function getBackendUrl(): string | undefined {
  return process.env.BACKEND_URL || undefined
}

/**
 * Check if direct API keys are configured
 */
function hasDirectApiKeys(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/**
 * Get Stripe credentials - tries direct API key first, then backend OAuth
 */
async function fetchStripeToken(token: string): Promise<StripeTokenResult> {
  console.log(`${LOG_PREFIX} ========================================`)
  console.log(`${LOG_PREFIX} FETCHING STRIPE TOKEN`)

  // Option 1: Direct API key from environment
  if (hasDirectApiKeys()) {
    console.log(`${LOG_PREFIX} Using direct API key from STRIPE_SECRET_KEY`)
    return {
      success: true,
      accessToken: process.env.STRIPE_SECRET_KEY,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      connected: true,
    }
  }

  // Option 2: Backend OAuth
  const backendUrl = getBackendUrl()
  if (!backendUrl) {
    console.log(`${LOG_PREFIX} No Stripe credentials configured`)
    console.log(`${LOG_PREFIX} Set STRIPE_SECRET_KEY for direct API access`)
    console.log(`${LOG_PREFIX} Or set BACKEND_URL for OAuth-based access`)
    return {
      success: false,
      error: 'Stripe not configured. Set STRIPE_SECRET_KEY or configure backend OAuth.',
      connected: false,
    }
  }

  console.log(`${LOG_PREFIX} Using backend OAuth`)
  console.log(`${LOG_PREFIX} Backend URL: ${backendUrl}`)
  console.log(`${LOG_PREFIX} Endpoint: ${backendUrl}/api/stripe/token`)
  console.log(`${LOG_PREFIX} Auth token present: ${!!token}`)
  console.log(`${LOG_PREFIX} ========================================`)

  try {
    console.log(`${LOG_PREFIX} Making fetch request...`)
    const response = await fetch(`${backendUrl}/api/stripe/token`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Desktop-App': 'true',
      },
    })

    console.log(`${LOG_PREFIX} Response status: ${response.status} ${response.statusText}`)
    const data = await response.json()
    console.log(`${LOG_PREFIX} Response data keys:`, Object.keys(data))

    if (!response.ok) {
      console.log(`${LOG_PREFIX} Stripe not connected or error:`, data.error)
      console.log(`${LOG_PREFIX} Full response data:`, JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
        connected: data.connected ?? false,
      }
    }

    console.log(`${LOG_PREFIX} ========================================`)
    console.log(`${LOG_PREFIX} STRIPE TOKEN RETRIEVED SUCCESSFULLY`)
    console.log(`${LOG_PREFIX} Account ID: ${data.accountId}`)
    console.log(`${LOG_PREFIX} Scope: ${data.scope}`)
    console.log(`${LOG_PREFIX} Access token present: ${!!data.accessToken}`)
    console.log(`${LOG_PREFIX} Access token length: ${data.accessToken?.length || 0}`)
    console.log(`${LOG_PREFIX} Publishable key present: ${!!data.publishableKey}`)
    console.log(`${LOG_PREFIX} ========================================`)
    return {
      success: true,
      accessToken: data.accessToken,
      accountId: data.accountId,
      publishableKey: data.publishableKey,
      scope: data.scope,
      connected: true,
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} ========================================`)
    console.error(`${LOG_PREFIX} ERROR FETCHING STRIPE TOKEN`)
    console.error(`${LOG_PREFIX} Error type:`, error instanceof Error ? error.constructor.name : typeof error)
    console.error(`${LOG_PREFIX} Error message:`, error instanceof Error ? error.message : String(error))
    console.error(`${LOG_PREFIX} ========================================`)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
      connected: false,
    }
  }
}

/**
 * Check if user has Stripe connected.
 */
async function checkStripeConnection(token: string): Promise<{ connected: boolean; error?: string }> {
  // Direct API key is always "connected"
  if (hasDirectApiKeys()) {
    return { connected: true }
  }

  const result = await fetchStripeToken(token)
  return {
    connected: result.connected ?? false,
    error: result.connected ? undefined : result.error,
  }
}

export const registerStripeHandlers = () => {
  /**
   * Get user's Stripe OAuth credentials for MCP tools.
   */
  handle('stripe:get-token', async ({ token }: { token: string }): Promise<StripeTokenResult> => {
    return fetchStripeToken(token)
  })

  /**
   * Check if user has connected their Stripe account.
   */
  handle('stripe:check-connection', async ({ token }: { token: string }) => {
    return checkStripeConnection(token)
  })
}

// Export for use by other modules (e.g., creating MCP server)
export { fetchStripeToken, checkStripeConnection }
