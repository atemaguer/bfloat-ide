import { atom } from 'nanostores'

export type ProviderType = 'anthropic' | 'openai' | 'expo'

export interface OAuthTokens {
  type: 'oauth'
  // These are optional since CLI tools manage tokens internally
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  scopes?: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
  // Expo-specific fields
  userId?: string
  username?: string
}

export interface ProviderAuthState {
  anthropic: OAuthTokens | null
  openai: OAuthTokens | null
  expo: OAuthTokens | null
}

export interface ProviderSettings {
  defaultProvider: ProviderType
}

function getStoredSettings(): ProviderSettings {
  const stored = localStorage.getItem('provider_settings')
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return { defaultProvider: 'anthropic' }
    }
  }
  return { defaultProvider: 'anthropic' }
}

export class ProviderAuthStore {
  tokens = atom<ProviderAuthState>({
    anthropic: null,
    openai: null,
    expo: null,
  })

  settings = atom<ProviderSettings>(getStoredSettings())

  // Track when a provider's auth has been invalidated by an API error
  // This is separate from token existence - tokens may exist but be expired/revoked
  authInvalidated = atom<Record<ProviderType, boolean>>({
    anthropic: false,
    openai: false,
    expo: false,
  })

  isConnected(provider: ProviderType): boolean {
    const state = this.tokens.get()
    const token = state[provider]
    if (!token) return false
    // Check if auth has been invalidated by an API error
    if (this.authInvalidated.get()[provider]) return false
    // If expiresAt is set, check it; otherwise just check token exists
    if (token.expiresAt) {
      return token.expiresAt > Date.now()
    }
    return true
  }

  /**
   * Mark a provider's auth as invalidated (e.g., when API returns auth error)
   * This doesn't clear tokens - they may still be valid for refresh
   */
  markAuthInvalidated(provider: ProviderType) {
    const current = this.authInvalidated.get()
    this.authInvalidated.set({ ...current, [provider]: true })
  }

  /**
   * Clear the invalidation flag (e.g., after successful re-auth)
   */
  clearAuthInvalidated(provider: ProviderType) {
    const current = this.authInvalidated.get()
    this.authInvalidated.set({ ...current, [provider]: false })
  }

  /**
   * Check if a provider's auth has been invalidated by an API error
   */
  isAuthInvalidated(provider: ProviderType): boolean {
    return this.authInvalidated.get()[provider]
  }

  needsRefresh(provider: ProviderType): boolean {
    const state = this.tokens.get()
    const token = state[provider]
    if (!token || !token.expiresAt) return false
    // Refresh if expiring within 5 minutes
    return token.expiresAt - Date.now() < 5 * 60 * 1000
  }

  setTokens(provider: ProviderType, tokens: OAuthTokens) {
    const current = this.tokens.get()
    this.tokens.set({ ...current, [provider]: tokens })
    // Persist to secure storage via IPC
    window.conveyor.provider.saveTokens(provider, tokens)
  }

  clearTokens(provider: ProviderType) {
    const current = this.tokens.get()
    this.tokens.set({ ...current, [provider]: null })
    window.conveyor.provider.clearTokens(provider)
  }

  setDefaultProvider(provider: ProviderType) {
    const newSettings = { ...this.settings.get(), defaultProvider: provider }
    this.settings.set(newSettings)
    localStorage.setItem('provider_settings', JSON.stringify(newSettings))
  }

  async loadFromStorage() {
    // Load settings from localStorage
    const settingsStr = localStorage.getItem('provider_settings')
    if (settingsStr) {
      try {
        this.settings.set(JSON.parse(settingsStr))
      } catch {
        // Keep defaults
      }
    }
    // Load tokens from secure storage via IPC
    const tokens = await window.conveyor.provider.loadTokens()
    console.log('[providerAuthStore] Loaded tokens:', JSON.stringify({
      anthropic: tokens.anthropic !== null ? { ...tokens.anthropic, accessToken: tokens.anthropic?.accessToken ? '[REDACTED]' : undefined } : null,
      openai: tokens.openai !== null,
      expo: tokens.expo !== null,
    }))
    this.tokens.set(tokens)
  }

  getAccessToken(provider: ProviderType): string | null {
    const tokens = this.tokens.get()[provider]
    if (!tokens) return null
    // Check expiry if set
    if (tokens.expiresAt && tokens.expiresAt <= Date.now()) return null
    // Claude Code manages tokens internally, so we may not have an actual accessToken
    return tokens.accessToken || null
  }
}

export const providerAuthStore = new ProviderAuthStore()
