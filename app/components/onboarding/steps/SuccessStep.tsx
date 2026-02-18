import { useStore } from '@/app/hooks/useStore'
import { PartyPopper, Check } from 'lucide-react'
import { providerAuthStore } from '@/app/stores/provider-auth'
import ClaudeLogo from '@/app/components/ui/icons/claude-logo'
import OpenAILogo from '@/app/components/ui/icons/openai-logo'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'

interface SuccessStepProps {
  onComplete: () => void
}

export function SuccessStep({ onComplete }: SuccessStepProps) {
  const tokens = useStore(providerAuthStore.tokens)

  const connectedServices = []
  if (tokens.anthropic) {
    connectedServices.push({
      name: 'Claude',
      icon: <ClaudeLogo width="20" height="20" />,
    })
  }
  if (tokens.openai) {
    connectedServices.push({
      name: 'ChatGPT',
      icon: <OpenAILogo width="20" height="20" />,
    })
  }
  if (tokens.expo) {
    connectedServices.push({
      name: `Expo (${tokens.expo.username || 'connected'})`,
      icon: <ExpoLogo width="20" height="20" />,
    })
  }

  return (
    <div className="flex flex-col items-center text-center">
      {/* Celebration Icon */}
      <div className="w-20 h-20 rounded-2xl bg-green-500/10 flex items-center justify-center mb-8">
        <PartyPopper className="w-10 h-10 text-green-500" />
      </div>

      {/* Title */}
      <h2 className="text-3xl font-bold text-[#e5e5e5] mb-4">
        You're All Set!
      </h2>

      {/* Description */}
      <p className="text-[#9a9a9a] text-lg mb-8">
        Your account is ready. Start building amazing mobile apps!
      </p>

      {/* Connected Services Summary */}
      <div className="w-full max-w-xs mb-10">
        <h3 className="text-sm font-medium text-[#9a9a9a] mb-3 uppercase tracking-wide">
          Connected Services
        </h3>
        <div className="space-y-2">
          {connectedServices.map((service) => (
            <div
              key={service.name}
              className="flex items-center gap-3 p-3 rounded-lg bg-[#2a2a2a] border border-[#3a3a3a]"
            >
              <div className="w-8 h-8 rounded-lg bg-[#3a3a3a] flex items-center justify-center">
                {service.icon}
              </div>
              <span className="flex-1 text-left text-sm font-medium text-[#e5e5e5]">
                {service.name}
              </span>
              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Enter App Button */}
      <button
        onClick={onComplete}
        className="px-10 py-3 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-medium rounded-xl transition-colors text-lg"
      >
        Enter App
      </button>
    </div>
  )
}
