import { useState } from 'react'
import { PlusCircle, Unplug, ExternalLink } from 'lucide-react'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'
import toast from 'react-hot-toast'

export interface ExpoIntegrationProps {
  isConnected: boolean
  onUpdate: () => void
}

export function ExpoIntegration({ isConnected, onUpdate }: ExpoIntegrationProps) {
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [accessToken, setAccessToken] = useState('')

  const handleConnect = () => {
    setError(null)

    if (!accessToken.trim()) {
      setError('Please enter a valid Expo access token')
      return
    }

    if (accessToken.trim().length !== 40) {
      setError('Invalid token length. Expo tokens should be exactly 40 characters')
      return
    }

    if (!username.trim()) {
      setError('Please enter a valid Expo username')
      return
    }

    toast('Expo integration requires manual configuration. Store your credentials in your project environment variables.', {
      icon: '⚙️',
      duration: 5000,
    })
  }

  const handleDisconnect = () => {
    setError(null)
    toast('Expo integration requires manual configuration. Remove your credentials from your project environment variables.', {
      icon: '⚙️',
      duration: 5000,
    })
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Expo Logo */}
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10">
            <ExpoLogo />
          </div>

          {/* Heading */}
          <div>
            <h3 className="text-xl font-semibold mb-2">
              {isConnected ? 'Expo Connected' : 'Connect to Expo'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? 'Your Expo account is connected. Deploy your apps directly to Expo.'
                : 'Connect your Expo account to enable app deployment features.'}
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

          {/* Form or Action Buttons */}
          <div className="flex flex-col w-full space-y-3">
            {isConnected ? (
              <button
                onClick={handleDisconnect}
                className="w-full h-10 px-4 text-sm font-medium bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-md flex items-center justify-center transition-colors"
              >
                <Unplug className="h-4 w-4 mr-2" />
                Disconnect
              </button>
            ) : (
              <>
                <div className="space-y-2 text-left">
                  <label htmlFor="expo-username" className="text-sm font-medium">
                    Expo Username
                  </label>
                  <input
                    id="expo-username"
                    type="text"
                    placeholder="Enter your Expo username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="space-y-2 text-left">
                  <label htmlFor="expo-access-token" className="text-sm font-medium">
                    Expo Access Token
                  </label>
                  <input
                    id="expo-access-token"
                    type="password"
                    placeholder="Enter your Expo access token"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md focus:border-primary focus:outline-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Get your token from{' '}
                    <a
                      href="https://expo.dev/accounts/settings"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center"
                    >
                      Expo settings
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </p>
                </div>
                <button
                  onClick={handleConnect}
                  disabled={!username || !accessToken}
                  className="w-full h-10 px-4 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Connect Expo
                </button>
              </>
            )}
          </div>

          {/* Learn More Link */}
          {!isConnected && (
            <a
              href="https://expo.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Learn more about Expo
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
