export type IntegrationSecretsPresence = {
  firebase: boolean
  convex: boolean
  stripe: boolean
  revenuecat: boolean
}

export type NormalizedAppType = 'web' | 'mobile'

export function detectIntegrationSecretsPresence(
  secretKeys: string[],
  appType: NormalizedAppType
): IntegrationSecretsPresence {
  const firebasePrefix = appType === 'web' ? 'NEXT_PUBLIC_FIREBASE_' : 'EXPO_PUBLIC_FIREBASE_'
  const hasFirebaseSecrets =
    secretKeys.includes(`${firebasePrefix}API_KEY`) &&
    secretKeys.includes(`${firebasePrefix}PROJECT_ID`)

  const convexUrlKey = appType === 'web' ? 'NEXT_PUBLIC_CONVEX_URL' : 'EXPO_PUBLIC_CONVEX_URL'
  const hasConvexSecrets = secretKeys.includes('CONVEX_URL') || secretKeys.includes(convexUrlKey)

  const stripeKey =
    appType === 'web' ? 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' : 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY'
  const hasStripeSecrets = secretKeys.includes(stripeKey)

  const hasRevenuecatSecrets = secretKeys.includes('EXPO_PUBLIC_REVENUECAT_API_KEY')

  return {
    firebase: hasFirebaseSecrets,
    convex: hasConvexSecrets,
    stripe: hasStripeSecrets,
    revenuecat: hasRevenuecatSecrets,
  }
}
