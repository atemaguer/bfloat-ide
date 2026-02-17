import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { deployStore } from '@/app/stores/deploy'

interface AppleCredentialsFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export function AppleCredentialsForm({ onSuccess, onCancel }: AppleCredentialsFormProps) {
  const [appleId, setAppleId] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Load cached Apple ID on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem('bfloat_apple_id')
      if (cached) {
        setAppleId(cached)
      }
    } catch {
      // Ignore storage errors
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appleId || !password) return

    setIsLoading(true)

    try {
      // Store credentials in deployStore for use during deployment
      deployStore.setPendingAppleCredentials(appleId, password)

      // Cache Apple ID in localStorage for convenience
      try {
        localStorage.setItem('bfloat_apple_id', appleId)
      } catch {
        // Ignore storage errors
      }

      onSuccess()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="apple-id-input" className="block text-xs font-medium text-muted-foreground mb-1">
          Apple ID
        </label>
        <input
          id="apple-id-input"
          type="text"
          value={appleId}
          onChange={(e) => setAppleId(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="your@email.com"
          disabled={isLoading}
          autoComplete="username"
        />
      </div>
      <div>
        <label htmlFor="apple-password-input" className="block text-xs font-medium text-muted-foreground mb-1">
          Apple ID Password
        </label>
        <input
          id="apple-password-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="Your Apple ID password"
          disabled={isLoading}
          autoComplete="current-password"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          If you have 2FA enabled, you'll be prompted for a code during deployment.
        </p>
      </div>
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading || !appleId || !password}
          className="px-4 py-1.5 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Save Credentials'}
        </button>
      </div>
    </form>
  )
}
