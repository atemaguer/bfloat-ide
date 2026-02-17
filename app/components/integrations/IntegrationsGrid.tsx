import { useState, useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { Loader2, ExternalLink } from 'lucide-react'
import { IntegrationCard } from './IntegrationCard'
import { ProviderAuthModal } from './ProviderAuthModal'
import { providerAuthStore } from '@/app/stores/provider-auth'

// Icons
import ClaudeLogo from '@/app/components/ui/icons/claude-logo'
import OpenAILogo from '@/app/components/ui/icons/openai-logo'
import ConvexLogo from '@/app/components/ui/icons/convex-logo'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'
import FirebaseLogo from '@/app/components/ui/icons/firebase-logo'

// Expo Login Form Component
function ExpoLoginForm({
  onSubmit,
  isLoading,
  error,
}: {
  onSubmit: (credentials: { username: string; password: string; otp?: string }) => Promise<void>
  isLoading: boolean
  error: string | null
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    await onSubmit({ username, password, otp: otp || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="settings-integration-form">
      <div className="settings-integration-form-field">
        <label className="settings-integration-form-label">Username or Email</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="settings-integration-form-input"
          placeholder="Enter your Expo username"
          disabled={isLoading}
        />
      </div>
      <div className="settings-integration-form-field">
        <label className="settings-integration-form-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="settings-integration-form-input"
          placeholder="Enter your password"
          disabled={isLoading}
        />
      </div>
      <div className="settings-integration-form-field">
        <label className="settings-integration-form-label">2FA Code (optional)</label>
        <input
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          className="settings-integration-form-input"
          placeholder="6-digit code"
          disabled={isLoading}
        />
      </div>
      {error && (
        <p className="settings-integration-form-error">{error}</p>
      )}
      <div className="settings-integration-form-actions">
        <a
          href="https://expo.dev/signup"
          target="_blank"
          rel="noopener noreferrer"
          className="settings-integration-form-link"
        >
          Create account <ExternalLink size={10} />
        </a>
        <button
          type="submit"
          disabled={isLoading || !username || !password}
          className="settings-integration-btn connect"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Sign In'}
        </button>
      </div>
    </form>
  )
}

interface IntegrationsGridProps {
  googleConnected: boolean
  convexConnected: boolean
  onGoogleConnect: () => void
  onGoogleDisconnect: () => Promise<void>
  onConvexConnect: () => void
  onConvexDisconnect: () => Promise<void>
}

export function IntegrationsGrid({
  googleConnected,
  convexConnected,
  onGoogleConnect,
  onGoogleDisconnect,
  onConvexConnect,
  onConvexDisconnect,
}: IntegrationsGridProps) {
  const tokens = useStore(providerAuthStore.tokens)
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [authProvider, setAuthProvider] = useState<'anthropic' | 'openai' | null>(null)

  // Load AI provider auth status (including Expo)
  useEffect(() => {
    providerAuthStore.loadFromStorage().finally(() => {
      setIsLoadingProviders(false)
    })
  }, [])

  // Expo uses CLI-based auth, check tokens.expo
  const expoConnected = tokens.expo !== null

  // AI Provider handlers
  const handleConnectClaude = () => {
    setAuthProvider('anthropic')
  }

  const handleDisconnectClaude = async () => {
    const result = await window.conveyor.provider.disconnect('anthropic')
    if (result.success) {
      providerAuthStore.clearTokens('anthropic')
    }
  }

  const handleConnectOpenAI = () => {
    setAuthProvider('openai')
  }

  const handleDisconnectOpenAI = async () => {
    const result = await window.conveyor.provider.disconnect('openai')
    if (result.success) {
      providerAuthStore.clearTokens('openai')
    }
  }

  const handleAuthComplete = async () => {
    await providerAuthStore.loadFromStorage()
    setAuthProvider(null)
  }

  // Expo handlers - using EAS CLI with credentials
  const [expoLoading, setExpoLoading] = useState(false)
  const [expoError, setExpoError] = useState<string | null>(null)

  const handleConnectExpo = async (credentials: { username: string; password: string; otp?: string }) => {
    setExpoLoading(true)
    setExpoError(null)
    try {
      const result = await window.conveyor.provider.connectExpo(credentials)
      if (result.authenticated) {
        await providerAuthStore.loadFromStorage()
      } else {
        // Show the actual error from the API if available
        setExpoError(result.error || 'Login failed. Please check your credentials.')
      }
    } catch (err) {
      setExpoError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setExpoLoading(false)
    }
  }

  const handleDisconnectExpo = async () => {
    const result = await window.conveyor.provider.disconnect('expo')
    if (result.success) {
      providerAuthStore.clearTokens('expo')
    }
  }

  if (isLoadingProviders) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#555' }} />
      </div>
    )
  }

  return (
    <div>
      {/* AI Providers Section */}
      <div className="settings-integrations-section">
        <h3 className="settings-integrations-heading">AI Providers</h3>
        <div className="settings-integrations-list">
          <IntegrationCard
            id="claude"
            name="Claude"
            description="Connect your Claude Max or Pro subscription to use Anthropic's AI models"
            icon={<ClaudeLogo width="24" height="24" />}
            isConnected={tokens.anthropic !== null}
            onConnect={handleConnectClaude}
            onDisconnect={handleDisconnectClaude}
          />
          <IntegrationCard
            id="openai"
            name="ChatGPT"
            description="Connect your ChatGPT Plus or Team subscription to use OpenAI models"
            icon={<OpenAILogo width="24" height="24" />}
            isConnected={tokens.openai !== null}
            onConnect={handleConnectOpenAI}
            onDisconnect={handleDisconnectOpenAI}
          />
        </div>
      </div>

      {/* Backend Services Section */}
      <div className="settings-integrations-section">
        <h3 className="settings-integrations-heading">Backend Services</h3>
        <div className="settings-integrations-list">
          <IntegrationCard
            id="firebase"
            name="Firebase"
            description="Backend platform for building web and mobile apps with authentication, database, and hosting"
            icon={<FirebaseLogo width="24" height="24" />}
            isConnected={googleConnected}
            onConnect={onGoogleConnect}
            onDisconnect={onGoogleDisconnect}
          />
          <IntegrationCard
            id="convex"
            name="Convex"
            description="Backend database and serverless functions platform with real-time sync"
            icon={<ConvexLogo width="24" height="24" />}
            isConnected={convexConnected}
            onConnect={onConvexConnect}
            onDisconnect={onConvexDisconnect}
          />
        </div>
      </div>

      {/* Deployment Section */}
      <div className="settings-integrations-section">
        <h3 className="settings-integrations-heading">Deployment</h3>
        <div className="settings-integrations-list">
          {/* Expo - uses EAS CLI for authentication */}
          <IntegrationCard
            id="expo"
            name="Expo"
            description={expoConnected && tokens.expo?.username
              ? `Connected as ${tokens.expo.username}`
              : "Mobile app development and deployment platform for React Native"}
            icon={<ExpoLogo width="24" height="24" />}
            isConnected={expoConnected}
            onDisconnect={handleDisconnectExpo}
            expandedContent={
              !expoConnected ? (
                <ExpoLoginForm
                  onSubmit={handleConnectExpo}
                  isLoading={expoLoading}
                  error={expoError}
                />
              ) : undefined
            }
          />
        </div>
      </div>

      {authProvider && (
        <ProviderAuthModal
          open={authProvider !== null}
          provider={authProvider}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setAuthProvider(null)
            }
          }}
          onComplete={handleAuthComplete}
        />
      )}
    </div>
  )
}
