import { useAppTypeContext } from '../contexts/AppTypeContext'
import type { NormalizedAppType } from '../types/app-features'

/**
 * Returns the current normalized app type ('web' or 'mobile')
 */
export function useAppType(): NormalizedAppType {
  const { appType } = useAppTypeContext()
  return appType
}

/**
 * Returns true if the current app is a web app
 */
export function useIsWebApp(): boolean {
  const { isWebApp } = useAppTypeContext()
  return isWebApp
}

/**
 * Returns true if the current app is a mobile app
 */
export function useIsMobileApp(): boolean {
  const { isMobileApp } = useAppTypeContext()
  return isMobileApp
}
