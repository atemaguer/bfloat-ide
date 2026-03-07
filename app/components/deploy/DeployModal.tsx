import { useEffect, useCallback, useRef, useState } from 'react'
import { X, AlertCircle, ExternalLink, Loader2, Smartphone, Globe } from 'lucide-react'
import { useStore } from '@/app/hooks/useStore'
import { deployStore } from '@/app/stores/deploy'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { workbenchStore } from '@/app/stores/workbench'
import { DeployAndroidSection } from './DeployAndroidSection'
import { DeployiOSSection } from './DeployiOSSection'
import { DeployWebSection } from './DeployWebSection'
import { ProdEnvVarsSection } from './ProdEnvVarsSection'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'
import { provider } from '@/app/api/sidecar'

interface DeployPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement>
}

function ExpoConnectForm({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await provider.connectExpo({
        username,
        password,
        otp: otp || undefined,
      })
      if (result.authenticated) {
        await providerAuthStore.loadFromStorage()
        onSuccess()
      } else {
        setError(result.error || 'Login failed. Please check your credentials.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="expo-username" className="block text-xs font-medium text-muted-foreground mb-1">
          Username or Email
        </label>
        <input
          id="expo-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="Enter your Expo username"
          disabled={isLoading}
        />
      </div>
      <div>
        <label htmlFor="expo-password" className="block text-xs font-medium text-muted-foreground mb-1">
          Password
        </label>
        <input
          id="expo-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="Enter your password"
          disabled={isLoading}
        />
      </div>
      <div>
        <label htmlFor="expo-otp" className="block text-xs font-medium text-muted-foreground mb-1">
          2FA Code (optional)
        </label>
        <input
          id="expo-otp"
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="6-digit code"
          disabled={isLoading}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between pt-1">
        <a
          href="https://expo.dev/signup"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          Create account <ExternalLink size={10} />
        </a>
        <button
          type="submit"
          disabled={isLoading || !username || !password}
          className="px-4 py-1.5 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Sign In'}
        </button>
      </div>
    </form>
  )
}

export function DeployModal({ anchorRef }: DeployPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const modalOpen = useStore(deployStore.modalOpen)
  const activeDeployment = useStore(deployStore.activeDeployment)
  const tokens = useStore(providerAuthStore.tokens)
  const currentProject = useStore(workbenchStore.currentProject)

  const [showExpoConnect, setShowExpoConnect] = useState(false)
  const [activeTab, setActiveTab] = useState<'android' | 'ios'>('ios')

  const isDeploying = activeDeployment?.status === 'running'
  const expoConnected = tokens.expo !== null
  const rawAppType = currentProject?.appType || 'mobile'
  const isWebProject = rawAppType === 'web' || rawAppType === 'nextjs' || rawAppType === 'vite' || rawAppType === 'node'

  // Load provider auth status when modal opens
  useEffect(() => {
    if (modalOpen) {
      providerAuthStore.loadFromStorage()
    }
  }, [modalOpen])

  // Handle escape key and click outside
  useEffect(() => {
    if (!modalOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        deployStore.closeModal()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const popover = popoverRef.current
      const anchor = anchorRef.current

      if (
        popover &&
        !popover.contains(target) &&
        anchor &&
        !anchor.contains(target)
      ) {
        deployStore.closeModal()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [modalOpen, anchorRef])

  // Reset expo connect form when modal closes
  useEffect(() => {
    if (!modalOpen) {
      setShowExpoConnect(false)
    }
  }, [modalOpen])

  const handleCloseClick = useCallback(() => {
    deployStore.closeModal()
  }, [])

  const handleExpoConnectSuccess = useCallback(() => {
    setShowExpoConnect(false)
  }, [])

  if (!modalOpen) return null

  return (
    <div
      ref={popoverRef}
      className="absolute top-full right-0 mt-2 w-[400px] max-h-[80vh] overflow-y-auto bg-[oklch(0.227_0_0)] border-0 rounded-2xl shadow-2xl z-[1000] flex flex-col"
      style={{
        animation: 'popoverIn 100ms ease-out',
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-foreground">{isWebProject ? 'Publish Web App' : 'Publish Mobile App'}</h2>
        <button
          className="flex items-center justify-center w-6 h-6 bg-transparent rounded-md text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
          onClick={handleCloseClick}
        >
          <X size={16} />
        </button>
      </div>

      {/* App Preview Card */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-3 p-3 border-0 bg-background rounded-[10px]">
          {currentProject?.iosAppIconUrl && !isWebProject ? (
            <img
              src={currentProject.iosAppIconUrl}
              className="w-10 h-10 rounded-[10px] object-cover"
              alt="App icon"
            />
          ) : (
            <div className="w-10 h-10 rounded-[10px] bg-secondary flex items-center justify-center">
              {isWebProject ? (
                <Globe size={20} className="text-muted-foreground" />
              ) : (
                <Smartphone size={20} className="text-muted-foreground" />
              )}
            </div>
          )}
          <p className="text-base font-medium text-foreground">
            {currentProject?.title || 'My App'}
          </p>
        </div>
      </div>

      {isWebProject && (
        <>
        {/* Web project content */}
        <div className="px-4 pt-4 pb-4">
          <DeployWebSection />
        </div>
        {/* Production env vars */}
        <div className="px-4 pb-4">
          <ProdEnvVarsSection projectId={currentProject?.id} />
        </div>
        </>
      )}

      {!isWebProject && (
        <>
        {/* Expo Connection Warning */}
        {!expoConnected && !showExpoConnect && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Expo not connected</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect your Expo account to publish your app.
                </p>
                <button
                  onClick={() => setShowExpoConnect(true)}
                  className="mt-2 px-3 py-1.5 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 rounded-md transition-colors flex items-center gap-1.5"
                >
                  <div className="w-3.5 h-3.5 flex-shrink-0">
                    <ExpoLogo />
                  </div>
                  Connect Expo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Expo Connect Form */}
        {!expoConnected && showExpoConnect && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-background border-0">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 flex-shrink-0">
                <ExpoLogo />
              </div>
              <span className="text-sm font-medium">Connect to Expo</span>
              <button
                onClick={() => setShowExpoConnect(false)}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
            <ExpoConnectForm onSuccess={handleExpoConnectSuccess} />
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-4 pt-3 pb-0">
          <div className="flex gap-6 border-b border-border">
            <button
              className={`relative pb-2.5 text-sm transition-colors duration-200 ${
                activeTab === 'ios'
                  ? 'font-medium text-foreground'
                  : 'font-normal text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('ios')}
            >
              iOS
              {activeTab === 'ios' && (
                <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-foreground rounded-full" />
              )}
            </button>
            <button
              className={`relative pb-2.5 text-sm transition-colors duration-200 ${
                activeTab === 'android'
                  ? 'font-medium text-foreground'
                  : 'font-normal text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('android')}
            >
              Android
              {activeTab === 'android' && (
                <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-foreground rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="px-4 pt-5 pb-4">
          {activeTab === 'android' && <DeployAndroidSection />}
          {activeTab === 'ios' && (
            <DeployiOSSection disabled={isDeploying || !expoConnected} />
          )}
        </div>

        {/* Production env vars */}
        <div className="px-4 pb-4">
          <ProdEnvVarsSection projectId={currentProject?.id} />
        </div>
        </>
      )}
    </div>
  )
}
