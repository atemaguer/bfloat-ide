import { describe, expect, it } from 'bun:test'

import { getProviderCredentialKeys, hasProviderCredentials } from './provider-credentials'

describe('provider credentials helpers', () => {
  it('returns the required key list for a connected account', () => {
    expect(getProviderCredentialKeys('expo')).toEqual(['EXPO_TOKEN'])
  })

  it('treats a provider as connected only when required credentials are present', () => {
    expect(hasProviderCredentials({}, 'expo')).toBe(false)
    expect(hasProviderCredentials({ EXPO_TOKEN: 'expo_test' }, 'expo')).toBe(true)
    expect(hasProviderCredentials({ EXPO_TOKEN: '   ' }, 'expo')).toBe(false)
  })
})
