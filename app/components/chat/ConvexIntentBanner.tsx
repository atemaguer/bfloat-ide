import ConvexLogo from '@/app/components/ui/icons/convex-logo'

export type ConvexIntentMode = 'convex_only' | 'convex_plus_auth' | 'auth_only'

interface ConvexIntentBannerProps {
  onSelect: (mode: ConvexIntentMode) => void
}

export function ConvexIntentBanner({ onSelect }: ConvexIntentBannerProps) {
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
        <span style={{ fontSize: '13px', color: 'var(--bfloat-text-secondary, #a0a0b8)' }}>
          Convex is connected. Choose what to set up next.
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button
          onClick={() => onSelect('convex_only')}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--bfloat-border, rgba(255,255,255,0.12))',
            backgroundColor: 'transparent',
            color: 'var(--bfloat-text-primary, #e0e0f0)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Convex only
        </button>
        <button
          onClick={() => onSelect('convex_plus_auth')}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'var(--bfloat-accent, #6c5ce7)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Convex + Auth
        </button>
        <button
          onClick={() => onSelect('auth_only')}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--bfloat-border, rgba(255,255,255,0.12))',
            backgroundColor: 'transparent',
            color: 'var(--bfloat-text-primary, #e0e0f0)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Auth only
        </button>
      </div>
    </div>
  )
}
