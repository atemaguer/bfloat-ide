import { useState } from 'react'
import { Loader2, PlusCircle, Unplug } from 'lucide-react'
import ConvexLogo from '@/app/components/ui/icons/convex-logo'

export interface ConvexIntegrationProps {
  isConnected: boolean
  onConnect: () => void
  onDisconnect: () => Promise<void>
}

export function ConvexIntegration({ isConnected, onConnect, onDisconnect }: ConvexIntegrationProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDisconnect = async () => {
    setError(null)
    setIsLoading(true)

    try {
      await onDisconnect()
    } catch (error) {
      setError('Failed to disconnect convex. Please try again.')
      console.error('Failed to disconnect Convex:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Convex Logo */}
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10">
            <ConvexLogo width="32" height="32" />
          </div>

          {/* Heading */}
          <div>
            <h3 className="text-xl font-semibold mb-2">
              {isConnected ? 'Convex Connected' : 'Connect to Convex'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? 'Your Convex database is connected and ready to use.'
                : 'Connect your Convex account to enable database features for your app.'}
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
                    <ConvexLogo width="18" height="18" style={{ marginRight: 8 }} />
                    Connect Convex
                  </>
                )}
              </button>
            )}
          </div>

          {/* Learn More Link */}
          {!isConnected && (
            <a
              href="https://www.convex.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Learn more about Convex
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
