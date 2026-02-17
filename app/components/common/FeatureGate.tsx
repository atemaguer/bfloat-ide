import type { ReactNode } from 'react'
import { useFeatureAvailable } from '../../hooks/useFeatureAvailable'
import { useIsWebApp, useIsMobileApp } from '../../hooks/useAppType'

interface FeatureGateProps {
  /** The feature ID to check */
  featureId: string
  /** Content to render when feature is available */
  children: ReactNode
  /** Optional fallback content when feature is not available */
  fallback?: ReactNode
}

/**
 * Conditionally renders children based on feature availability.
 * Combines app type checking with optional feature flags.
 *
 * @example
 * <FeatureGate featureId="settings-ios-bundle">
 *   <IOSBundleFields />
 * </FeatureGate>
 */
export function FeatureGate({ featureId, children, fallback = null }: FeatureGateProps) {
  const isAvailable = useFeatureAvailable(featureId)

  if (!isAvailable) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

interface AppTypeGateProps {
  /** Content to render when app type matches */
  children: ReactNode
  /** Optional fallback content when app type doesn't match */
  fallback?: ReactNode
}

/**
 * Renders children only for web apps.
 *
 * @example
 * <WebOnly>
 *   <WebDeploySection />
 * </WebOnly>
 */
export function WebOnly({ children, fallback = null }: AppTypeGateProps) {
  const isWeb = useIsWebApp()

  if (!isWeb) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

/**
 * Renders children only for mobile apps.
 *
 * @example
 * <MobileOnly>
 *   <MobileSettingsCard />
 * </MobileOnly>
 */
export function MobileOnly({ children, fallback = null }: AppTypeGateProps) {
  const isMobile = useIsMobileApp()

  if (!isMobile) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
