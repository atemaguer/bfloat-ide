import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  User,
  LogOut,
  Trash2,
  Plug,
} from 'lucide-react'
import { IntegrationsGrid } from '@/app/components/integrations/IntegrationsGrid'
import toast from 'react-hot-toast'
import './settings-modal.css'

type SettingsTab = 'account' | 'integrations'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('account')
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleStatusMessage, setGoogleStatusMessage] = useState<{ type: 'error' | 'success'; message: string } | null>(null)
  const [convexConnected, setConvexConnected] = useState(false)

  // Account settings are not fetched from backend in local-first mode

  // Reset to account tab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab('account')
    }
  }, [open])

  // Google OAuth status check is not available in local-first mode

  // Convex OAuth status check is not available in local-first mode

  // Listen for OAuth callbacks from deep links
  useEffect(() => {
    if (!open) return

    // Listen for OAuth callbacks via custom events (works in both Electron and Tauri)
    const handleOAuthSuccess = ((e: CustomEvent) => {
      const data = e.detail as { message: string }
      setGoogleConnected(true)
      setConvexConnected(true)
      setGoogleStatusMessage({ type: 'success', message: data?.message || 'Connected successfully' })
      setTimeout(() => setGoogleStatusMessage(null), 5000)
    }) as EventListener

    const handleOAuthError = ((e: CustomEvent) => {
      const data = e.detail as { message: string }
      setGoogleStatusMessage({ type: 'error', message: data?.message || 'Connection failed' })
      setTimeout(() => setGoogleStatusMessage(null), 5000)
    }) as EventListener

    window.addEventListener('oauth-success', handleOAuthSuccess)
    window.addEventListener('oauth-error', handleOAuthError)

    return () => {
      window.removeEventListener('oauth-success', handleOAuthSuccess)
      window.removeEventListener('oauth-error', handleOAuthError)
    }
  }, [open])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onOpenChange(false)
    }
  }

  const handleSignOut = () => {
    onOpenChange(false)
  }

  const handleGoogleConnect = () => {
    toast('Configure Firebase credentials in Project Settings > Integrations', {
      icon: 'ℹ️',
      duration: 5000,
    })
  }

  const handleGoogleDisconnect = async () => {
    setGoogleConnected(false)
    setGoogleStatusMessage({ type: 'success', message: 'Google account disconnected successfully' })
    setTimeout(() => setGoogleStatusMessage(null), 5000)
  }

  const handleConvexConnect = () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined
    window.open(`${backendUrl}/desktop/convex/connect`, '_blank')
  }

  const handleConvexDisconnect = async () => {
    setConvexConnected(false)
    setGoogleStatusMessage({ type: 'success', message: 'Convex account disconnected successfully' })
    setTimeout(() => setGoogleStatusMessage(null), 5000)
  }

  const tabs = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'integrations', label: 'Integrations', icon: Plug },
  ] as const

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="settings-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            className="settings-modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Close button */}
            <button
              className="settings-modal-close"
              onClick={() => onOpenChange(false)}
            >
              <X size={16} />
            </button>

            <div className="settings-modal-layout">
              {/* Sidebar Navigation */}
              <nav className="settings-sidebar">
                <div className="settings-sidebar-title">Settings</div>
                <div className="settings-nav">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <tab.icon size={14} />
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              </nav>

              {/* Content Area */}
              <div className="settings-content">
                {activeTab === 'account' && (
                  <div>
                    <div className="settings-page-header">
                      <h2 className="settings-page-title">Account</h2>
                    </div>

                    {/* Name */}
                    <div className="settings-field">
                      <label className="settings-field-label">Name</label>
                      <input
                        type="text"
                        className="settings-field-input"
                        value=""
                        readOnly
                      />
                    </div>

                    {/* Email */}
                    <div className="settings-field">
                      <label className="settings-field-label">Email</label>
                      <input
                        type="email"
                        className="settings-field-input"
                        value=""
                        readOnly
                      />
                    </div>

                    {/* Password */}
                    <div className="settings-field">
                      <label className="settings-field-label">Password</label>
                      <p className="settings-field-hint">
                        You are signed in with Google. To change your password, please use your
                        Google Account settings.
                      </p>
                    </div>

                    {/* User ID */}
                    <div className="settings-field">
                      <label className="settings-field-label">User ID</label>
                      <span className="settings-field-value">Local</span>
                    </div>

                    {/* Account creation date */}
                    <div className="settings-field">
                      <label className="settings-field-label">Account created</label>
                      <span className="settings-field-value">{formatDate(undefined)}</span>
                    </div>

                    {/* Actions */}
                    <div className="settings-section">
                      <div className="settings-section-title">Account Actions</div>

                      <div className="settings-action-row">
                        <div className="settings-action-info">
                          <div className="settings-action-title">Sign out</div>
                          <div className="settings-action-description">Log out of all devices</div>
                        </div>
                        <button className="settings-btn" onClick={handleSignOut}>
                          <LogOut size={12} />
                          Sign out
                        </button>
                      </div>

                      <div className="settings-action-row">
                        <div className="settings-action-info">
                          <div className="settings-action-title">Delete account</div>
                          <div className="settings-action-description">This action cannot be undone</div>
                        </div>
                        <button className="settings-btn settings-btn-danger">
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Save button */}
                    <div className="settings-save-container">
                      <button className="settings-btn settings-btn-primary">
                        Save Changes
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'integrations' && (
                  <div>
                    <div className="settings-page-header">
                      <h2 className="settings-page-title">Integrations</h2>
                      <p className="settings-page-description">
                        Connect your external services to enhance your workspaces.
                      </p>
                    </div>

                    <IntegrationsGrid
                      googleConnected={googleConnected}
                      convexConnected={convexConnected}
                      onGoogleConnect={handleGoogleConnect}
                      onGoogleDisconnect={handleGoogleDisconnect}
                      onConvexConnect={handleConvexConnect}
                      onConvexDisconnect={handleConvexDisconnect}
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
