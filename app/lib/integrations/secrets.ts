import { getConvexSecretStatusFromKeys } from '@/app/lib/integrations/convex'
import { hasRequiredSecrets, type NormalizedAppType } from '@/app/lib/integrations/credentials'

export type IntegrationSecretsPresence = {
  firebase: boolean
  convex: boolean
  stripe: boolean
  revenuecat: boolean
}

const CONVEX_SECRET_KEYS = ['NEXT_PUBLIC_CONVEX_URL', 'EXPO_PUBLIC_CONVEX_URL', 'CONVEX_DEPLOY_KEY'] as const

export function isConvexSecretKey(key: string): boolean {
  return CONVEX_SECRET_KEYS.includes(key as (typeof CONVEX_SECRET_KEYS)[number])
}

export function detectIntegrationSecretsPresence(
  secretKeys: string[],
  appType: NormalizedAppType
): IntegrationSecretsPresence {
  const hasConvexSecrets = getConvexSecretStatusFromKeys(secretKeys, appType).isConfigured

  return {
    firebase: hasRequiredSecrets(secretKeys, 'firebase', appType),
    convex: hasConvexSecrets,
    stripe: hasRequiredSecrets(secretKeys, 'stripe', appType),
    revenuecat: hasRequiredSecrets(secretKeys, 'revenuecat', appType),
  }
}
