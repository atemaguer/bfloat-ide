import type { LaunchConfig } from '@/app/types/launch'
import { DEFAULT_CONFIGS } from '@/app/types/launch'

export { getSystemPrompt, PROJECT_EXPLORATION_PROMPT } from './system-prompt'

const LAUNCH_CONFIG_PATH = '.bfloat-ide/launch.json'

/**
 * Detect app type from package.json dependencies.
 * Returns 'web' for Next.js, Vite, React web apps.
 * Returns 'mobile' for Expo/React Native apps.
 * Returns null if unable to detect.
 */
export function detectAppTypeFromPackageJson(
  files: Record<string, { type: string; content: string } | null | undefined>
): 'web' | 'mobile' | null {
  const packageJsonFile = files['package.json']
  if (!packageJsonFile || packageJsonFile.type !== 'file' || !packageJsonFile.content) {
    return null
  }

  try {
    const packageJson = JSON.parse(packageJsonFile.content)
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }

    // Check for web frameworks first (more specific)
    if (deps['next']) {
      console.log('[Launch] Detected Next.js project from package.json')
      return 'web'
    }
    if (deps['vite'] || deps['@vitejs/plugin-react']) {
      console.log('[Launch] Detected Vite project from package.json')
      return 'web'
    }
    if (deps['@remix-run/react'] || deps['@remix-run/node']) {
      console.log('[Launch] Detected Remix project from package.json')
      return 'web'
    }

    // Check for mobile frameworks
    if (deps['expo'] || deps['react-native']) {
      console.log('[Launch] Detected Expo/React Native project from package.json')
      return 'mobile'
    }

    // Check for generic React (assume web if no mobile indicators)
    if (deps['react'] && deps['react-dom'] && !deps['react-native']) {
      console.log('[Launch] Detected React web project from package.json')
      return 'web'
    }

    return null
  } catch (error) {
    console.error('[Launch] Failed to parse package.json:', error)
    return null
  }
}

/**
 * Get a launch config by detecting the project type from package.json.
 * This is used as a fallback when .bfloat-ide/launch.json doesn't exist.
 */
export function detectLaunchConfig(
  files: Record<string, { type: string; content: string } | null | undefined>
): LaunchConfig | null {
  const detectedType = detectAppTypeFromPackageJson(files)
  if (!detectedType) {
    return null
  }

  console.log('[Launch] Auto-detected app type:', detectedType)
  return {
    type: detectedType,
    ...DEFAULT_CONFIGS[detectedType],
  }
}

/**
 * Map legacy app types to new simplified types.
 */
function mapLegacyType(type: string): 'web' | 'mobile' | null {
  const webTypes = ['web', 'nextjs', 'vite', 'node', 'remix']
  const mobileTypes = ['mobile', 'expo', 'react-native']

  if (webTypes.includes(type)) return 'web'
  if (mobileTypes.includes(type)) return 'mobile'
  return null
}

/**
 * Parse launch.json content into a LaunchConfig object.
 * Returns null if parsing fails.
 */
export function parseLaunchConfig(content: string): LaunchConfig | null {
  try {
    const parsed = JSON.parse(content)

    // Validate required fields
    if (!parsed.type || !parsed.dev) {
      console.warn('[Launch] Invalid launch.json: missing required fields (type, dev)')
      return null
    }

    // Map legacy types to new types
    const mappedType = mapLegacyType(parsed.type)
    if (!mappedType) {
      console.warn(`[Launch] Invalid launch.json: unknown type "${parsed.type}"`)
      return null
    }

    if (mappedType !== parsed.type) {
      console.log(`[Launch] Mapped legacy type "${parsed.type}" to "${mappedType}"`)
    }

    return {
      type: mappedType,
      setup: typeof parsed.setup === 'string' ? parsed.setup : DEFAULT_CONFIGS[mappedType].setup,
      dev: parsed.dev,
    }
  } catch (error) {
    console.error('[Launch] Failed to parse launch.json:', error)
    return null
  }
}

/**
 * Get launch config from project files.
 * Reads .bfloat-ide/launch.json - returns null if not found.
 *
 * @param files - Map of file paths to file content
 * @returns LaunchConfig or null if not found
 */
export function getLaunchConfig(files: Record<string, { type: string; content: string } | undefined>): LaunchConfig | null {
  const launchFile = files[LAUNCH_CONFIG_PATH]
  if (launchFile?.type === 'file' && launchFile.content) {
    const config = parseLaunchConfig(launchFile.content)
    if (config) {
      console.log('[Launch] Using launch.json config:', config)
      return config
    }
  }

  console.log('[Launch] No .bfloat-ide/launch.json found')
  return null
}

/**
 * Build combined setup and dev command.
 * Handles port assignment for various package managers and frameworks.
 */
export function buildFullCommand(config: LaunchConfig, projectDir: string, port: number): string {
  const devCommand = config.dev.trim()

  // Check if the dev command uses npm/yarn/pnpm/bun run (needs -- to pass args)
  const usesPackageManagerRun = /^(npm|yarn|pnpm|bun)\s+run\s+/.test(devCommand)

  // Build the port argument
  // Use -- for package manager run commands to pass args to the underlying script
  const portArg = usesPackageManagerRun ? `-- --port ${port}` : `--port ${port}`

  // Set PORT environment variable as fallback (some frameworks use this)
  // Also pass --port flag for frameworks that support it
  return `cd "${projectDir}" && ${config.setup} && PORT=${port} ${devCommand} ${portArg}`
}
