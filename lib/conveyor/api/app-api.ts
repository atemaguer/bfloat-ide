import { ConveyorApi } from '@/lib/preload/shared'

export class AppApi extends ConveyorApi {
  version = () => this.invoke('version')
  login = () => this.invoke('login')
  requestToken = (userId: string) => this.invoke('app:request-token', { userId })
  connectConvex = () => this.invoke('app:connect-convex')
  openExternal = (url: string) => this.invoke('app:open-external', url)

  onAuthToken = (
    callback: (
      token: string,
      userData?: {
        id?: string
        firstName?: string
        lastName?: string
        email?: string
        profileImageUrl?: string
      },
    ) => void,
  ) => {
    const subscription = (_: any, data: string) => {
      console.log('[AppApi] Received auth-token event:', data?.substring(0, 50) + '...')
      try {
        // First, try to parse it as a URL (from the initial login flow)
        const urlObj = new URL(data)
        const token = urlObj.searchParams.get('token')
        console.log('[AppApi] Parsed as URL, token found:', !!token)
        if (token) {
          // Extract user data from URL params if present
          const id = urlObj.searchParams.get('userId') || undefined
          const firstName = urlObj.searchParams.get('firstName') || undefined
          const lastName = urlObj.searchParams.get('lastName') || undefined
          const email = urlObj.searchParams.get('email') || undefined
          const profileImageUrl = urlObj.searchParams.get('profileImageUrl') || undefined

          const userData =
            firstName || lastName || email
              ? { id, firstName, lastName, email, profileImageUrl }
              : undefined

          console.log('[AppApi] User data from URL:', userData ? 'present' : 'not present')
          callback(token, userData)
          return
        }
      } catch (e) {
        // If URL parsing fails, assume the data is the token itself (from the refresh flow)
        console.log('[AppApi] URL parsing failed, checking if JWT')
        if (typeof data === 'string' && data.split('.').length === 3) {
          console.log('[AppApi] Detected JWT token format')
          callback(data)
          return
        }
        console.error('[AppApi] Invalid auth data received:', data)
      }
    }
    this.renderer.on('auth-token', subscription)
    return () => this.renderer.removeListener('auth-token', subscription)
  }

  onSessionId = (callback: (sessionId: string) => void) => {
    const subscription = (_: any, sessionId: string) => {
      callback(sessionId)
    }
    this.renderer.on('session-id', subscription)
    return () => this.renderer.removeListener('session-id', subscription)
  }

  onAuthInvalid = (callback: () => void) => {
    const subscription = () => {
      callback()
    }
    this.renderer.on('auth-invalid', subscription)
    return () => this.renderer.removeListener('auth-invalid', subscription)
  }

  onGoogleCallback = (callback: (data: { success: boolean; error: string | null }) => void) => {
    const subscription = (_: any, data: { success: boolean; error: string | null }) => {
      callback(data)
    }
    this.renderer.on('google-callback', subscription)
    return () => this.renderer.removeListener('google-callback', subscription)
  }

  onConvexCallback = (callback: (data: { success: boolean; error: string | null }) => void) => {
    const subscription = (_: any, data: { success: boolean; error: string | null }) => {
      callback(data)
    }
    this.renderer.on('convex-callback', subscription)
    return () => this.renderer.removeListener('convex-callback', subscription)
  }

  onStripeCallback = (callback: (data: { success: boolean; error: string | null }) => void) => {
    const subscription = (_: any, data: { success: boolean; error: string | null }) => {
      callback(data)
    }
    this.renderer.on('stripe-callback', subscription)
    return () => this.renderer.removeListener('stripe-callback', subscription)
  }

  onRevenueCatCallback = (callback: (data: { success: boolean; error: string | null }) => void) => {
    const subscription = (_: any, data: { success: boolean; error: string | null }) => {
      callback(data)
    }
    this.renderer.on('revenuecat-callback', subscription)
    return () => this.renderer.removeListener('revenuecat-callback', subscription)
  }
}
