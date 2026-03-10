import { describe, expect, it } from 'bun:test'

import type { ChatMessage } from '@/app/types/project'
import {
  sessionContainsSetupPrompt,
  shouldRenderConvexIntentBanner,
  shouldRenderIntegrationSetupBanner,
} from './integrationSetupPolicy'

describe('integration setup banner policy', () => {
  it('hides firebase banners once connected', () => {
    expect(
      shouldRenderIntegrationSetupBanner('firebase-setup-prompt', {
        convexStage: 'disconnected',
        isFirebaseConnected: true,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(false)
  })

  it('keeps stripe and revenuecat banners visible while setup is actively running', () => {
    expect(
      shouldRenderIntegrationSetupBanner('stripe-setup-prompt', {
        convexStage: 'disconnected',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: true,
        isStripeSettingUp: true,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(true)

    expect(
      shouldRenderIntegrationSetupBanner('revenuecat-setup-prompt', {
        convexStage: 'disconnected',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: true,
        isRevenueCatSettingUp: true,
      })
    ).toBe(true)
  })

  it('keeps convex banners until convex is ready', () => {
    expect(
      shouldRenderIntegrationSetupBanner('convex-setup-prompt', {
        convexStage: 'connected',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(true)

    expect(
      shouldRenderIntegrationSetupBanner('convex-setup-prompt', {
        convexStage: 'setting_up',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(true)

    expect(
      shouldRenderIntegrationSetupBanner('convex-setup-prompt', {
        convexStage: 'ready',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(false)
  })

  it('shows the convex intent chooser only while convex is connected but not yet setting up', () => {
    expect(
      shouldRenderConvexIntentBanner({
        convexStage: 'connected',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(true)

    expect(
      shouldRenderConvexIntentBanner({
        convexStage: 'setting_up',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(false)

    expect(
      shouldRenderConvexIntentBanner({
        convexStage: 'ready',
        isFirebaseConnected: false,
        isFirebaseSettingUp: false,
        isStripeConnected: false,
        isStripeSettingUp: false,
        isRevenueCatConnected: false,
        isRevenueCatSettingUp: false,
      })
    ).toBe(false)
  })
})

describe('integration setup prompt session dedupe', () => {
  it('finds an older setup prompt anywhere in assistant history', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        parts: [{ type: 'firebase-setup-prompt' }],
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        role: 'user',
        content: 'Set up firebase',
        parts: [{ type: 'text', text: 'Set up firebase' }],
        createdAt: new Date().toISOString(),
      },
      {
        id: '3',
        role: 'assistant',
        content: 'Later response',
        parts: [{ type: 'text', text: 'Later response' }],
        createdAt: new Date().toISOString(),
      },
    ]

    expect(sessionContainsSetupPrompt(messages, 'firebase-setup-prompt')).toBe(true)
    expect(sessionContainsSetupPrompt(messages, 'stripe-setup-prompt')).toBe(false)
  })
})
