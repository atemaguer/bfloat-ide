/**
 * TwoFactorStep - 6-digit verification code input
 *
 * Displays a 6-digit code input for Apple's 2FA.
 * Shows context about where the code was sent.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Loader2,
  AlertCircle,
  Smartphone,
} from 'lucide-react'

interface TwoFactorStepProps {
  onSubmit: (code: string) => void
  onCancel: () => void
  isSubmitting?: boolean
  error?: string | null
}

export function TwoFactorStep({
  onSubmit,
  onCancel,
  isSubmitting = false,
  error,
}: TwoFactorStepProps) {
  const [code, setCode] = useState('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleDigitChange = useCallback((index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1)

    setCode((prev) => {
      const chars = prev.split('')
      chars[index] = digit
      return chars.join('').slice(0, 6)
    })

    // Move to next input if digit entered
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }, [])

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === 'Backspace') {
      if (!code[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
      }
      setCode((prev) => {
        const chars = prev.split('')
        chars[index] = ''
        return chars.join('')
      })
    }

    // Handle left/right arrow keys
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }, [code])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    setCode(pasted)

    // Focus last filled input or first empty one
    const focusIndex = Math.min(pasted.length, 5)
    inputRefs.current[focusIndex]?.focus()
  }, [])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (code.length === 6 && !isSubmitting) {
      onSubmit(code)
    }
  }, [code, isSubmitting, onSubmit])

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !isSubmitting) {
      onSubmit(code)
    }
  }, [code, isSubmitting, onSubmit])

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Smartphone size={32} className="text-primary" />
          </div>
        </div>
        <h3 className="text-lg font-semibold">Two-Factor Authentication</h3>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit verification code sent to your trusted device.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 6-digit input boxes */}
        <div className="flex justify-center gap-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <input
              key={index}
              ref={(el) => {
                inputRefs.current[index] = el
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={code[index] || ''}
              onChange={(e) => handleDigitChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              disabled={isSubmitting}
              className="w-12 h-14 text-center text-2xl font-mono bg-background border-2 border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
              aria-label={`Digit ${index + 1}`}
            />
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-destructive mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </div>
        )}

        {isSubmitting && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Verifying...
          </div>
        )}

        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel build
          </button>
        </div>
      </form>

      <div className="text-center">
        <p className="text-xs text-muted-foreground">
          Didn't receive a code? Check your trusted Apple devices or phone number.
        </p>
      </div>
    </div>
  )
}
