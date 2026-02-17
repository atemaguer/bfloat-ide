export type NormalizedAppType = 'web' | 'mobile'
export type FeatureCategory = 'deployment' | 'preview' | 'settings' | 'integrations'

export interface FeatureDefinition {
  id: string
  name: string
  category: FeatureCategory
  supportedAppTypes: NormalizedAppType[] | 'all'
  featureFlagKey?: string  // Reserved for future use
}
