import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { NormalizedAppType, FeatureCategory, FeatureDefinition } from '../types/app-features'
import { isFeatureSupportedForAppType, getFeaturesByCategory } from '../lib/feature-registry'

// Raw app types from the database/project
type RawAppType = 'web' | 'mobile' | 'expo' | 'nextjs' | 'vite' | 'node'

interface AppTypeContextValue {
  appType: NormalizedAppType
  rawAppType: RawAppType
  isWebApp: boolean
  isMobileApp: boolean
  isFeatureAvailable: (featureId: string) => boolean
  getAvailableFeatures: (category: FeatureCategory) => FeatureDefinition[]
}

const AppTypeContext = createContext<AppTypeContextValue | null>(null)

/**
 * Normalize raw app type from database to simplified web/mobile
 */
function normalizeAppType(rawAppType: RawAppType): NormalizedAppType {
  switch (rawAppType) {
    case 'nextjs':
    case 'vite':
    case 'node':
    case 'web':
      return 'web'
    case 'expo':
    case 'mobile':
    default:
      return 'mobile'
  }
}

interface AppTypeProviderProps {
  rawAppType: RawAppType
  children: ReactNode
}

export function AppTypeProvider({ rawAppType, children }: AppTypeProviderProps) {
  const value = useMemo<AppTypeContextValue>(() => {
    const appType = normalizeAppType(rawAppType)

    return {
      appType,
      rawAppType,
      isWebApp: appType === 'web',
      isMobileApp: appType === 'mobile',
      isFeatureAvailable: (featureId: string) => isFeatureSupportedForAppType(featureId, appType),
      getAvailableFeatures: (category: FeatureCategory) => {
        return getFeaturesByCategory(category).filter(
          f => f.supportedAppTypes === 'all' || f.supportedAppTypes.includes(appType)
        )
      },
    }
  }, [rawAppType])

  return (
    <AppTypeContext.Provider value={value}>
      {children}
    </AppTypeContext.Provider>
  )
}

export function useAppTypeContext(): AppTypeContextValue {
  const context = useContext(AppTypeContext)
  if (!context) {
    throw new Error('useAppTypeContext must be used within an AppTypeProvider')
  }
  return context
}

// Export the context for testing purposes
export { AppTypeContext }
