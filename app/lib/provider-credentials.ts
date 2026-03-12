export type ConnectedAccountId = 'expo'

export type ProviderCredentialKey = 'EXPO_TOKEN'

export interface ProviderCredentialField {
  key: ProviderCredentialKey
  label: string
  placeholder?: string
  description?: string
  required: boolean
  sensitive?: boolean
}

export interface ProviderCredentialSpec {
  title: string
  description: string
  fields: ProviderCredentialField[]
}

const PROVIDER_CREDENTIAL_SPECS: Record<ConnectedAccountId, ProviderCredentialSpec> = {
  expo: {
    title: 'Connect Expo',
    description: 'Save an Expo access token for EAS and deployment workflows in the IDE.',
    fields: [
      {
        key: 'EXPO_TOKEN',
        label: 'Expo Access Token',
        placeholder: 'expo_...',
        description: 'Generate this from your Expo account settings.',
        required: true,
        sensitive: true,
      },
    ],
  },
}

export function getProviderCredentialSpec(accountId: ConnectedAccountId): ProviderCredentialSpec {
  return PROVIDER_CREDENTIAL_SPECS[accountId]
}

export function getProviderCredentialKeys(accountId: ConnectedAccountId): ProviderCredentialKey[] {
  return PROVIDER_CREDENTIAL_SPECS[accountId].fields.map((field) => field.key)
}

export function hasProviderCredentials(
  credentials: Partial<Record<ProviderCredentialKey, string>>,
  accountId: ConnectedAccountId
): boolean {
  const keySet = new Set(
    Object.entries(credentials)
      .filter(([, value]) => Boolean(value?.trim()))
      .map(([key]) => key as ProviderCredentialKey)
  )

  return getProviderCredentialKeys(accountId).every((key) => keySet.has(key))
}
