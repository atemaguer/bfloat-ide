import FirebaseLogo from '@/app/components/ui/icons/firebase-logo'
import { Loader2 } from 'lucide-react'

interface FirebaseSetupBannerProps {
  isConnected: boolean
  isSettingUp?: boolean
  onConnect: () => void
  onUse: () => void
}

export function FirebaseSetupBanner({ isConnected, isSettingUp = false, onConnect, onUse }: FirebaseSetupBannerProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px 16px',
        borderRadius: '10px',
        backgroundColor: 'var(--bfloat-bg-secondary, #1a1a2e)',
        border: '1px solid var(--bfloat-border, rgba(255,255,255,0.08))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <FirebaseLogo width="20" height="20" />
        <span style={{ fontSize: '13px', color: 'var(--bfloat-text-secondary, #a0a0b8)' }}>
          To add Firebase support, save the Firebase client config first, then run the `/add-firebase` setup flow.
        </span>
      </div>
      {isConnected ? (
        <button
          onClick={onUse}
          disabled={isSettingUp}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'var(--bfloat-accent, #6c5ce7)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 500,
            cursor: isSettingUp ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start',
            opacity: isSettingUp ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {isSettingUp && <Loader2 size={14} className="animate-spin" />}
          {isSettingUp ? 'Setting up Firebase...' : 'Set up Firebase'}
        </button>
      ) : (
        <button
          onClick={onConnect}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid var(--bfloat-border, rgba(255,255,255,0.12))',
            backgroundColor: 'transparent',
            color: 'var(--bfloat-text-primary, #e0e0f0)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          Add Firebase Credentials
        </button>
      )}
    </div>
  )
}
