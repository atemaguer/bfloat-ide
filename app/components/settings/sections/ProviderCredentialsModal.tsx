import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import {
  getProviderCredentialSpec,
  type ConnectedAccountId,
  type ProviderCredentialKey,
} from '@/app/lib/provider-credentials'

interface ProviderCredentialsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: ConnectedAccountId | null
  existingCredentials: Partial<Record<ProviderCredentialKey, string>>
  onSaveMany: (entries: Array<{ key: ProviderCredentialKey; value: string }>) => Promise<void>
}

export function ProviderCredentialsModal({
  open,
  onOpenChange,
  accountId,
  existingCredentials,
  onSaveMany,
}: ProviderCredentialsModalProps) {
  const spec = useMemo(() => {
    if (!accountId) return null
    return getProviderCredentialSpec(accountId)
  }, [accountId])

  const [values, setValues] = useState<Record<string, string>>({})
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !spec) return

    const nextValues: Record<string, string> = {}
    const nextShowValues: Record<string, boolean> = {}
    for (const field of spec.fields) {
      nextValues[field.key] = existingCredentials[field.key] || ''
      nextShowValues[field.key] = false
    }

    setValues(nextValues)
    setShowValues(nextShowValues)
    setValidationError(null)
  }, [existingCredentials, open, spec])

  if (!spec) return null

  const missingRequired = spec.fields.find((field) => field.required && !values[field.key]?.trim())

  const handleSave = async () => {
    if (missingRequired) {
      setValidationError(`"${missingRequired.label}" is required`)
      return
    }

    setIsSaving(true)
    setValidationError(null)

    try {
      await onSaveMany(
        spec.fields.map((field) => ({
          key: field.key,
          value: values[field.key]?.trim() || '',
        }))
      )
      onOpenChange(false)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Failed to save credentials')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogClose />
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {spec.fields.map((field) => {
            const isSensitive = field.sensitive !== false

            return (
              <div key={field.key} className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">{field.label}</label>
                {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                <div className="relative">
                  <Input
                    type={isSensitive && !showValues[field.key] ? 'password' : 'text'}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    value={values[field.key] || ''}
                    onChange={(e) => {
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      setValidationError(null)
                    }}
                    className={isSensitive ? 'pr-10' : ''}
                  />
                  {isSensitive && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setShowValues((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                    >
                      {showValues[field.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                </div>
                <p className="font-mono text-xs text-muted-foreground">{field.key}</p>
              </div>
            )
          })}

          {validationError && <p className="text-sm text-destructive">{validationError}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving || !!missingRequired}>
            {isSaving ? 'Saving...' : 'Save Credentials'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
