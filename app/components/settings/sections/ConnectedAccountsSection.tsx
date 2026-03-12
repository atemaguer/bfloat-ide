import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import { showErrorToast } from '@/app/components/ui/ErrorToast'
import { provider } from '@/app/api/sidecar'
import { ProviderAuthModal } from '@/app/components/integrations/ProviderAuthModal'
import { ProviderCredentialsModal } from '@/app/components/settings/sections/ProviderCredentialsModal'
import {
  getProviderCredentialKeys,
  hasProviderCredentials,
  type ConnectedAccountId,
  type ProviderCredentialKey,
} from '@/app/lib/provider-credentials'
import { cn } from '@/lib/utils'

import { SettingsCard } from '../components'
import ClaudeLogo from '@/app/components/ui/icons/claude-logo'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'
import OpenAILogo from '@/app/components/ui/icons/openai-logo'

interface Integration {
  id: 'anthropic' | 'openai' | 'expo'
  name: string
  description: string
  icon: React.ReactNode
  isConnected: boolean
  isLoading?: boolean
  onConnect?: () => void | Promise<void>
  onDisconnect?: () => void | Promise<void>
}

interface ProviderSettings {
  credentials?: Partial<Record<ProviderCredentialKey, string>>
}

interface ProviderAuthState {
  anthropic: unknown | null
  openai: unknown | null
  expo: unknown | null
}

function IntegrationItem({ integration, isLast = false }: { integration: Integration; isLast?: boolean }) {
  const [actionLoading, setActionLoading] = useState(false)
  const hasAction = Boolean(
    (integration.isConnected && integration.onDisconnect) || (!integration.isConnected && integration.onConnect)
  )

  const handleAction = async () => {
    if (!hasAction || actionLoading) return

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
        {hasAction && (
          <div className="ml-4 flex-shrink-0">
            {integration.isLoading ? (
              <Button variant="outline" size="sm" disabled>
                <Loader2 size={14} className="animate-spin" />
              </Button>
            ) : (
              <Button size="sm" variant={integration.isConnected ? 'outline' : 'default'} onClick={handleAction} disabled={actionLoading}>
                {actionLoading ? <Loader2 size={14} className="animate-spin" /> : integration.isConnected ? 'Disconnect' : 'Connect'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ConnectedAccountsSection() {
  const [settings, setSettings] = useState<ProviderSettings>({})
  const [authState, setAuthState] = useState<ProviderAuthState>({ anthropic: null, openai: null, expo: null })
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [isLoadingAuth, setIsLoadingAuth] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeAccountId, setActiveAccountId] = useState<ConnectedAccountId | null>(null)
  const [authProvider, setAuthProvider] = useState<'anthropic' | 'openai' | null>(null)

  const loadState = async () => {
    setIsLoadingSettings(true)
    setIsLoadingAuth(true)

    try {
      const [nextSettings, nextAuthState] = await Promise.all([provider.getSettings(), provider.loadTokens()])
      setSettings(nextSettings)
      setAuthState(nextAuthState)
    } catch (error) {
      showErrorToast(error, { maxLength: 180 })
    } finally {
      setIsLoadingSettings(false)
      setIsLoadingAuth(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  const credentials = settings.credentials ?? {}

  const openCredentialsModal = (accountId: ConnectedAccountId) => {
    setActiveAccountId(accountId)
    setIsModalOpen(true)
  }

  const openAuthModal = (authProviderId: 'anthropic' | 'openai') => {
    setAuthProvider(authProviderId)
  }

  const handleDisconnect = async (accountId: ConnectedAccountId) => {
    const entries = getProviderCredentialKeys(accountId).map((key) => ({ key, value: '' }))

    try {
      const nextSettings = await provider.saveSettingsCredentials({ entries })
      setSettings(nextSettings)
    } catch (error) {
      showErrorToast(error, { maxLength: 180 })
    }
  }

  const handleSaveCredentials = async (entries: Array<{ key: ProviderCredentialKey; value: string }>) => {
    const nextSettings = await provider.saveSettingsCredentials({ entries })
    setSettings(nextSettings)
  }

  const aiProviders: Integration[] = [
    {
      id: 'anthropic',
      name: 'Claude',
      description: 'Authenticate the Claude CLI locally to use Claude sessions in the IDE.',
      icon: <ClaudeLogo width="24" height="24" />,
      isConnected: authState.anthropic !== null,
      isLoading: isLoadingAuth,
      onConnect: () => openAuthModal('anthropic'),
    },
    {
      id: 'openai',
      name: 'Codex',
      description: 'Authenticate the Codex CLI locally to use Codex sessions in the IDE.',
      icon: <OpenAILogo width="24" height="24" />,
      isConnected: authState.openai !== null,
      isLoading: isLoadingAuth,
      onConnect: () => openAuthModal('openai'),
    },
  ]

  const deployment: Integration[] = [
    {
      id: 'expo',
      name: 'Expo',
      description: 'Save an Expo access token',
      icon: <ExpoLogo width="24" height="24" />,
      isConnected: hasProviderCredentials(credentials, 'expo'),
      isLoading: isLoadingSettings,
      onConnect: () => openCredentialsModal('expo'),
      onDisconnect: () => handleDisconnect('expo'),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold text-foreground">Connected accounts</h1>
        <p className="text-sm text-muted-foreground">
          Review local CLI account status and save the global credentials the IDE actually uses.
        </p>
      </div>

      <SettingsCard title="AI Providers">
        {aiProviders.map((integration, idx) => (
          <IntegrationItem key={integration.id} integration={integration} isLast={idx === aiProviders.length - 1} />
        ))}
      </SettingsCard>

      <SettingsCard title="Deployment">
        {deployment.map((integration, idx) => (
          <IntegrationItem key={integration.id} integration={integration} isLast={idx === deployment.length - 1} />
        ))}
      </SettingsCard>

      <ProviderCredentialsModal
        open={isModalOpen}
        onOpenChange={(nextOpen) => {
          setIsModalOpen(nextOpen)
          if (!nextOpen) {
            setActiveAccountId(null)
          }
        }}
        accountId={activeAccountId}
        existingCredentials={credentials}
        onSaveMany={handleSaveCredentials}
      />

      {authProvider && (
        <ProviderAuthModal
          open={authProvider !== null}
          provider={authProvider}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setAuthProvider(null)
            }
          }}
          onComplete={async () => {
            await loadState()
            setAuthProvider(null)
          }}
        />
      )}
    </div>
  )
}
