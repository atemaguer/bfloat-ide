// Server-side Stripe instance (lazy-initialized to avoid build-time errors)
import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set')
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia',
      ...(process.env.STRIPE_ACCOUNT_ID && { stripeAccount: process.env.STRIPE_ACCOUNT_ID }),
    })
  }
  return _stripe
}
