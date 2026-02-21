/**
 * TerminalFallbackStep - Interactive terminal for unknown prompts
 *
 * Displays either:
 * 1. A user-friendly UI when the prompt is recognized (humanized)
 * 2. Terminal output with manual input for unrecognized prompts
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '@/app/hooks/useStore'
import {
  Send,
  AlertTriangle,
  Terminal,
  Package,
} from 'lucide-react'
import { LogTerminal } from './LogTerminal'
import { deployStore } from '@/app/stores/deploy'
import type { HumanizedPrompt } from '@/lib/conveyor/schemas/deploy-schema'
import { deploy } from '@/app/api/sidecar'

interface TerminalFallbackStepProps {
  onCancel: () => void
  suggestion?: string
  promptContext?: string
  humanized?: HumanizedPrompt
}

export function TerminalFallbackStep({
  onCancel,
  suggestion,
  promptContext,
  humanized,
}: TerminalFallbackStepProps) {
  const buildLogs = useStore(deployStore.buildLogs)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount (only if no humanized prompt)
  useEffect(() => {
    if (!humanized) {
      inputRef.current?.focus()
    }
  }, [humanized])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isSending) return

    setIsSending(true)
    try {
      await deploy.submitTerminalInput(input + '\n')
      setInput('')
      // Reset auth state after successful submission - go back to progress view
      deployStore.resetInteractiveAuth()
    } catch {
      // Ignore errors
    } finally {
      setIsSending(false)
    }
  }, [input, isSending])

  const handleOptionClick = useCallback(async (value: string) => {
    if (isSending) return

    setIsSending(true)
    try {
      await deploy.submitTerminalInput(value)
      // Reset auth state after successful submission - go back to progress view
      deployStore.resetInteractiveAuth()
    } catch {
      // Ignore errors
    } finally {
      setIsSending(false)
    }
  }, [isSending])

  const handleKeySubmit = useCallback(async (key: string) => {
    if (isSending) return

    setIsSending(true)
    try {
      await deploy.submitTerminalInput(key)
      // Reset auth state after successful submission - go back to progress view
      deployStore.resetInteractiveAuth()
    } catch {
      // Ignore errors
    } finally {
      setIsSending(false)
    }
  }, [isSending])

  // If humanized prompt available, show friendly UI
  if (humanized) {
    return (
      <div className="space-y-6">
        {/* Friendly Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
            <Package size={24} className="text-primary" />
          </div>
          <h3 className="text-lg font-semibold">{humanized.title}</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {humanized.description}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 justify-center">
          {humanized.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleOptionClick(opt.value)}
              disabled={isSending}
              className={`
                px-6 py-3 rounded-lg text-sm font-medium transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
                ${opt.recommended
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted hover:bg-muted/80 text-foreground'
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Cancel button */}
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-destructive"
          >
            Cancel build
          </button>
        </div>
      </div>
    )
  }

  // Fallback to terminal view for unrecognized prompts
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-amber-400">Manual Input Required</h3>
          <p className="text-xs text-muted-foreground mt-1">
            The build process encountered a prompt that requires manual input.
            {suggestion && ` ${suggestion}`}
          </p>
        </div>
      </div>

      {/* Context preview if available */}
      {promptContext && (
        <div className="p-2 rounded bg-muted/50 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre">
          {promptContext}
        </div>
      )}

      {/* Terminal display */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
          <Terminal size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Build Output</span>
        </div>
        <LogTerminal logs={buildLogs} height={250} />
      </div>

      {/* Quick action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleKeySubmit('y\n')}
          disabled={isSending}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
        >
          Yes (y)
        </button>
        <button
          type="button"
          onClick={() => handleKeySubmit('n\n')}
          disabled={isSending}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
        >
          No (n)
        </button>
        <button
          type="button"
          onClick={() => handleKeySubmit('\n')}
          disabled={isSending}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
        >
          Enter
        </button>
        <button
          type="button"
          onClick={() => handleKeySubmit('1\n')}
          disabled={isSending}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
        >
          1
        </button>
        <button
          type="button"
          onClick={() => handleKeySubmit('2\n')}
          disabled={isSending}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md"
        >
          2
        </button>
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type response and press Enter..."
          disabled={isSending}
          className="flex-1 px-3 py-2 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Send size={14} />
        </button>
      </form>

      {/* Cancel button */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-destructive"
        >
          Cancel build
        </button>
      </div>
    </div>
  )
}
