/**
 * RevenueCat Handler
 *
 * Fetches user's RevenueCat credentials for use with RevenueCat's official MCP cloud server.
 * Supports two authentication modes:
 * 1. Direct API key (REVENUECAT_API_KEY environment variable)
 * 2. Backend OAuth (requires BACKEND_URL to be configured)
 */

import dotenv from 'dotenv'

dotenv.config()

const LOG_PREFIX = '[RevenueCat Handler]'

export interface RevenueCatTokenResult {
  success: boolean
  accessToken?: string
  accountId?: string
  error?: string
}

/**
 * Get backend URL from environment, or undefined if not configured
 */
function getBackendUrl(): string | undefined {
  return process.env.BACKEND_URL || undefined
}

/**
 * Check if direct API key is configured
 */
function hasDirectApiKey(): boolean {
  return !!process.env.REVENUECAT_API_KEY
}

/**
 * Fetch user's RevenueCat credentials - tries direct API key first, then backend OAuth.
 * Used to authenticate with RevenueCat's MCP cloud server.
 */
export async function fetchRevenueCatToken(token: string): Promise<RevenueCatTokenResult> {
  console.log(`${LOG_PREFIX} ========================================`)
  console.log(`${LOG_PREFIX} FETCHING REVENUECAT TOKEN`)

  // Option 1: Direct API key from environment
  if (hasDirectApiKey()) {
    console.log(`${LOG_PREFIX} Using direct API key from REVENUECAT_API_KEY`)
    return {
      success: true,
      accessToken: process.env.REVENUECAT_API_KEY,
    }
  }

  // Option 2: Backend OAuth
  const backendUrl = getBackendUrl()
  if (!backendUrl) {
    console.log(`${LOG_PREFIX} No RevenueCat credentials configured`)
    console.log(`${LOG_PREFIX} Set REVENUECAT_API_KEY for direct API access`)
    console.log(`${LOG_PREFIX} Or set BACKEND_URL for OAuth-based access`)
    return {
      success: false,
      error: 'RevenueCat not configured. Set REVENUECAT_API_KEY or configure backend OAuth.',
    }
  }

  console.log(`${LOG_PREFIX} Using backend OAuth`)
  console.log(`${LOG_PREFIX} Backend URL: ${backendUrl}`)
  console.log(`${LOG_PREFIX} Endpoint: ${backendUrl}/api/revenuecat/token`)
  console.log(`${LOG_PREFIX} Auth token present: ${!!token}`)
  console.log(`${LOG_PREFIX} ========================================`)

  try {
    console.log(`${LOG_PREFIX} Making fetch request...`)
    const response = await fetch(`${backendUrl}/api/revenuecat/token`, {
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
      console.log(`${LOG_PREFIX} RevenueCat not connected - error response:`, data.error)
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      }
    }

    console.log(`${LOG_PREFIX} ========================================`)
    console.log(`${LOG_PREFIX} REVENUECAT TOKEN RETRIEVED SUCCESSFULLY`)
    console.log(`${LOG_PREFIX} Has accessToken: ${!!data.accessToken}`)
    console.log(`${LOG_PREFIX} accessToken length: ${data.accessToken?.length || 0}`)
    console.log(`${LOG_PREFIX} accountId: ${data.accountId || 'N/A'}`)
    console.log(`${LOG_PREFIX} ========================================`)

    return {
      success: true,
      accessToken: data.accessToken,
      accountId: data.accountId,
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} ========================================`)
    console.error(`${LOG_PREFIX} ERROR FETCHING REVENUECAT TOKEN`)
    console.error(`${LOG_PREFIX} Error:`, error)
    console.error(`${LOG_PREFIX} ========================================`)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

/**
 * Check if RevenueCat is connected/configured
 */
export async function checkRevenueCatConnection(token: string): Promise<{ connected: boolean; error?: string }> {
  // Direct API key is always "connected"
  if (hasDirectApiKey()) {
    return { connected: true }
  }

  const result = await fetchRevenueCatToken(token)
  return {
    connected: result.success,
    error: result.success ? undefined : result.error,
  }
}
