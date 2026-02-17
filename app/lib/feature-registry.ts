import type { FeatureDefinition, FeatureCategory, NormalizedAppType } from '../types/app-features'

export const FEATURES: FeatureDefinition[] = [
  // Mobile-only features
  {
    id: 'deploy-ios',
    name: 'iOS Deployment',
    category: 'deployment',
    supportedAppTypes: ['mobile'],
  },
  {
    id: 'deploy-android',
    name: 'Android Deployment',
    category: 'deployment',
    supportedAppTypes: ['mobile'],
  },
  {
    id: 'settings-ios-bundle',
    name: 'iOS Bundle Settings',
    category: 'settings',
    supportedAppTypes: ['mobile'],
  },
  {
    id: 'settings-android-package',
    name: 'Android Package Settings',
    category: 'settings',
    supportedAppTypes: ['mobile'],
  },
  {
    id: 'settings-app-icons',
    name: 'App Icons',
    category: 'settings',
    supportedAppTypes: ['mobile'],
  },

  // Web-only features
  {
    id: 'deploy-web',
    name: 'Web Deployment',
    category: 'deployment',
    supportedAppTypes: ['web'],
  },
  {
    id: 'preview-browser',
    name: 'Browser Preview',
    category: 'preview',
    supportedAppTypes: ['web'],
  },

  // Universal features
  {
    id: 'integration-convex',
    name: 'Convex Integration',
    category: 'integrations',
    supportedAppTypes: 'all',
  },
  {
    id: 'integration-firebase',
    name: 'Firebase Integration',
    category: 'integrations',
    supportedAppTypes: 'all',
  },
]

export function getFeatureById(id: string): FeatureDefinition | undefined {
  return FEATURES.find(f => f.id === id)
}

export function getFeaturesByCategory(category: FeatureCategory): FeatureDefinition[] {
  return FEATURES.filter(f => f.category === category)
}

export function isFeatureSupportedForAppType(featureId: string, appType: NormalizedAppType): boolean {
  const feature = getFeatureById(featureId)
  if (!feature) return false
  if (feature.supportedAppTypes === 'all') return true
  return feature.supportedAppTypes.includes(appType)
}
