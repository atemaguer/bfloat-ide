import { ConveyorApi } from '@/lib/preload/shared'

export type ProviderType = 'anthropic' | 'openai' | 'expo'

// Simplified token interface - Claude Code manages actual tokens internally
export interface OAuthTokens {
  type: 'oauth'
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  scopes?: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
  // Expo-specific fields
  userId?: string
  username?: string
}

export interface ProviderAuthState {
  anthropic: OAuthTokens | null
  openai: OAuthTokens | null
  expo: OAuthTokens | null
}

export interface AuthStatus {
  authenticated: boolean
  providers: ProviderType[]
}

export interface ConnectResult {
  success: boolean
  exitCode: number
  authenticated: boolean
  providers?: ProviderType[]
  output?: string
  tokenSaved?: boolean
}

export interface GitBashSelectionResult {
  success: boolean
  path?: string
  error?: string
}

export interface ExpoCredentials {
  username: string
  password: string
  otp?: string
}

export interface ExpoConnectResult {
  success: boolean
  exitCode: number
  authenticated: boolean
  username?: string
  error?: string
  output?: string
}

export interface ExpoAuthStatus {
  authenticated: boolean
  userId?: string
  username?: string
}

export interface DisconnectResult {
  success: boolean
  exitCode: number
}


export interface CliInstalledResult {
  installed: boolean
  path?: string
}


/**
 * Provider API - Simplified to use Claude Code CLI for authentication
 *
 * Instead of implementing our own OAuth flow, we leverage Claude Code's built-in
 * authentication commands (setup-token, auth login, auth logout).
 */
export class ProviderApi extends ConveyorApi {
  // Check if Claude Code CLI is installed system-wide (for Windows)
  checkClaudeCliInstalled = (): Promise<CliInstalledResult> => this.invoke('provider:check-claude-cli-installed')

  // Pick Git Bash on Windows for Claude Code
  selectGitBashPath = (): Promise<GitBashSelectionResult> => this.invoke('provider:select-git-bash')

  // Uses Claude Agent SDK via Bfloat proxy to run `claude setup-token`
  // and intelligently parse the OAuth token from the output.
  // No API keys on client - the proxy injects them server-side.
  connectAnthropic = (): Promise<ConnectResult> => this.invoke('provider:connect-anthropic')

  // Spawns `codex login` and waits for completion
  connectOpenAI = (): Promise<ConnectResult> => this.invoke('provider:connect-openai')

  // Spawns `eas login` with credentials
  connectExpo = (credentials: ExpoCredentials): Promise<ExpoConnectResult> =>
    this.invoke('provider:connect-expo', credentials)

  // Check if Claude Code CLI is authenticated
  checkAuth = (): Promise<AuthStatus> => this.invoke('provider:check-auth')

  // Check if EAS CLI is authenticated
  checkExpoAuth = (): Promise<ExpoAuthStatus> => this.invoke('provider:check-expo-auth')

  // Spawns `claude auth logout` and waits for completion
  disconnect = (provider: ProviderType): Promise<DisconnectResult> =>
    this.invoke('provider:disconnect', provider)

  // Persist auth state from CLI config files (used by renderer polling)
  saveTokens = (provider: ProviderType, tokens: OAuthTokens) =>
    this.invoke('provider:save-tokens', provider, tokens)

  clearTokens = (provider: ProviderType) => this.invoke('provider:clear-tokens', provider)

  loadTokens = (): Promise<ProviderAuthState> => this.invoke('provider:load-tokens')

  refreshTokens = (provider: ProviderType): Promise<OAuthTokens | null> =>
    this.invoke('provider:refresh-tokens', provider)

}
