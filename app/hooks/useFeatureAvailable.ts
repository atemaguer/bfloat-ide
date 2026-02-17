import { useAppTypeContext } from '../contexts/AppTypeContext'

/**
 * Check if a feature is available based on app type.
 *
 * @param featureId - The feature ID to check
 * @returns true if the feature is available for the current app type
 */
export function useFeatureAvailable(featureId: string): boolean {
  const { isFeatureAvailable } = useAppTypeContext()
  return isFeatureAvailable(featureId)
}
