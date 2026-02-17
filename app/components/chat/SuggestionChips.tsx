'use client'

import { memo, useCallback, type ComponentProps } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/app/components/ui/button'
import { cn } from '@/lib/utils'
import type { SuggestedFollowup } from './types'

// --- AI Elements Suggestion primitives (adapted from ai-sdk.dev/elements) ---

type SuggestionsProps = ComponentProps<'div'>

const Suggestions = ({ className, children, ...props }: SuggestionsProps) => (
  <div className={cn('w-full overflow-x-auto', props.style ? '' : 'whitespace-nowrap')} {...props}>
    <div className={cn('flex w-max flex-nowrap items-center gap-2', className)}>{children}</div>
  </div>
)

type SuggestionProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string
  onClick?: (suggestion: string) => void
}

const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = 'outline',
  size = 'sm',
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = useCallback(() => {
    onClick?.(suggestion)
  }, [onClick, suggestion])

  return (
    <Button
      className={cn('cursor-pointer rounded-full px-4', className)}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  )
}

// --- SuggestionChips wrapper (integrates with Chat's data flow) ---

interface SuggestionChipsProps {
  suggestions: SuggestedFollowup[]
  onSelect: (suggestion: SuggestedFollowup) => void
}

export const SuggestionChips = memo(function SuggestionChips({
  suggestions,
  onSelect,
}: SuggestionChipsProps) {
  return (
    <AnimatePresence>
      {suggestions.length > 0 && (
        <motion.div
          className="px-4 pb-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
        >
          <Suggestions>
            {suggestions.map((s) => (
              <Suggestion key={s.id} suggestion={s.text} onClick={() => onSelect(s)} />
            ))}
          </Suggestions>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
