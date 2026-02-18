import { createStore } from 'zustand/vanilla'
import { providerAuthStore } from './provider-auth'
import type { ProviderAuthState } from './provider-auth'

/**
 * Onboarding store - derives completion status from provider auth state
 *
 * Requirements:
 * - At least one AI provider (Claude OR ChatGPT) must be connected
 */

function deriveOnboardingComplete(tokens: ProviderAuthState): boolean {
  return tokens.anthropic !== null || tokens.openai !== null
}

function deriveOnboardingStep(tokens: ProviderAuthState): number {
  const hasAIProvider = tokens.anthropic !== null || tokens.openai !== null

  // Step 0: Welcome (always start here)
  // Step 1: AI Provider
  // Step 2: Success

  if (!hasAIProvider) return 1 // Need to connect AI provider
  return 2 // All done, show success
}

function deriveHasAnyAIProvider(tokens: ProviderAuthState): boolean {
  return tokens.anthropic !== null || tokens.openai !== null
}

function deriveHasExpo(tokens: ProviderAuthState): boolean {
  return tokens.expo !== null
}

// Initialize with current state
const initialTokens = providerAuthStore.tokens.getState()

// Derived stores that sync from providerAuthStore.tokens
export const isOnboardingComplete = createStore<boolean>(() => deriveOnboardingComplete(initialTokens))
export const onboardingStep = createStore<number>(() => deriveOnboardingStep(initialTokens))
export const hasAnyAIProvider = createStore<boolean>(() => deriveHasAnyAIProvider(initialTokens))
export const hasExpo = createStore<boolean>(() => deriveHasExpo(initialTokens))

// Subscribe to token changes and update derived stores
providerAuthStore.tokens.subscribe((tokens) => {
  isOnboardingComplete.setState(deriveOnboardingComplete(tokens), true)
  onboardingStep.setState(deriveOnboardingStep(tokens), true)
  hasAnyAIProvider.setState(deriveHasAnyAIProvider(tokens), true)
  hasExpo.setState(deriveHasExpo(tokens), true)
})
