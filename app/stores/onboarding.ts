import { computed } from 'nanostores'
import { providerAuthStore } from './provider-auth'

/**
 * Onboarding store - derives completion status from provider auth state
 *
 * Requirements:
 * - At least one AI provider (Claude OR ChatGPT) must be connected
 */

// Computed atom that checks if onboarding is complete
export const isOnboardingComplete = computed(providerAuthStore.tokens, (tokens) => {
  return tokens.anthropic !== null || tokens.openai !== null
})

// Computed atom for current step based on connection status
export const onboardingStep = computed(providerAuthStore.tokens, (tokens) => {
  const hasAIProvider = tokens.anthropic !== null || tokens.openai !== null

  // Step 0: Welcome (always start here)
  // Step 1: AI Provider
  // Step 2: Success

  if (!hasAIProvider) return 1 // Need to connect AI provider
  return 2 // All done, show success
})

// Helper to check if AI provider step is complete
export const hasAnyAIProvider = computed(providerAuthStore.tokens, (tokens) => {
  return tokens.anthropic !== null || tokens.openai !== null
})

// Helper to check if Expo is connected
export const hasExpo = computed(providerAuthStore.tokens, (tokens) => {
  return tokens.expo !== null
})
