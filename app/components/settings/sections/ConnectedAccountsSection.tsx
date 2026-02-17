import { useState, useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { Check, Loader2, ExternalLink, ChevronDown, ChevronUp, Github } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/app/components/ui/button'
import { ProviderAuthModal } from '@/app/components/integrations/ProviderAuthModal'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { SettingsCard } from '../components'

// Icons
import ClaudeLogo from '@/app/components/ui/icons/claude-logo'
import OpenAILogo from '@/app/components/ui/icons/openai-logo'
import ConvexLogo from '@/app/components/ui/icons/convex-logo'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'
import StripeLogo from '@/app/components/ui/icons/stripe-logo'
import RevenueCatLogo from '@/app/components/ui/icons/revenuecat-logo'

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg bg-muted p-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-medium text-muted-foreground">Username or Email</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your Expo username"
          disabled={isLoading}
          className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-muted-foreground/30 focus:border-muted-foreground/50 focus:outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-medium text-muted-foreground">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          disabled={isLoading}
          className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-muted-foreground/30 focus:border-muted-foreground/50 focus:outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] font-medium text-muted-foreground">2FA Code (optional)</label>
        <input
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="6-digit code"
          disabled={isLoading}
          className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-muted-foreground/30 focus:border-muted-foreground/50 focus:outline-none disabled:opacity-60"
        />
      </div>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        <a
          href="https://expo.dev/signup"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          Create account <ExternalLink size={10} />
        </a>
        <Button
          type="submit"
          disabled={isLoading || !username || !password}
          size="sm"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Sign In'}
        </Button>
      </div>
    </form>
  )
}

interface Integration {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  isConnected: boolean
  isLoading?: boolean
  onConnect?: () => void | Promise<void>
  onDisconnect?: () => void | Promise<void>
  expandable?: boolean
  expandedContent?: React.ReactNode
}

function IntegrationItem({ integration, isLast = false }: { integration: Integration; isLast?: boolean }) {
  const [actionLoading, setActionLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const handleAction = async () => {
    if (actionLoading) return
    setActionLoading(true)
    try {
      if (integration.isConnected && integration.onDisconnect) {
        await integration.onDisconnect()
      } else if (!integration.isConnected && integration.onConnect) {
        await integration.onConnect()
      }
    } finally {
      setActionLoading(false)
    }
  }

  const showExpandButton = !integration.isConnected && integration.expandable

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
            {integration.icon}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{integration.name}</span>
            <span
              className={cn(
                'flex items-center gap-1 text-[13px]',
                integration.isConnected ? 'text-green-500' : 'text-muted-foreground'
              )}
            >
              {integration.isLoading ? (
                'Checking...'
              ) : integration.isConnected ? (
                <>
                  <Check size={12} />
                  Connected
                </>
              ) : (
                integration.description
              )}
            </span>
          </div>
        </div>
        <div className="ml-4 flex-shrink-0">
          {integration.isLoading ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 size={14} className="animate-spin" />
            </Button>
          ) : integration.isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAction}
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : 'Disconnect'}
            </Button>
          ) : showExpandButton ? (
            <Button
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="gap-1"
            >
              Connect
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleAction}
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && integration.expandedContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-5 pb-5 pl-[68px]">
              {integration.expandedContent}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ConnectedAccountsSection() {
  const tokens = useStore(providerAuthStore.tokens)
  const authInvalidated = useStore(providerAuthStore.authInvalidated)
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [authProvider, setAuthProvider] = useState<'anthropic' | 'openai' | null>(null)
  const [expoLoading, setExpoLoading] = useState(false)
  const [expoError, setExpoError] = useState<string | null>(null)

  // Load AI provider auth status
  useEffect(() => {
    providerAuthStore.loadFromStorage().finally(() => {
      setIsLoadingProviders(false)
    })
  }, [])

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
    // Clear auth invalidation flags and reload tokens
    if (authProvider) {
      providerAuthStore.clearAuthInvalidated(authProvider)
    }
    await providerAuthStore.loadFromStorage()
    setAuthProvider(null)
  }

  // Expo handlers
  const expoConnected = tokens.expo !== null

  const handleConnectExpo = async (credentials: { username: string; password: string; otp?: string }) => {
    setExpoLoading(true)
    setExpoError(null)
    try {
      const result = await window.conveyor.provider.connectExpo(credentials)
      if (result.authenticated) {
        await providerAuthStore.loadFromStorage()
      } else {
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

  // Debug logging
  console.log('[ConnectedAccountsSection] tokens.anthropic:', tokens.anthropic)
  console.log('[ConnectedAccountsSection] authInvalidated.anthropic:', authInvalidated.anthropic)
  console.log('[ConnectedAccountsSection] isLoadingProviders:', isLoadingProviders)

  const aiProviders: Integration[] = [
    {
      id: 'claude',
      name: 'Claude',
      description: 'Connect your Claude Max or Pro subscription',
      icon: <ClaudeLogo width="24" height="24" />,
      // Check both token existence AND that auth hasn't been invalidated by an API error
      isConnected: tokens.anthropic !== null && !authInvalidated.anthropic,
      isLoading: isLoadingProviders,
      onConnect: handleConnectClaude,
      onDisconnect: handleDisconnectClaude,
    },
    {
      id: 'openai',
      name: 'ChatGPT',
      description: 'Connect your ChatGPT Plus or Team subscription',
      icon: <OpenAILogo width="24" height="24" />,
      // Check both token existence AND that auth hasn't been invalidated by an API error
      isConnected: tokens.openai !== null && !authInvalidated.openai,
      isLoading: isLoadingProviders,
      onConnect: handleConnectOpenAI,
      onDisconnect: handleDisconnectOpenAI,
    },
  ]

  const backendServices: Integration[] = [
    {
      id: 'convex',
      name: 'Convex',
      description: 'Real-time backend with serverless functions',
      icon: <ConvexLogo width="24" height="24" />,
      isConnected: false,
      isLoading: false,
    },
    {
      id: 'stripe',
      name: 'Stripe',
      description: 'Payments, subscriptions, and billing',
      icon: <StripeLogo width="24" height="24" />,
      isConnected: false,
      isLoading: false,
    },
    {
      id: 'revenuecat',
      name: 'RevenueCat',
      description: 'In-app purchases and subscription management',
      icon: <RevenueCatLogo width="24" height="24" />,
      isConnected: false,
      isLoading: false,
    },
    {
      id: 'github',
      name: 'GitHub',
      description: 'Source control and repository access',
      icon: <Github size={24} />,
      isConnected: false,
      isLoading: false,
    },
  ]

  const deployment: Integration[] = [
    {
      id: 'expo',
      name: 'Expo',
      description: expoConnected && tokens.expo?.username
        ? `Connected as ${tokens.expo.username}`
        : 'Mobile app development and deployment',
      icon: <ExpoLogo width="24" height="24" />,
      isConnected: expoConnected,
      isLoading: isLoadingProviders,
      onDisconnect: handleDisconnectExpo,
      expandable: true,
      expandedContent: (
        <ExpoLoginForm
          onSubmit={handleConnectExpo}
          isLoading={expoLoading}
          error={expoError}
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold text-foreground">Connected accounts</h1>
        <p className="text-sm text-muted-foreground">
          Connect external services to enhance your development workflow.
        </p>
      </div>

      {/* AI Providers */}
      <SettingsCard title="AI Providers">
        {aiProviders.map((integration, idx) => (
          <IntegrationItem
            key={integration.id}
            integration={integration}
            isLast={idx === aiProviders.length - 1}
          />
        ))}
      </SettingsCard>

      {/* Backend Services */}
      <SettingsCard title="Backend Services">
        {backendServices.map((integration, idx) => (
          <IntegrationItem
            key={integration.id}
            integration={integration}
            isLast={idx === backendServices.length - 1}
          />
        ))}
      </SettingsCard>

      {/* Deployment */}
      <SettingsCard title="Deployment">
        {deployment.map((integration, idx) => (
          <IntegrationItem
            key={integration.id}
            integration={integration}
            isLast={idx === deployment.length - 1}
          />
        ))}
      </SettingsCard>

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
