/**
 * Launch configuration for running projects in the IDE.
 * Stored in `.bfloat-ide/launch.json` at the project root.
 */
export interface LaunchConfig {
  /**
   * App type - determines readiness detection patterns and port range.
   * - "web": Web apps (Next.js, Vite, React, etc.) - uses ports 9000-9999
   * - "mobile": Mobile apps (Expo/React Native) - uses ports 19000-19999
   */
  type: 'web' | 'mobile'

  /**
   * Setup command - runs before dev server starts.
   * Should include dependency installation and any other preparation.
   * Example: "bun install"
   */
  setup: string

  /**
   * Dev server command - runs after setup completes.
   * IDE will append --port {dynamicallyAssignedPort} to this command.
   * Example: "bun run dev" or "bun vite"
   */
  dev: string
}

/**
 * Default configurations by app type.
 * Port is dynamically assigned at runtime from the appropriate range.
 *
 * Note: Mobile/Expo uses npm instead of bun because react-native-worklets
 * and other native dependencies have build scripts that can stall with bun.
 */
export const DEFAULT_CONFIGS: Record<LaunchConfig['type'], Omit<LaunchConfig, 'type'>> = {
  web: {
    setup: 'bun install',
    dev: 'bun run dev',
  },
  mobile: {
    setup: 'npm install --legacy-peer-deps',
    dev: 'BROWSER=none npx expo start --web --clear',
  },
}
