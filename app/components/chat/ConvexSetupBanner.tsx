import ConvexLogo from '@/app/components/ui/icons/convex-logo'
import type { ConvexIntegrationStage } from '@/app/lib/integrations/convex'

interface ConvexSetupBannerProps {
  stage: ConvexIntegrationStage
  missingKey?: 'url' | 'deploy_key' | null
  onConnect: () => void
  onUse: () => void
  onSkip?: () => void
}

export function ConvexSetupBanner({ stage, missingKey, onConnect, onUse, onSkip }: ConvexSetupBannerProps) {
  const isDisconnected = stage === 'disconnected'
  const isSettingUp = stage === 'setting_up'
  const isReady = stage === 'ready'

  const message = isDisconnected
    ? missingKey === 'deploy_key'
      ? 'Convex URL is set. Add CONVEX_DEPLOY_KEY to finish connecting Convex.'
      : 'To add Convex backend support, add your Convex URL and deploy key first.'
    : isSettingUp
      ? 'Convex is connected. Setup is currently in progress...'
      : isReady
        ? 'Convex backend is ready to use.'
        : 'Convex is connected. Finish setup to generate schema and functions.'

  const buttonLabel = isDisconnected
    ? 'Connect Convex'
    : isSettingUp
      ? 'Setting up Convex...'
      : isReady
        ? 'Use Convex'
        : 'Finish Convex Setup'

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
        <ConvexLogo width="20" height="20" />
        <span style={{ fontSize: '13px', color: 'var(--bfloat-text-secondary, #a0a0b8)' }}>{message}</span>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {isDisconnected ? (
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
            {buttonLabel}
          </button>
        ) : (
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
              cursor: isSettingUp ? 'wait' : 'pointer',
              opacity: isSettingUp ? 0.7 : 1,
              alignSelf: 'flex-start',
            }}
          >
            {buttonLabel}
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
