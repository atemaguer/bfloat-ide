import { useState } from 'react'
import { PlusCircle, Unplug, Upload, ExternalLink } from 'lucide-react'
import AppStoreLogo from '@/app/components/ui/icons/app-store-logo'
import toast from 'react-hot-toast'

export interface AppStoreIntegrationProps {
  isConnected: boolean
  onUpdate: () => void
}

export function AppStoreIntegration({ isConnected, onUpdate }: AppStoreIntegrationProps) {
  const [error, setError] = useState<string | null>(null)
  const [iosKeyId, setIosKeyId] = useState('')
  const [iosIssuerId, setIosIssuerId] = useState('')
  const [privateKey, setPrivateKey] = useState<File | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.p8')) {
        setError('Please upload a .p8 file')
        return
      }
      setPrivateKey(file)
      setError(null)
    }
  }

  const handleConnect = async () => {
    setError(null)

    if (!iosKeyId || !iosIssuerId || !privateKey) {
      setError('Key ID, Issuer ID, and Private Key are required')
      return
    }

    toast('App Store Connect integration requires manual configuration. Please configure your App Store Connect credentials in your deployment environment.', {
      duration: 5000,
    })
  }

  const handleDisconnect = async () => {
    setError(null)

    toast('App Store Connect integration requires manual configuration. Please remove your App Store Connect credentials from your deployment environment.', {
      duration: 5000,
    })
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* App Store Logo */}
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10">
            <AppStoreLogo />
          </div>

          {/* Heading */}
          <div>
            <h3 className="text-xl font-semibold mb-2">
              {isConnected ? 'App Store Connect Connected' : 'Connect App Store Connect'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isConnected
                ? 'Your App Store Connect API key is connected. Deploy your apps to the App Store.'
                : 'Add your App Store Connect API key to enable iOS app deployment.'}
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
                  <label htmlFor="ios-key-id" className="text-sm font-medium">
                    iOS Key ID
                  </label>
                  <input
                    id="ios-key-id"
                    type="text"
                    placeholder="Enter your key ID"
                    value={iosKeyId}
                    onChange={(e) => setIosKeyId(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="space-y-2 text-left">
                  <label htmlFor="ios-issuer-id" className="text-sm font-medium">
                    iOS Issuer ID
                  </label>
                  <input
                    id="ios-issuer-id"
                    type="text"
                    placeholder="Enter your Issuer ID"
                    value={iosIssuerId}
                    onChange={(e) => setIosIssuerId(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-background border border-input rounded-md focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="space-y-2 text-left">
                  <label htmlFor="authKeyFile" className="text-sm font-medium">
                    Auth Key (.p8)
                  </label>
                  <label
                    htmlFor="authKeyFile"
                    className="border border-dashed border-border rounded-md p-4 text-center bg-secondary/50 cursor-pointer block hover:bg-secondary/70 transition-colors"
                  >
                    <input id="authKeyFile" type="file" accept=".p8" className="hidden" onChange={handleFileChange} />
                    <div className="flex justify-center mb-2">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="text-sm text-foreground">
                      {privateKey ? (
                        <span className="font-medium">{privateKey.name}</span>
                      ) : (
                        <>
                          Click to upload or drag and drop
                          <br />
                          <span className="text-xs text-muted-foreground">(.p8 file only)</span>
                        </>
                      )}
                    </div>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Upload your App Store Connect API private key file (.p8)
                  </p>
                </div>
                <button
                  onClick={handleConnect}
                  disabled={!iosKeyId || !iosIssuerId || !privateKey}
                  className="w-full h-10 px-4 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Key
                </button>
              </>
            )}
          </div>

          {/* Learn More Link */}
          {!isConnected && (
            <a
              href="https://developer.apple.com/documentation/appstoreconnectapi"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground underline transition-colors inline-flex items-center"
            >
              Learn more about App Store Connect API
              <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
