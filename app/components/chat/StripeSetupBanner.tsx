import StripeLogo from '@/app/components/ui/icons/stripe-logo'
import { Loader2 } from 'lucide-react'

interface StripeSetupBannerProps {
  isConnected: boolean
  isSettingUp?: boolean
  onConnect: () => void
  onUse: () => void
  onSkip?: () => void
}

export function StripeSetupBanner({
  isConnected,
  isSettingUp = false,
  onConnect,
  onUse,
  onSkip,
}: StripeSetupBannerProps) {
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
        <StripeLogo width="20" height="20" />
        <span style={{ fontSize: '13px', color: 'var(--bfloat-text-secondary, #a0a0b8)' }}>
          To add Stripe payments, let's get it connected first.
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
              opacity: isSettingUp ? 0.7 : 1,
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {isSettingUp ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Setting up Stripe...
              </>
            ) : (
              'Set up Stripe'
            )}
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
            Connect Stripe
          </button>
        )}
        {onSkip && (
          <button
            onClick={onSkip}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--bfloat-border, rgba(255,255,255,0.12))',
              backgroundColor: 'transparent',
              color: 'var(--bfloat-text-secondary, #a0a0b8)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
        )}
      </div>
    </div>
  )
}
