// Client-side Stripe instance
import { loadStripe } from '@stripe/stripe-js'

// Supports multiple environment variable naming conventions
const publishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY) ||
  process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY ||
  ''

// Connected account ID for Stripe Connect (set in production)
const stripeAccountId =
  process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_ID ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_STRIPE_ACCOUNT_ID) ||
  process.env.REACT_APP_STRIPE_ACCOUNT_ID ||
  undefined

export const stripePromise = loadStripe(publishableKey, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined)
