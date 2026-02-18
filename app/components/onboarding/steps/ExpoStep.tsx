import { useState } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { Smartphone, Check, Loader2, ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react'
import { providerAuthStore } from '@/app/stores/provider-auth'
import ExpoLogo from '@/app/components/ui/icons/expo-logo'

interface ExpoStepProps {
  onNext: () => void
  onBack: () => void
  canProceed: boolean
}

export function ExpoStep({ onNext, onBack, canProceed }: ExpoStepProps) {
  const tokens = useStore(providerAuthStore.tokens)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expoConnected = tokens.expo !== null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return

    setIsLoading(true)
    setError(null)
    try {
      const result = await window.conveyor.provider.connectExpo({
        username,
        password,
        otp: otp || undefined,
      })
      if (result.authenticated) {
        await providerAuthStore.loadFromStorage()
      } else {
        // Show the actual error from the API if available
        setError(result.error || 'Login failed. Please check your credentials.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center">
      {/* Icon */}
      <div className="w-16 h-16 rounded-2xl bg-[#3b82f6]/10 flex items-center justify-center mb-6">
        <Smartphone className="w-8 h-8 text-[#3b82f6]" />
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-[#e5e5e5] mb-2 text-center">
        Connect Expo
      </h2>

      {/* Description */}
      <p className="text-[#9a9a9a] text-center mb-8">
        Connect your Expo account to build and deploy mobile apps.
      </p>

      {/* Connection Status / Form */}
      <div className="w-full max-w-sm mb-8">
        {expoConnected ? (
          <div className="p-6 rounded-xl border-2 border-green-500/50 bg-green-500/5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <ExpoLogo width="28" height="28" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[#e5e5e5]">Expo</h3>
                  <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                </div>
                <p className="text-sm text-green-400">
                  Connected as {tokens.expo?.username || 'user'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-xl border border-[#3a3a3a] bg-[#2a2a2a]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#3a3a3a] flex items-center justify-center">
                <ExpoLogo width="24" height="24" />
              </div>
              <h3 className="font-semibold text-[#e5e5e5]">Sign in to Expo</h3>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#9a9a9a] mb-1">
                  Username or Email
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-[#e5e5e5] bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 focus:border-[#3b82f6]"
                  placeholder="Enter your Expo username"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9a9a9a] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-[#e5e5e5] bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 focus:border-[#3b82f6]"
                  placeholder="Enter your password"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9a9a9a] mb-1">
                  2FA Code (optional)
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-[#e5e5e5] bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 focus:border-[#3b82f6]"
                  placeholder="6-digit code"
                  disabled={isLoading}
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <a
                  href="https://expo.dev/signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#9a9a9a] hover:text-[#e5e5e5] flex items-center gap-1"
                >
                  Create account <ExternalLink size={10} />
                </a>
                <button
                  type="submit"
                  disabled={isLoading || !username || !password}
                  className="px-4 py-1.5 text-sm font-medium bg-[#3b82f6] hover:bg-[#2563eb] text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Sign In'}
                </button>
              </div>
            </form>
          </div>
        )}
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
          Please connect your Expo account to continue
        </p>
      )}
    </div>
  )
}
