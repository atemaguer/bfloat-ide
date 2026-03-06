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
  getIntegrationCredentialSpec,
  type ConnectIntegrationId,
  type NormalizedAppType,
} from '@/app/lib/integrations/credentials'

interface SecretEntry {
  key: string
  value: string
}

export interface IntegrationSaveResult {
  successes: string[]
  failures: Array<{ key: string; error: string }>
}

interface IntegrationCredentialsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  integrationId: ConnectIntegrationId | null
  appType: NormalizedAppType
  existingSecrets: SecretEntry[]
  onSaveMany: (entries: Array<{ key: string; value: string }>) => Promise<IntegrationSaveResult>
}

export function IntegrationCredentialsModal({
  open,
  onOpenChange,
  integrationId,
  appType,
  existingSecrets,
  onSaveMany,
}: IntegrationCredentialsModalProps) {
  const spec = useMemo(() => {
    if (!integrationId) return null
    return getIntegrationCredentialSpec(integrationId, appType)
  }, [integrationId, appType])

  const [values, setValues] = useState<Record<string, string>>({})
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saveFailures, setSaveFailures] = useState<Array<{ key: string; error: string }>>([])

  useEffect(() => {
    if (!open || !spec) return

    const valueMap: Record<string, string> = {}
    const visibilityMap: Record<string, boolean> = {}
    for (const field of spec.fields) {
      const current = existingSecrets.find((secret) => secret.key === field.key)
      valueMap[field.key] = current?.value || ''
      visibilityMap[field.key] = false
    }

    setValues(valueMap)
    setShowValues(visibilityMap)
    setValidationError(null)
    setSaveFailures([])
  }, [open, spec, existingSecrets])

  if (!spec) return null

  const missingRequired = spec.fields.find((field) => field.required && !values[field.key]?.trim())

  const handleSave = async () => {
    if (missingRequired) {
      setValidationError(`"${missingRequired.label}" is required`)
      return
    }

    setIsSaving(true)
    setValidationError(null)
    setSaveFailures([])

    try {
      const entries = spec.fields.map((field) => ({
        key: field.key,
        value: values[field.key]?.trim() || '',
      }))

      const result = await onSaveMany(entries)
      setSaveFailures(result.failures)
      if (result.failures.length === 0) {
        onOpenChange(false)
      }
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Failed to save integration credentials')
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() =>
                        setShowValues((prev) => ({
                          ...prev,
                          [field.key]: !prev[field.key],
                        }))
                      }
                    >
                      {showValues[field.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono">{field.key}</p>
              </div>
            )
          })}

          {validationError && <p className="text-sm text-destructive">{validationError}</p>}
          {saveFailures.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive font-medium">Some keys failed to save:</p>
              <ul className="mt-2 space-y-1">
                {saveFailures.map((failure) => (
                  <li key={failure.key} className="text-xs text-destructive">
                    {failure.key}: {failure.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
