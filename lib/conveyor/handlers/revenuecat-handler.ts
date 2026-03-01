export interface RevenueCatTokenResult {
  success: boolean
  accessToken?: string
  accountId?: string
  error?: string
}

export async function fetchRevenueCatToken(_authToken: string): Promise<RevenueCatTokenResult> {
  return {
    success: false,
    error: 'RevenueCat token fetch is not configured in this build',
  }
}
