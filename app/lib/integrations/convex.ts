import type { FileMap } from '@/app/types/project'

export type ConvexIntegrationStage = 'disconnected' | 'connected' | 'setting_up' | 'ready'
export type ConvexAppType = 'web' | 'mobile'

export interface SecretEntry {
  key: string
  value: string
}

export interface ConvexSecretStatus {
  urlKey: 'NEXT_PUBLIC_CONVEX_URL' | 'EXPO_PUBLIC_CONVEX_URL'
  url: string | null
  deployKey: string | null
  hasUrl: boolean
  hasDeployKey: boolean
  isConfigured: boolean
  missingKey: 'url' | 'deploy_key' | null
}

export interface ConvexDashboardConfig {
  deploymentUrl: string
  deploymentName: string
  deployKey: string
}

function normalizeSecretValue(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function getConvexUrlKey(appType: ConvexAppType): 'NEXT_PUBLIC_CONVEX_URL' | 'EXPO_PUBLIC_CONVEX_URL' {
  return appType === 'web' ? 'NEXT_PUBLIC_CONVEX_URL' : 'EXPO_PUBLIC_CONVEX_URL'
}

function getConvexValuesFromMap(
  values: Record<string, string | undefined>,
  appType: ConvexAppType
): ConvexSecretStatus {
  const urlKey = getConvexUrlKey(appType)
  const url = normalizeSecretValue(values[urlKey]) || normalizeSecretValue(values.CONVEX_URL)
  const deployKey = normalizeSecretValue(values.CONVEX_DEPLOY_KEY)
  const hasUrl = !!url
  const hasDeployKey = !!deployKey

  return {
    urlKey,
    url,
    deployKey,
    hasUrl,
    hasDeployKey,
    isConfigured: hasUrl && hasDeployKey,
    missingKey: !hasUrl ? 'url' : !hasDeployKey ? 'deploy_key' : null,
  }
}

export function getConvexSecretStatusFromKeys(secretKeys: string[], appType: ConvexAppType): ConvexSecretStatus {
  const keyMap = Object.fromEntries(secretKeys.map((key) => [key, key]))
  return getConvexValuesFromMap(keyMap, appType)
}

export function getConvexSecretStatusFromSecrets(secrets: SecretEntry[], appType: ConvexAppType): ConvexSecretStatus {
  const values = Object.fromEntries(secrets.map((secret) => [secret.key, secret.value]))
  return getConvexValuesFromMap(values, appType)
}

export function deriveConvexDeploymentName(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
    const candidate = hostname.split('.')[0]?.trim()
    return candidate || null
  } catch {
    return null
  }
}

export function getConvexDashboardConfigFromSecrets(
  secrets: SecretEntry[],
  appType: ConvexAppType
): ConvexDashboardConfig | null {
  const status = getConvexSecretStatusFromSecrets(secrets, appType)
  if (!status.isConfigured || !status.url || !status.deployKey) {
    return null
  }

  return {
    deploymentUrl: status.url,
    deployKey: status.deployKey,
    deploymentName: deriveConvexDeploymentName(status.url) || 'convex',
  }
}

export function getConvexEnvVarsForSession(status: ConvexSecretStatus): Record<string, string> {
  if (!status.isConfigured || !status.url || !status.deployKey) {
    return {}
  }

  return {
    [status.urlKey]: status.url,
    CONVEX_URL: status.url,
    CONVEX_DEPLOY_KEY: status.deployKey,
  }
}

export function detectConvexBootstrap(files: FileMap | null | undefined): boolean {
  if (!files) return false

  const paths = Object.keys(files)
  const hasSchema = paths.includes('convex/schema.ts')
  const hasGeneratedApi = paths.some((path) => /^convex\/_generated\/api\.(ts|js)$/.test(path))
  const hasGeneratedServer = paths.some((path) => /^convex\/_generated\/server\.(ts|js)$/.test(path))
  const hasFunctionFile = paths.some((path) => {
    if (!path.startsWith('convex/')) return false
    if (!path.endsWith('.ts')) return false
    if (path.startsWith('convex/_generated/')) return false
    return path !== 'convex/schema.ts'
  })

  return hasSchema && hasGeneratedApi && hasGeneratedServer && hasFunctionFile
}
