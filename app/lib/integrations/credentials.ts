export type ConnectIntegrationId = 'firebase' | 'convex' | 'stripe' | 'revenuecat'
export type NormalizedAppType = 'web' | 'mobile'

export interface IntegrationCredentialField {
  key: string
  label: string
  placeholder?: string
  description?: string
  required: boolean
  sensitive?: boolean
}

export interface IntegrationCredentialSpec {
  title: string
  description: string
  fields: IntegrationCredentialField[]
}

export function getIntegrationCredentialSpec(
  integrationId: ConnectIntegrationId,
  appType: NormalizedAppType
): IntegrationCredentialSpec {
  switch (integrationId) {
    case 'firebase': {
      const prefix = appType === 'web' ? 'NEXT_PUBLIC_FIREBASE_' : 'EXPO_PUBLIC_FIREBASE_'
      return {
        title: 'Connect Firebase',
        description: 'Add the required Firebase environment variables for this app.',
        fields: [
          {
            key: `${prefix}API_KEY`,
            label: 'Firebase API Key',
            placeholder: 'AIza...',
            required: true,
            sensitive: true,
          },
          {
            key: `${prefix}PROJECT_ID`,
            label: 'Firebase Project ID',
            placeholder: 'my-project-id',
            required: true,
            sensitive: false,
          },
        ],
      }
    }
    case 'convex': {
      const urlKey = appType === 'web' ? 'NEXT_PUBLIC_CONVEX_URL' : 'EXPO_PUBLIC_CONVEX_URL'
      return {
        title: 'Connect Convex',
        description: 'Add both Convex URL and deploy key to enable setup and dashboard access.',
        fields: [
          {
            key: urlKey,
            label: 'Convex URL',
            placeholder: 'https://your-project.convex.cloud',
            required: true,
            sensitive: false,
          },
          {
            key: 'CONVEX_DEPLOY_KEY',
            label: 'Convex Deploy Key',
            placeholder: 'dev:... or prod:...',
            required: true,
            sensitive: true,
          },
        ],
      }
    }
    case 'stripe': {
      const key = appType === 'web' ? 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' : 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY'
      return {
        title: 'Connect Stripe',
        description: 'Add the publishable key required to initialize Stripe in this app.',
        fields: [
          {
            key,
            label: 'Stripe Publishable Key',
            placeholder: 'pk_live_...',
            required: true,
            sensitive: true,
          },
        ],
      }
    }
    case 'revenuecat':
      return {
        title: 'Connect RevenueCat',
        description: 'Add the public SDK key required for RevenueCat in-app purchases.',
        fields: [
          {
            key: 'EXPO_PUBLIC_REVENUECAT_API_KEY',
            label: 'RevenueCat Public SDK Key',
            placeholder: 'test_***',
            required: true,
            sensitive: true,
          },
        ],
      }
  }
}

export function getRequiredSecretKeys(
  integrationId: ConnectIntegrationId,
  appType: NormalizedAppType
): string[] {
  return getIntegrationCredentialSpec(integrationId, appType)
    .fields
    .filter((field) => field.required)
    .map((field) => field.key)
}

export function hasRequiredSecrets(
  secretKeys: string[],
  integrationId: ConnectIntegrationId,
  appType: NormalizedAppType
): boolean {
  const keySet = new Set(secretKeys)
  return getRequiredSecretKeys(integrationId, appType).every((key) => keySet.has(key))
}
