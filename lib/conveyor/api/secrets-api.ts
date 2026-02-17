import { ConveyorApi } from '@/lib/preload/shared'

export interface Secret {
  key: string
  value: string
}

export interface SecretsReadResult {
  secrets: Secret[]
  error?: string
}

export interface SecretOperationResult {
  success: boolean
  error?: string
}

export class SecretsApi extends ConveyorApi {
  readSecrets = (projectId: string): Promise<SecretsReadResult> =>
    this.invoke('secrets:read', { projectId })

  setSecret = (projectId: string, key: string, value: string): Promise<SecretOperationResult> =>
    this.invoke('secrets:set', { projectId, key, value })

  deleteSecret = (projectId: string, key: string): Promise<SecretOperationResult> =>
    this.invoke('secrets:delete', { projectId, key })
}
