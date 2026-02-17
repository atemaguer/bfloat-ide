import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react'

interface ClaudeAuthBannerProps {
  onReconnect: () => void
  isAuthenticated?: boolean
}

/**
 * Banner shown when Claude authentication fails.
 * Prompts the user to re-authenticate their Claude account.
 * Shows a success state when already authenticated.
 */
export function ClaudeAuthBanner({ onReconnect, isAuthenticated }: ClaudeAuthBannerProps) {
  if (isAuthenticated) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderRadius: '8px',
          margin: '8px 16px',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }}
      >
        <CheckCircle size={20} style={{ color: '#22c55e', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--bfloat-text-primary, #fff)' }}>
            Claude connected
          </div>
          <div style={{ fontSize: '12px', color: 'var(--bfloat-text-secondary, #a0a0b8)', marginTop: '2px' }}>
            You can now continue building your app.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderRadius: '8px',
        margin: '8px 16px',
        border: '1px solid rgba(239, 68, 68, 0.2)',
      }}
    >
      <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--bfloat-text-primary, #fff)' }}>
          Claude authentication expired
        </div>
        <div style={{ fontSize: '12px', color: 'var(--bfloat-text-secondary, #a0a0b8)', marginTop: '2px' }}>
          Please reconnect your Claude account to continue.
        </div>
      </div>
      <button
        onClick={onReconnect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          backgroundColor: '#8b5cf6',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <RefreshCw size={14} />
        Reconnect
      </button>
    </div>
  )
}

/**
 * Check if an error message indicates a Claude authentication issue
 */
export function isClaudeAuthError(error: string | null): boolean {
  if (!error) return false
  const lowerError = error.toLowerCase()
  return (
    lowerError.includes('invalid api key') ||
    lowerError.includes('please run /login') ||
    lowerError.includes('authentication') ||
    lowerError.includes('unauthorized') ||
    lowerError.includes('not authenticated')
  )
}
