import { useState } from 'react'
import { ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export interface IntegrationCardProps {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  isConnected: boolean
  isLoading?: boolean
  children?: React.ReactNode
  onConnect?: () => void | Promise<void>
  onDisconnect?: () => void | Promise<void>
  expandedContent?: React.ReactNode
  accentColor?: string
}

export function IntegrationCard({
  id,
  name,
  description,
  icon,
  isConnected,
  isLoading = false,
  children,
  onConnect,
  onDisconnect,
  expandedContent,
  accentColor = 'primary',
}: IntegrationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const handleAction = async () => {
    if (actionLoading) return

    setActionLoading(true)
    try {
      if (isConnected && onDisconnect) {
        await onDisconnect()
      } else if (!isConnected && onConnect) {
        await onConnect()
      }
    } finally {
      setActionLoading(false)
    }
  }

  const hasExpandedContent = !!expandedContent || !!children

  return (
    <div className={`settings-integration-card ${isConnected ? 'connected' : ''}`}>
      {/* Main Card Content */}
      <div className="settings-integration-main">
        {/* Icon */}
        <div className="settings-integration-icon">
          {icon}
        </div>

        {/* Info */}
        <div className="settings-integration-info">
          <div className="settings-integration-header">
            <span className="settings-integration-name">{name}</span>
            {isConnected && (
              <span className="settings-integration-badge">
                <Check size={10} />
                Connected
              </span>
            )}
          </div>
          <p className="settings-integration-description">{description}</p>
        </div>

        {/* Actions */}
        <div className="settings-integration-actions">
          {/* Disconnect button when connected */}
          {isConnected && (
            <button
              onClick={handleAction}
              disabled={actionLoading || isLoading}
              className="settings-integration-btn disconnect"
            >
              {actionLoading || isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                'Disconnect'
              )}
            </button>
          )}

          {/* Connect button - either direct action or expand form */}
          {!isConnected && !hasExpandedContent && (
            <button
              onClick={handleAction}
              disabled={actionLoading || isLoading}
              className="settings-integration-btn connect"
            >
              {actionLoading || isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                'Connect'
              )}
            </button>
          )}

          {/* Connect button that expands form */}
          {!isConnected && hasExpandedContent && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="settings-integration-btn connect"
            >
              Connect
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && hasExpandedContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="settings-integration-expanded">
              {expandedContent || children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
