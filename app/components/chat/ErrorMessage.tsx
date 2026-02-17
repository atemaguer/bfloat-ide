import { memo } from 'react'
import { AlertCircle, Wrench, X } from 'lucide-react'

interface ErrorMessageProps {
  errorMessage: string
  onDismiss: () => void
  onFix: () => void
}

export const ErrorMessage = memo(function ErrorMessage({ errorMessage, onDismiss, onFix }: ErrorMessageProps) {
  // Truncate long error messages for display, but keep full error for fixing
  const displayMessage = errorMessage.length > 500 ? errorMessage.slice(0, 500) + '...' : errorMessage

  return (
    <div className="error-message-container">
      <div className="error-message-header">
        <AlertCircle size={16} className="error-message-icon" />
        <span className="error-message-title">Error in code execution</span>
      </div>
      <div className="error-message-content">
        <pre className="error-message-text">{displayMessage}</pre>
      </div>
      <div className="error-message-actions">
        <button className="error-message-btn dismiss" onClick={onDismiss}>
          <X size={14} />
          <span>Dismiss</span>
        </button>
        <button className="error-message-btn fix" onClick={onFix}>
          <Wrench size={14} />
          <span>Fix Error</span>
        </button>
      </div>
    </div>
  )
})
