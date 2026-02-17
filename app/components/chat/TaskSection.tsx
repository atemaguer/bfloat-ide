/**
 * TaskSection Component - Collapsible task group with timeline
 *
 * Displays a group of related tool actions as a collapsible section,
 * similar to Manus UI. Features:
 * - Status icon (checkmark, spinner, circle)
 * - Collapsible content with smooth animation
 * - Summary preview when collapsed
 * - Timeline connector on left
 * - Auto-collapse completed tasks
 */

import { memo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2, Circle, ChevronDown } from 'lucide-react'
import type { TaskStatus, ToolAction } from './types'
import { ToolPillCompact } from './ToolPill'

interface TaskSectionProps {
  id: string
  title: string
  status: TaskStatus
  actions: ToolAction[]
  summary?: string
  textContent?: string
  defaultExpanded?: boolean
  isLast?: boolean
  isStreaming?: boolean
}

// Status icon component
function StatusIcon({ status }: { status: TaskStatus }) {
  const baseClass = 'task-section-status-icon'

  switch (status) {
    case 'completed':
      return (
        <span className={`${baseClass} completed`}>
          <Check size={10} strokeWidth={3} />
        </span>
      )
    case 'in_progress':
      return (
        <span className={`${baseClass} in_progress`}>
          <Loader2 size={10} className="animate-spin" />
        </span>
      )
    case 'pending':
    default:
      return (
        <span className={`${baseClass} pending`}>
          <Circle size={8} />
        </span>
      )
  }
}

export const TaskSection = memo(function TaskSection({
  id,
  title,
  status,
  actions,
  summary,
  textContent,
  defaultExpanded = true,
  isLast = false,
  isStreaming = false,
}: TaskSectionProps) {
  // Auto-collapse completed tasks, but keep expanded if in progress
  const [isExpanded, setIsExpanded] = useState(() => {
    if (status === 'completed' && !defaultExpanded) return false
    return true
  })

  // Auto-collapse when task completes (only if there are multiple actions)
  useEffect(() => {
    if (status === 'completed' && actions.length > 1 && !isStreaming) {
      // Small delay before collapsing for visual feedback
      const timer = setTimeout(() => setIsExpanded(false), 500)
      return () => clearTimeout(timer)
    }
  }, [status, actions.length, isStreaming])

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div className={`task-section ${status}`} data-task-id={id}>
      {/* Header - clickable to expand/collapse */}
      <div className="task-section-header" onClick={handleToggle}>
        <div className="task-section-header-left">
          <StatusIcon status={status} />
          <span className="task-section-title">{title}</span>
          {!isExpanded && summary && (
            <span className="task-section-summary">{summary}</span>
          )}
        </div>
        <motion.span
          className="task-section-expand"
          animate={{ rotate: isExpanded ? 0 : -90 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown size={14} />
        </motion.span>
      </div>

      {/* Body with timeline */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            className="task-section-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            {/* Timeline connector */}
            <div className="task-section-timeline">
              {!isLast && <div className="task-section-timeline-line" />}
            </div>

            {/* Content */}
            <div className="task-section-content">
              {/* Optional text before tools */}
              {textContent && (
                <p className="task-text">{textContent}</p>
              )}

              {/* Tool pills */}
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

TaskSection.displayName = 'TaskSection'

// Multiple task sections with timeline
interface TaskSectionListProps {
  sections: Array<{
    id: string
    title: string
    status: TaskStatus
    actions: ToolAction[]
    summary?: string
    textContent?: string
  }>
  isStreaming?: boolean
}

export const TaskSectionList = memo(function TaskSectionList({
  sections,
  isStreaming = false,
}: TaskSectionListProps) {
  if (sections.length === 0) return null

  return (
    <div className="task-section-list">
      {sections.map((section, index) => (
        <TaskSection
          key={section.id}
          {...section}
          isLast={index === sections.length - 1}
          isStreaming={isStreaming}
          defaultExpanded={section.status !== 'completed' || index === sections.length - 1}
        />
      ))}
    </div>
  )
})

TaskSectionList.displayName = 'TaskSectionList'

// Simple task list item for todo-style display (backwards compatibility)
interface TaskItemProps {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  timestamp?: string
}

export const TaskItem = memo(function TaskItem({ text, status, timestamp }: TaskItemProps) {
  return (
    <div className={`task-item group ${status}`}>
      <span className={`task-item-status-icon ${status}`}>
        {status === 'completed' && <Check size={10} strokeWidth={3} />}
        {status === 'in_progress' && <Loader2 size={10} className="animate-spin" />}
        {status === 'pending' && <Circle size={8} />}
      </span>
      <span className="task-item-text">{text}</span>
      {timestamp && (
        <span className="task-item-timestamp">{timestamp}</span>
      )}
    </div>
  )
})

// Text content within a task section (backwards compatibility)
interface TaskTextProps {
  children: React.ReactNode
}

export const TaskText = memo(function TaskText({ children }: TaskTextProps) {
  return <p className="task-text">{children}</p>
})
