import type { ChatMessage, MessagePart } from '@/app/types/project'
import type { ConvexIntegrationStage } from '@/app/lib/integrations/convex'

export type IntegrationSetupPromptType =
  | 'convex-setup-prompt'
  | 'firebase-setup-prompt'
  | 'stripe-setup-prompt'
  | 'revenuecat-setup-prompt'

export interface IntegrationSetupRenderState {
  convexStage: ConvexIntegrationStage
  isFirebaseConnected: boolean
  isFirebaseSettingUp: boolean
  isStripeConnected: boolean
  isStripeSettingUp: boolean
  isRevenueCatConnected: boolean
  isRevenueCatSettingUp: boolean
}

export function shouldRenderIntegrationSetupBanner(
  promptType: IntegrationSetupPromptType,
  state: IntegrationSetupRenderState
): boolean {
  switch (promptType) {
    case 'convex-setup-prompt':
      return state.convexStage !== 'ready'
    case 'firebase-setup-prompt':
      return !state.isFirebaseConnected
    case 'stripe-setup-prompt':
      return !state.isStripeConnected || state.isStripeSettingUp
    case 'revenuecat-setup-prompt':
      return !state.isRevenueCatConnected || state.isRevenueCatSettingUp
    default:
      return true
  }
}

export function shouldRenderConvexIntentBanner(state: IntegrationSetupRenderState): boolean {
  return state.convexStage === 'connected'
}

export function sessionContainsSetupPrompt(messages: ChatMessage[], promptType: IntegrationSetupPromptType): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.parts?.some((part) => isIntegrationSetupPrompt(part, promptType))
  )
}

function isIntegrationSetupPrompt(
  part: MessagePart | null | undefined,
  promptType: IntegrationSetupPromptType
): part is MessagePart & { type: IntegrationSetupPromptType } {
  return !!part && part.type === promptType
}
