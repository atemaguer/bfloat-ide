/**
 * ToolAccordion Component - Collapsible group of consecutive tool calls
 *
 * Groups multiple tool calls into a single collapsible accordion with:
 * - Summary header showing count and types (e.g., "Reading 5 files")
 * - Expandable content showing individual tool pills
 * - Smooth expand/collapse animation
 */

import { memo, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, FileCode, Terminal, Search, Loader2 } from 'lucide-react'
import { ToolPillCompact } from './ToolPill'
import type { ToolAction, ToolActionType } from './types'

interface ToolAccordionProps {
  actions: ToolAction[]
  isStreaming?: boolean
  defaultExpanded?: boolean
}

// Generate summary text for grouped actions
function generateSummary(actions: ToolAction[]): { icon: React.ReactNode; text: string } {
  const counts: Record<string, number> = {}

  for (const action of actions) {
    switch (action.type) {
      case 'reading_file':
        counts['reading'] = (counts['reading'] || 0) + 1
        break
      case 'creating_file':
        counts['creating'] = (counts['creating'] || 0) + 1
        break
      case 'editing_file':
        counts['editing'] = (counts['editing'] || 0) + 1
        break
      case 'deleting_file':
        counts['deleting'] = (counts['deleting'] || 0) + 1
        break
      case 'executing_command':
        counts['commands'] = (counts['commands'] || 0) + 1
        break
      case 'searching':
      case 'web_searching':
        counts['searches'] = (counts['searches'] || 0) + 1
        break
      default:
        counts['actions'] = (counts['actions'] || 0) + 1
    }
  }

  // Determine primary icon based on majority action type
  let icon = <Terminal size={14} />
  const fileOps = (counts['reading'] || 0) + (counts['creating'] || 0) +
                  (counts['editing'] || 0) + (counts['deleting'] || 0)
  const searchOps = counts['searches'] || 0
  const cmdOps = counts['commands'] || 0

  if (fileOps >= searchOps && fileOps >= cmdOps) {
    icon = <FileCode size={14} />
  } else if (searchOps > fileOps && searchOps >= cmdOps) {
    icon = <Search size={14} />
  }

  // Generate text
  const parts: string[] = []
  if (counts['reading']) parts.push(`Read ${counts['reading']} file${counts['reading'] > 1 ? 's' : ''}`)
  if (counts['creating']) parts.push(`Created ${counts['creating']} file${counts['creating'] > 1 ? 's' : ''}`)
  if (counts['editing']) parts.push(`Edited ${counts['editing']} file${counts['editing'] > 1 ? 's' : ''}`)
  if (counts['deleting']) parts.push(`Deleted ${counts['deleting']} file${counts['deleting'] > 1 ? 's' : ''}`)
  if (counts['commands']) parts.push(`Ran ${counts['commands']} command${counts['commands'] > 1 ? 's' : ''}`)
  if (counts['searches']) parts.push(`${counts['searches']} search${counts['searches'] > 1 ? 'es' : ''}`)
  if (counts['actions']) parts.push(`${counts['actions']} action${counts['actions'] > 1 ? 's' : ''}`)

  return {
    icon,
    text: parts.join(', ') || `${actions.length} action${actions.length > 1 ? 's' : ''}`,
  }
}

export const ToolAccordion = memo(function ToolAccordion({
  actions,
  isStreaming,
  defaultExpanded = false,
}: ToolAccordionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const { icon, text } = useMemo(() => generateSummary(actions), [actions])

  // Check if any action is still running
  const hasRunningAction = actions.some(a => a.status === 'running')
  const isLoading = isStreaming && hasRunningAction

  if (actions.length === 0) return null

  // Single action - just show the pill directly
  if (actions.length === 1) {
    return (
      <div className="tool-accordion-single">
        <ToolPillCompact
          action={actions[0]}
          isLast={true}
          isStreaming={isStreaming}
        />
      </div>
    )
  }

  return (
    <div className="tool-accordion">
      {/* Header */}
      <button
        className={`tool-accordion-header ${isExpanded ? 'expanded' : ''} ${isLoading ? 'loading' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <motion.span
          className="tool-accordion-chevron"
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight size={14} />
        </motion.span>

        <span className="tool-accordion-icon">
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : icon}
        </span>

        <span className="tool-accordion-summary">
          {text}
        </span>

        <span className="tool-accordion-count">
          {actions.length}
        </span>
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            className="tool-accordion-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <div className="tool-accordion-items">
              {actions.map((action, index) => (
                <ToolPillCompact
                  key={action.id}
                  action={action}
                  isLast={index === actions.length - 1}
                  isStreaming={isStreaming}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

ToolAccordion.displayName = 'ToolAccordion'
