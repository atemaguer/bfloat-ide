import { secrets } from '@/app/api/sidecar'
import { workbenchStore } from '@/app/stores/workbench'

/**
 * Write integration environment variables to .env.local via the conveyor secrets API.
 * Also notifies the workbench store so the dev server picks up the changes.
 */
export async function writeIntegrationEnvVars(
  projectId: string,
  envVars: Record<string, string>
): Promise<void> {
  const written: Record<string, string> = {}

  for (const [key, value] of Object.entries(envVars)) {
    if (value) {
      await secrets.setSecret(projectId, key, value)
      written[key] = value
    }
  }

  if (Object.keys(written).length > 0) {
    workbenchStore.setPendingEnvVars(written)
  }
}
