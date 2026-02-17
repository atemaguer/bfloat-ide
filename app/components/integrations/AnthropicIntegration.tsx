import { useState } from 'react'
import { Loader2, PlusCircle, Unplug, ExternalLink } from 'lucide-react'
import ClaudeLogo from '@/app/components/ui/icons/claude-logo'

export interface ConnectResult {
  success: boolean
  exitCode: number
  authenticated: boolean
  providers: string[]
}

export interface AnthropicIntegrationProps {
  isConnected: boolean
  onConnect: () => Promise<ConnectResult>
  onDisconnect: () => Promise<{ success: boolean; exitCode: number }>
}

/**
 * AnthropicIntegration - Uses Claude Code CLI for authentication
 *
 * When user clicks Connect:
 * 1. Spawns `claude setup-token` in the background
 * 2. Browser opens for OAuth authentication
 * 3. When process completes, checks auth status automatically
 */
export function AnthropicIntegration({
  isConnected,
  onConnect,
  onDisconnect,
}: AnthropicIntegrationProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const handleConnect = async () => {
    setError(null)
    setStatusMessage('Opening browser for authentication...')
    setIsLoading(true)

    try {
      // This spawns claude setup-token and waits for it to complete
      const result = await onConnect()

      if (result.success && result.authenticated) {
        setStatusMessage('Successfully connected!')
        // Clear message after a moment
        setTimeout(() => setStatusMessage(null), 2000)
      } else if (!result.authenticated) {
        setError('Authentication was not completed. Please try again.')
      } else {
        setError(`Setup failed with exit code ${result.exitCode}. Please try again.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    setIsLoading(true)

    try {
      const result = await onDisconnect()
      if (!result.success) {
        setError('Failed to disconnect. Please try again.')
      }
    } catch (error) {
      setError('Failed to disconnect. Please try again.')
      console.error('Failed to disconnect Anthropic:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Claude Logo */}
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10">
            <ClaudeLogo width="32" height="32" />
          </div>

          {/* Heading */}
          <div>
            <h3 className="text-xl font-semibold mb-2">
              {isConnected ? 'Claude Connected' : 'Connect to Claude'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? 'Your Claude account is connected and ready to use.'
                : 'Connect your Claude Max or Pro account to use Claude models in the IDE.'}
            </p>
          </div>

          {/* Status Message */}
          {statusMessage && !error && (
            <div className="w-full p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-600 dark:text-blue-400 flex items-center justify-center">
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {statusMessage}
              </p>
            </div>
          )}

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
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full h-10 px-4 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Waiting for authentication...
                  </>
                ) : (
                  <>
                    <ClaudeLogo width="18" height="18" style={{ marginRight: 8 }} />
                    Connect Claude
                  </>
                )}
              </button>
            )}
          </div>

          {/* Help text */}
          {!isConnected && !isLoading && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              A browser window will open for authentication
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
