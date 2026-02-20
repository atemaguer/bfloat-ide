import { createStore } from 'zustand/vanilla'
import { provider } from '@/app/api/sidecar'

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
  tokens = createStore<ProviderAuthState>(() => ({
    anthropic: null,
    openai: null,
    expo: null,
  }))

  settings = createStore<ProviderSettings>(() => getStoredSettings())

  // Track when a provider's auth has been invalidated by an API error
  // This is separate from token existence - tokens may exist but be expired/revoked
  authInvalidated = createStore<Record<ProviderType, boolean>>(() => ({
    anthropic: false,
    openai: false,
    expo: false,
  }))

  isConnected(provider: ProviderType): boolean {
    const state = this.tokens.getState()
    const token = state[provider]
    if (!token) return false
    // Check if auth has been invalidated by an API error
    if (this.authInvalidated.getState()[provider]) return false
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
    const current = this.authInvalidated.getState()
    this.authInvalidated.setState({ ...current, [provider]: true }, true)
  }

  /**
   * Clear the invalidation flag (e.g., after successful re-auth)
   */
  clearAuthInvalidated(provider: ProviderType) {
    const current = this.authInvalidated.getState()
    this.authInvalidated.setState({ ...current, [provider]: false }, true)
  }

  /**
   * Check if a provider's auth has been invalidated by an API error
   */
  isAuthInvalidated(provider: ProviderType): boolean {
    return this.authInvalidated.getState()[provider]
  }

  needsRefresh(provider: ProviderType): boolean {
    const state = this.tokens.getState()
    const token = state[provider]
    if (!token || !token.expiresAt) return false
    // Refresh if expiring within 5 minutes
    return token.expiresAt - Date.now() < 5 * 60 * 1000
  }

  setTokens(providerType: ProviderType, tokens: OAuthTokens) {
    const current = this.tokens.getState()
    this.tokens.setState({ ...current, [providerType]: tokens }, true)
    // Persist to secure storage via IPC
    provider.saveTokens(providerType, tokens)
  }

  clearTokens(providerType: ProviderType) {
    const current = this.tokens.getState()
    this.tokens.setState({ ...current, [providerType]: null }, true)
    provider.clearTokens(providerType)
  }

  setDefaultProvider(providerType: ProviderType) {
    const newSettings = { ...this.settings.getState(), defaultProvider: providerType }
    this.settings.setState(newSettings, true)
    localStorage.setItem('provider_settings', JSON.stringify(newSettings))
  }

  async loadFromStorage() {
    // Load settings from localStorage
    const settingsStr = localStorage.getItem('provider_settings')
    if (settingsStr) {
      try {
        this.settings.setState(JSON.parse(settingsStr), true)
      } catch {
        // Keep defaults
      }
    }
    // Load tokens from secure storage via IPC
    const tokens = await provider.loadTokens()
    console.log('[providerAuthStore] Loaded tokens:', JSON.stringify({
      anthropic: tokens.anthropic !== null ? { ...tokens.anthropic, accessToken: tokens.anthropic?.accessToken ? '[REDACTED]' : undefined } : null,
      openai: tokens.openai !== null,
      expo: tokens.expo !== null,
    }))
    this.tokens.setState(tokens, true)
  }

  getAccessToken(providerType: ProviderType): string | null {
    const tokens = this.tokens.getState()[providerType]
    if (!tokens) return null
    // Check expiry if set
    if (tokens.expiresAt && tokens.expiresAt <= Date.now()) return null
    // Claude Code manages tokens internally, so we may not have an actual accessToken
    return tokens.accessToken || null
  }
}

export const providerAuthStore = new ProviderAuthStore()
