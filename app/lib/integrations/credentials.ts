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
        description: 'Add the Firebase client environment variables required for this app. This enables local-first Firebase setup; it does not provision a Firebase project for you.',
        fields: [
          {
            key: `${prefix}API_KEY`,
            label: 'Firebase API Key',
            placeholder: 'AIza...',
            required: true,
            sensitive: true,
          },
          {
            key: `${prefix}AUTH_DOMAIN`,
            label: 'Firebase Auth Domain',
            placeholder: 'my-project.firebaseapp.com',
            required: true,
            sensitive: false,
          },
          {
            key: `${prefix}PROJECT_ID`,
            label: 'Firebase Project ID',
            placeholder: 'my-project-id',
            required: true,
            sensitive: false,
          },
          {
            key: `${prefix}STORAGE_BUCKET`,
            label: 'Firebase Storage Bucket',
            placeholder: 'my-project.firebasestorage.app',
            required: true,
            sensitive: false,
          },
          {
            key: `${prefix}MESSAGING_SENDER_ID`,
            label: 'Firebase Messaging Sender ID',
            placeholder: '123456789012',
            required: true,
            sensitive: false,
          },
          {
            key: `${prefix}APP_ID`,
            label: 'Firebase App ID',
            placeholder: '1:123456789012:web:abcdef123456',
            required: true,
            sensitive: false,
          },
        ],
      }
    }
    case 'convex': {
      const urlKey = appType === 'web' ? 'NEXT_PUBLIC_CONVEX_URL' : 'EXPO_PUBLIC_CONVEX_URL'
      const siteUrlKey = appType === 'web' ? 'NEXT_PUBLIC_CONVEX_SITE_URL' : 'EXPO_PUBLIC_CONVEX_SITE_URL'
      return {
        title: 'Connect Convex',
        description: 'Add Convex URL and deploy key. Optionally add Convex site URL to auto-provision Better Auth SITE_URL.',
        fields: [
          {
            key: urlKey,
            label: 'Convex URL',
            placeholder: 'https://your-project.convex.cloud',
            required: true,
            sensitive: false,
          },
          {
            key: siteUrlKey,
            label: 'Convex Site URL (Optional)',
            placeholder: 'https://your-project.convex.site',
            description: 'Used to provision Convex deployment SITE_URL for Better Auth.',
            required: false,
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
      const publishableKey = appType === 'web' ? 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' : 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY'
      return {
        title: 'Connect Stripe',
        description: 'Add publishable and secret keys required to initialize Stripe in this app.',
        fields: [
          {
            key: publishableKey,
            label: 'Stripe Publishable Key',
            placeholder: 'pk_live_...',
            required: true,
            sensitive: true,
          },
          {
            key: 'STRIPE_SECRET_KEY',
            label: 'Stripe Secret Key',
            placeholder: 'sk_live_...',
            required: true,
            sensitive: true,
          },
        ],
      }
    }
    case 'revenuecat':
      return {
        title: 'Connect RevenueCat',
        description: 'Add a RevenueCat API v2 secret key with read/write Project configuration permissions.',
        fields: [
          {
            key: 'REVENUECAT_API_KEY',
            label: 'RevenueCat API v2 Secret Key',
            placeholder: 'sk_***',
            description: 'Required scope: Project configuration (read and write).',
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
