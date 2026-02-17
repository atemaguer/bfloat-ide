import { useState } from 'react'
import { Loader2, PlusCircle, Unplug } from 'lucide-react'

export interface FirebaseIntegrationProps {
  isConnected: boolean
  onConnect: () => void
  onDisconnect: () => Promise<void>
}

export function FirebaseIntegration({ isConnected, onConnect, onDisconnect }: FirebaseIntegrationProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDisconnect = async () => {
    setError(null)
    setIsLoading(true)

    try {
      await onDisconnect()
    } catch (error) {
      setError('Failed to disconnect Firebase. Please try again.')
      console.error('Failed to disconnect Firebase:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Firebase Logo */}
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5.8 24.6L7.5 8.3L12.2 13.6L5.8 24.6Z" fill="#FFA000"/>
              <path d="M16 25.6L12.2 13.6L7.5 8.3L16 2.4L16 25.6Z" fill="#F57C00"/>
              <path d="M27 24.6L23.5 8.6C23.3 7.9 22.5 7.6 21.9 8L16 11.9L12.2 13.6L16 25.6L27 24.6Z" fill="#FFCA28"/>
              <path d="M16 25.6L12.2 13.6L16 11.9L19.8 13.6L16 25.6Z" fill="#FFA000"/>
            </svg>
          </div>

          {/* Heading */}
          <div>
            <h3 className="text-xl font-semibold mb-2">
              {isConnected ? 'Firebase Connected' : 'Connect to Firebase'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? 'Your Firebase account is connected and ready to use.'
                : 'Connect your Firebase account to enable backend features for your app.'}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="w-full p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Connection Status Badge */}
          {isConnected && (
            <div className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-3 py-1.5 text-sm font-medium text-green-800 dark:text-green-300">
              <PlusCircle className="mr-1.5 h-4 w-4" />
              Connected
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col w-full space-y-3">
            {isConnected ? (
              <button
                onClick={handleDisconnect}
                disabled={isLoading}
                className="w-full h-10 px-4 text-sm font-medium bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-md flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <Unplug className="h-4 w-4 mr-2" />
                    Disconnect
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={onConnect}
                disabled={isLoading}
                className="w-full h-10 px-4 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 32 32" fill="currentColor" style={{ marginRight: 8 }}>
                      <path d="M5.8 24.6L7.5 8.3L12.2 13.6L5.8 24.6Z" />
                      <path d="M16 25.6L12.2 13.6L7.5 8.3L16 2.4L16 25.6Z" />
                    </svg>
                    Connect Firebase
                  </>
                )}
              </button>
            )}
          </div>

          {/* Learn More Link */}
          {!isConnected && (
            <a
              href="https://firebase.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Learn more about Firebase
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
