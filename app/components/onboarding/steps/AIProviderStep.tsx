import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { Bot, Check, Loader2, ArrowLeft, ArrowRight } from 'lucide-react'
import { providerAuthStore } from '@/app/stores/provider-auth'
import ClaudeLogo from '@/app/components/ui/icons/claude-logo'
import OpenAILogo from '@/app/components/ui/icons/openai-logo'
import { ProviderAuthModal } from '@/app/components/integrations/ProviderAuthModal'

interface AIProviderStepProps {
  onNext: () => void
  onBack: () => void
  canProceed: boolean
}

export function AIProviderStep({ onNext, onBack, canProceed }: AIProviderStepProps) {
  const tokens = useStore(providerAuthStore.tokens)
  const [authProvider, setAuthProvider] = useState<'anthropic' | 'openai' | null>(null)

  const claudeConnected = tokens.anthropic !== null
  const openaiConnected = tokens.openai !== null
  const claudeConnecting = authProvider === 'anthropic'
  const openaiConnecting = authProvider === 'openai'

  const handleConnectClaude = async () => {
    setAuthProvider('anthropic')
  }

  const handleConnectOpenAI = async () => {
    setAuthProvider('openai')
  }

  return (
    <div className="flex flex-col items-center">
      {/* Icon */}
      <div className="w-16 h-16 rounded-2xl bg-[#3b82f6]/10 flex items-center justify-center mb-6">
        <Bot className="w-8 h-8 text-[#3b82f6]" />
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-[#e5e5e5] mb-2 text-center">
        Connect Your AI
      </h2>

      {/* Description */}
      <p className="text-[#9a9a9a] text-center mb-8">
        Connect at least one AI provider to power your app development.
        You can use your existing Claude or ChatGPT subscription.
      </p>

      {/* Provider Cards */}
      <div className="grid grid-cols-2 gap-4 w-full mb-8">
        {/* Claude Card */}
        <div
          className={`relative p-6 rounded-xl border-2 transition-all ${
            claudeConnected
              ? 'border-green-500/50 bg-green-500/5'
              : 'border-[#3a3a3a] bg-[#2a2a2a] hover:border-[#3b82f6]/30'
          }`}
        >
          {claudeConnected && (
            <div className="absolute top-3 right-3">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            </div>
          )}
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-[#3a3a3a] flex items-center justify-center mb-3">
              <ClaudeLogo width="28" height="28" />
            </div>
            <h3 className="font-semibold text-[#e5e5e5] mb-1">Claude</h3>
            <p className="text-xs text-[#9a9a9a] mb-4">
              Claude Max or Pro
            </p>
            {claudeConnected ? (
              <span className="text-sm text-green-400">Connected</span>
            ) : (
              <button
                onClick={handleConnectClaude}
                disabled={claudeConnecting}
                className="px-4 py-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {claudeConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Connect'
                )}
              </button>
            )}
          </div>
        </div>

        {/* OpenAI Card */}
        <div
          className={`relative p-6 rounded-xl border-2 transition-all ${
            openaiConnected
              ? 'border-green-500/50 bg-green-500/5'
              : 'border-[#3a3a3a] bg-[#2a2a2a] hover:border-[#3b82f6]/30'
          }`}
        >
          {openaiConnected && (
            <div className="absolute top-3 right-3">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            </div>
          )}
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-[#3a3a3a] flex items-center justify-center mb-3">
              <OpenAILogo width="28" height="28" />
            </div>
            <h3 className="font-semibold text-[#e5e5e5] mb-1">ChatGPT</h3>
            <p className="text-xs text-[#9a9a9a] mb-4">
              ChatGPT Plus or Team
            </p>
            {openaiConnected ? (
              <span className="text-sm text-green-400">Connected</span>
            ) : (
              <button
                onClick={handleConnectOpenAI}
                disabled={openaiConnecting}
                className="px-4 py-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {openaiConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Connect'
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between w-full">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 text-[#9a9a9a] hover:text-[#e5e5e5] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="flex items-center gap-2 px-6 py-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {!canProceed && (
        <p className="text-sm text-[#9a9a9a] mt-4">
          Please connect at least one AI provider to continue
        </p>
      )}

      {authProvider && (
        <ProviderAuthModal
          open={!!authProvider}
          provider={authProvider}
          onOpenChange={(open) => {
            if (!open) {
              setAuthProvider(null)
            }
          }}
          onComplete={async () => {
            await providerAuthStore.loadFromStorage()
            setAuthProvider(null)
          }}
        />
      )}
    </div>
  )
}
