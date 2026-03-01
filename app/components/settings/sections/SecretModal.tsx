import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/app/components/ui/dialog'

interface Secret {
  key: string
  value: string
}

// Common integration key suggestions
const KEY_SUGGESTIONS = [
  { provider: 'Stripe (Web)', keys: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { provider: 'Stripe (Mobile)', keys: ['EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY'] },
  { provider: 'Convex', keys: ['EXPO_PUBLIC_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_URL', 'CONVEX_URL', 'CONVEX_DEPLOY_KEY'] },
  { provider: 'RevenueCat', keys: ['REVENUECAT_API_KEY', 'EXPO_PUBLIC_REVENUECAT_API_KEY', 'REVENUECAT_APPLE_API_KEY', 'REVENUECAT_GOOGLE_API_KEY'] },
  { provider: 'Firebase (Web)', keys: ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'] },
  { provider: 'Firebase (Mobile)', keys: ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'] },
]

interface SecretModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (key: string, value: string) => Promise<void>
  existingSecrets: Secret[]
  editingSecret?: Secret | null
  defaultKey?: string | null
}

export function SecretModal({
  open,
  onOpenChange,
  onSave,
  existingSecrets,
  editingSecret,
  defaultKey,
}: SecretModalProps) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!editingSecret

  useEffect(() => {
    if (open) {
      if (editingSecret) {
        setKey(editingSecret.key)
        setValue(editingSecret.value)
      } else {
        setKey(defaultKey || '')
        setValue('')
      }
      setShowValue(false)
      setError(null)
    }
  }, [open, editingSecret, defaultKey])

  const validateKey = (keyValue: string): string | null => {
    if (!keyValue.trim()) {
      return 'Key is required'
    }

    // Check for valid environment variable name format
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyValue)) {
      return 'Key must start with a letter or underscore, and contain only letters, numbers, and underscores'
    }

    // Check for duplicates (unless we're editing the same key)
    if (!isEditing && existingSecrets.some(s => s.key === keyValue)) {
      return 'A secret with this key already exists'
    }

    return null
  }

  const handleSave = async () => {
    const keyError = validateKey(key)
    if (keyError) {
      setError(keyError)
      return
    }

    if (!value.trim()) {
      setError('Value is required')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await onSave(key.trim(), value)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret')
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeySelect = (selectedKey: string) => {
    setKey(selectedKey)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogClose />
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Secret' : 'Add Secret'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the value for this environment variable.'
              : 'Add a new environment variable to your project.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Quick-add suggestions (only show when adding new secret) */}
          {!isEditing && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Quick Add
              </label>
              <div className="flex flex-wrap gap-2">
                {KEY_SUGGESTIONS.map(({ provider, keys }) => (
                  <button
                    key={provider}
                    type="button"
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      // Find first key not already used
                      const availableKey = keys.find(k => !existingSecrets.some(s => s.key === k))
                      if (availableKey) {
                        handleKeySelect(availableKey)
                      }
                    }}
                  >
                    {provider}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Key input */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Key</label>
            <Input
              placeholder="EXAMPLE_API_KEY"
              value={key}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase())
                setError(null)
              }}
              disabled={isEditing}
              className={isEditing ? 'opacity-60' : ''}
            />
          </div>

          {/* Value input */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Value</label>
            <div className="relative">
              <Input
                type={showValue ? 'text' : 'password'}
                placeholder="Enter secret value"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  setError(null)
                }}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowValue(!showValue)}
              >
                {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !key.trim() || !value.trim()}
          >
            {isSaving ? 'Saving...' : isEditing ? 'Update' : 'Add Secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
