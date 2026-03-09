/**
 * Project Integrations
 *
 * Tracks which integrations are enabled for a specific project.
 * Mirrors the backend types in bfloat-app-engineer/app/types/integrations.ts
 */

export type IntegrationId = 'firebase' | 'stripe' | 'convex' | 'revenuecat'
export type AppPlatform = 'web' | 'mobile' | 'both'

/**
 * Integration metadata - defines properties of each integration
 */
export interface IntegrationMeta {
  id: IntegrationId
  name: string
  platform: AppPlatform // Which app types this integration supports
}

/**
 * Registry of all available integrations with their metadata
 */
export const INTEGRATION_REGISTRY: Record<IntegrationId, IntegrationMeta> = {
  firebase: {
    id: 'firebase',
    name: 'Firebase',
    platform: 'web', // Web only
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    platform: 'web', // Web only (Stripe payments)
  },
  convex: {
    id: 'convex',
    name: 'Convex',
    platform: 'both', // Works with both web and mobile
  },
  revenuecat: {
    id: 'revenuecat',
    name: 'RevenueCat',
    platform: 'mobile', // Mobile only (in-app purchases)
  },
}

/**
 * Stored integration state from the database
 */
export interface ProjectIntegrations {
  firebase?: boolean
  stripe?: boolean
  convex?: boolean
  revenuecat?: boolean
}

/**
 * Type guard to check if an integration ID is valid
 */
export function isValidIntegrationId(id: string): id is IntegrationId {
  return id in INTEGRATION_REGISTRY
}

/**
 * Check if an integration is available for a given app type
 */
export function isIntegrationAvailableForAppType(
  integrationId: IntegrationId,
  appType: 'web' | 'mobile'
): boolean {
  const meta = INTEGRATION_REGISTRY[integrationId]
  return meta.platform === 'both' || meta.platform === appType
}

/**
 * Get all integrations available for a given app type
 */
export function getIntegrationsForAppType(appType: 'web' | 'mobile'): IntegrationMeta[] {
  return Object.values(INTEGRATION_REGISTRY).filter(
    (meta) => meta.platform === 'both' || meta.platform === appType
  )
}

/**
 * Parse integrations JSON from API response
 */
export function parseIntegrations(json: unknown): ProjectIntegrations {
  if (!json || typeof json !== 'object') {
    return {}
  }
  return json as ProjectIntegrations
}
