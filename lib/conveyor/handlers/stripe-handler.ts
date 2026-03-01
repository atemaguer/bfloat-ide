export interface StripeTokenResult {
  success: boolean
  accessToken?: string
  accountId?: string
  error?: string
}

export async function fetchStripeToken(_authToken: string): Promise<StripeTokenResult> {
  return {
    success: false,
    error: 'Stripe token fetch is not configured in this build',
  }
}
