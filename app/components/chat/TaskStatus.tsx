import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react'

interface TaskStatusProps {
  isComplete: boolean
  isStreaming: boolean
}

export const TaskStatus = memo(function TaskStatus({ isComplete, isStreaming }: TaskStatusProps) {
  // Only show when task is complete and not streaming
  if (!isComplete || isStreaming) {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="task-status-container"
      >
        {/* Task completed badge */}
        <div className="task-status-badge">
          <CheckCircle2 size={14} className="task-status-icon" />
          <span>Task completed</span>
        </div>

        {/* Feedback section */}
        <div className="task-status-feedback">
          <span className="task-status-feedback-label">How was this result?</span>
          <div className="task-status-feedback-buttons">
            <button
              className="task-status-feedback-btn"
              title="Good result"
              onClick={() => {
                // TODO: Implement feedback submission
                console.log('Positive feedback')
              }}
            >
              <ThumbsUp size={14} />
            </button>
            <button
              className="task-status-feedback-btn"
              title="Could be better"
              onClick={() => {
                // TODO: Implement feedback submission
                console.log('Negative feedback')
              }}
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
})
