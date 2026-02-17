/**
 * ToolPill Component - Compact action indicator with timeline support
 *
 * Displays tool actions as compact pills with icon, action type, and label.
 * Example: [icon] Creating file design.md
 */

import { memo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FilePlus,
  FileEdit,
  FileCode,
  FileX,
  Terminal,
  Square,
  CheckCircle,
  Image,
  Save,
  Search,
  Brain,
  ListTodo,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import type { ToolAction, ToolActionType } from './types'

interface ToolPillProps {
  action: ToolAction
  isLast?: boolean
  isStreaming?: boolean
  timestamp?: string
}

// Icon mapping for tool types
function getIcon(type: ToolActionType, size: number = 14) {
  const props = { size, strokeWidth: 2 }

  switch (type) {
    case 'creating_file':
      return <FilePlus {...props} />
    case 'editing_file':
      return <FileEdit {...props} />
    case 'reading_file':
      return <FileCode {...props} />
    case 'deleting_file':
      return <FileX {...props} />
    case 'executing_command':
    case 'viewing_terminal':
      return <Terminal {...props} />
    case 'terminating_process':
      return <Square {...props} />
    case 'check_status':
      return <CheckCircle {...props} />
    case 'generating_image':
      return <Image {...props} />
    case 'save_checkpoint':
      return <Save {...props} />
    case 'searching':
      return <Search {...props} />
    case 'thinking':
      return <Brain {...props} />
    case 'planning':
      return <ListTodo {...props} />
    default:
      return <Terminal {...props} />
  }
}

// Action label mapping
function getActionLabel(type: ToolActionType): string {
  switch (type) {
    case 'creating_file':
      return 'Creating file'
    case 'editing_file':
      return 'Editing file'
    case 'reading_file':
      return 'Reading file'
    case 'deleting_file':
      return 'Deleting file'
    case 'executing_command':
      return 'Executing command'
    case 'viewing_terminal':
      return 'Viewing terminal'
    case 'terminating_process':
      return 'Terminating process'
    case 'check_status':
      return 'Check project status'
    case 'generating_image':
      return 'Generating image'
    case 'save_checkpoint':
      return 'Save checkpoint'
    case 'searching':
      return 'Searching'
    case 'thinking':
      return 'Thinking'
    case 'planning':
      return 'Planning'
    default:
      return type
  }
}

// Extract filename from path
function getFileName(path: string): string {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// Truncate long strings
function truncate(str: string, maxLen: number = 40): string {
  if (!str || str.length <= maxLen) return str
  return str.substring(0, maxLen) + '...'
}

export const ToolPill = memo(function ToolPill({ action, isLast, isStreaming, timestamp }: ToolPillProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isLoading = isLast && action.status === 'running' && isStreaming
  const hasOutput = action.output && action.output.length > 0
  const isExpandable = hasOutput || action.type === 'thinking'

  const fileName = getFileName(action.label)
  const displayLabel = action.type === 'executing_command' ? truncate(action.label, 50) : fileName

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="tool-pill-row group"
    >
      <div className="tool-pill-container">
        <div
          className={`tool-pill ${isExpandable ? 'expandable' : ''} ${isLoading ? 'loading' : ''}`}
          onClick={() => isExpandable && setIsExpanded(!isExpanded)}
        >
          {/* Icon with background */}
          <span className="tool-pill-icon-wrapper">
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              getIcon(action.type, 16)
            )}
          </span>

          {/* Action label and file */}
          <span className="tool-pill-content" title={action.label}>
            <span className="tool-pill-action">
              {isLoading ? getActionLabel(action.type).replace('ing', 'ing...') : getActionLabel(action.type)}
            </span>
            {displayLabel && (
              <span className="tool-pill-label">{displayLabel}</span>
            )}
          </span>

          {/* Expand indicator */}
          {isExpandable && (
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.15 }}
              className="tool-pill-expand"
            >
              <ChevronDown size={14} />
            </motion.span>
          )}
        </div>
      </div>

      {/* Hover timestamp */}
      {timestamp && (
        <span className="tool-pill-timestamp">{timestamp}</span>
      )}

      {/* Expandable content */}
      <AnimatePresence>
        {isExpanded && isExpandable && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="tool-pill-output"
          >
            <pre>{action.output || 'No output'}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

// Grouped tool pills for consecutive tool actions
interface ToolPillGroupProps {
  actions: ToolAction[]
  isStreaming?: boolean
  showTimeline?: boolean
}

export const ToolPillGroup = memo(function ToolPillGroup({
  actions,
  isStreaming,
  showTimeline = false
}: ToolPillGroupProps) {
  if (actions.length === 0) return null

  return (
    <div className={`tool-pill-group ${showTimeline ? 'with-timeline' : ''}`}>
      {actions.map((action, index) => (
        <ToolPill
          key={action.id}
          action={action}
          isLast={index === actions.length - 1}
          isStreaming={isStreaming}
        />
      ))}
    </div>
  )
})

// Compact tool pill for use inside TaskSection
// Simplified design without expand/collapse - single row format
interface ToolPillCompactProps {
  action: ToolAction
  isLast?: boolean
  isStreaming?: boolean
}

export const ToolPillCompact = memo(function ToolPillCompact({
  action,
  isLast,
  isStreaming,
}: ToolPillCompactProps) {
  const isLoading = isLast && action.status === 'running' && isStreaming
  const fileName = getFileName(action.label)
  const displayLabel = action.type === 'executing_command' ? truncate(action.label, 50) : fileName

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="tool-pill-compact"
    >
      {/* Icon */}
      <span className="tool-pill-compact-icon">
        {isLoading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          getIcon(action.type, 14)
        )}
      </span>

      {/* Action label */}
      <span className="tool-pill-compact-action">
        {getActionLabel(action.type)}
      </span>

      {/* File/command path */}
      {displayLabel && (
        <span className="tool-pill-compact-label" title={action.label}>
          {displayLabel}
        </span>
      )}
    </motion.div>
  )
})

ToolPillCompact.displayName = 'ToolPillCompact'
