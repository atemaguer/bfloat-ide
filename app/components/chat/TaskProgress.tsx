/**
 * TaskProgress Component
 *
 * Displays the current todo list from TodoWrite tool calls.
 * Shows a progress overview card with status icons for each task.
 * Positioned above the chat input for easy visibility.
 */

import { memo } from 'react'
import { Check, Circle, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// Todo item from TodoWrite
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

interface TaskProgressProps {
  todos: TodoItem[]
  isStreaming?: boolean
}

// Status icon component
function StatusIcon({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return (
        <div className="task-progress-status-icon completed">
          <Check size={16} strokeWidth={2.5} />
        </div>
      )
    case 'in_progress':
      return (
        <div className="task-progress-status-icon in-progress">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )
    case 'pending':
    default:
      return (
        <div className="task-progress-status-icon pending">
          <Circle size={16} />
        </div>
      )
  }
}

export const TaskProgress = memo(function TaskProgress({
  todos,
  isStreaming,
}: TaskProgressProps) {
  if (!todos || todos.length === 0) return null

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const totalCount = todos.length

  return (
    <AnimatePresence>
      <motion.div
        className="task-progress-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
      >
        <div className="task-progress-header">
          <span className="task-progress-title">Task progress</span>
          <span className="task-progress-count">
            {completedCount} / {totalCount}
          </span>
        </div>

        <div className="task-progress-list">
          {todos.map((todo, index) => (
            <motion.div
              key={`${todo.content}-${index}`}
              className={`task-progress-item ${todo.status}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, delay: index * 0.03 }}
            >
              <StatusIcon status={todo.status} />
              <span className="task-progress-item-text">
                {todo.content}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
})

TaskProgress.displayName = 'TaskProgress'
