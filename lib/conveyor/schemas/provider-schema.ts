import { z } from 'zod'

export const ProviderTypeSchema = z.enum(['anthropic', 'openai', 'expo'])
export const ProviderSettingsCredentialKeySchema = z.enum(['EXPO_TOKEN'])

// Simplified token schema - Claude Code manages the actual tokens
export const OAuthTokensSchema = z.object({
  type: z.literal('oauth'),
  // These fields are optional since Claude Code manages tokens internally
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  accountId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  subscriptionType: z.string().nullable().optional(),
  rateLimitTier: z.string().nullable().optional(),
  // Expo-specific fields
  userId: z.string().optional(),
  username: z.string().optional(),
})

export const ProviderAuthStateSchema = z.object({
  anthropic: OAuthTokensSchema.nullable(),
  openai: OAuthTokensSchema.nullable(),
  expo: OAuthTokensSchema.nullable(),
})

// Auth status returned by check-auth
export const AuthStatusSchema = z.object({
  authenticated: z.boolean(),
  providers: z.array(ProviderTypeSchema),
})

// Result from connect operations (setup-token, auth login)
export const ConnectResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number(),
  authenticated: z.boolean(),
  providers: z.array(ProviderTypeSchema).optional(),
  output: z.string().optional(),
})

export const GitBashSelectionResultSchema = z.object({
  success: z.boolean(),
  path: z.string().optional(),
  error: z.string().optional(),
})

// Expo credentials for login
export const ExpoCredentialsSchema = z.object({
  username: z.string(),
  password: z.string(),
  otp: z.string().optional(),
})

// Result from Expo connect operation
export const ExpoConnectResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number(),
  authenticated: z.boolean(),
  username: z.string().optional(),
  error: z.string().optional(),
  output: z.string().optional(),
})

// Expo auth status
export const ExpoAuthStatusSchema = z.object({
  authenticated: z.boolean(),
  userId: z.string().optional(),
  username: z.string().optional(),
})

// Result from CLI installation check
export const CliInstalledResultSchema = z.object({
  installed: z.boolean(),
  path: z.string().optional(),
})

// Result from disconnect operation
export const DisconnectResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number(),
})

export const ProviderSettingsCredentialsSchema = z
  .object({
    EXPO_TOKEN: z.string().optional(),
  })
  .partial()

export const ProviderSettingsSchema = z.object({
  integrations: z
    .object({
      anthropic: z.object({ enabled: z.boolean(), connectedAt: z.number().optional(), accountId: z.string().optional() }).optional(),
      openai: z.object({ enabled: z.boolean(), connectedAt: z.number().optional(), accountId: z.string().optional() }).optional(),
      expo: z
        .object({
          enabled: z.boolean(),
          connectedAt: z.number().optional(),
          userId: z.string().optional(),
          username: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  credentials: ProviderSettingsCredentialsSchema.optional(),
  cli: z.object({ gitBashPath: z.string().optional() }).optional(),
})

export const ProviderSettingsSavePayloadSchema = z.object({
  entries: z.array(
    z.object({
      key: ProviderSettingsCredentialKeySchema,
      value: z.string(),
    })
  ),
})


export const providerApiSchema = {
  // Check if Claude Code CLI is installed system-wide (for Windows)
  'provider:check-claude-cli-installed': {
    args: z.tuple([]),
    return: CliInstalledResultSchema,
  },
  // Pick Git Bash on Windows for Claude Code
  'provider:select-git-bash': {
    args: z.tuple([]),
    return: GitBashSelectionResultSchema,
  },
  // Spawns `claude setup-token` and waits for completion
  'provider:connect-anthropic': {
    args: z.tuple([]),
    return: ConnectResultSchema,
  },
  // Spawns `claude auth login` and waits for completion
  'provider:connect-openai': {
    args: z.tuple([]),
    return: ConnectResultSchema,
  },
  // Spawns `eas login` with credentials
  'provider:connect-expo': {
    args: z.tuple([ExpoCredentialsSchema]),
    return: ExpoConnectResultSchema,
  },
  // Check if Claude Code CLI is authenticated
  'provider:check-auth': {
    args: z.tuple([]),
    return: AuthStatusSchema,
  },
  // Check if EAS CLI is authenticated
  'provider:check-expo-auth': {
    args: z.tuple([]),
    return: ExpoAuthStatusSchema,
  },
  // Spawns `claude auth logout` and waits for completion
  'provider:disconnect': {
    args: z.tuple([ProviderTypeSchema]),
    return: DisconnectResultSchema,
  },
  // Legacy: No-op, Claude Code manages its own tokens
  'provider:save-tokens': {
    args: z.tuple([ProviderTypeSchema, OAuthTokensSchema]),
    return: z.void(),
  },
  // Legacy: No-op
  'provider:clear-tokens': {
    args: z.tuple([ProviderTypeSchema]),
    return: z.void(),
  },
  // Returns simplified auth state based on Claude Code's auth
  'provider:load-tokens': {
    args: z.tuple([]),
    return: ProviderAuthStateSchema,
  },
  'provider:get-settings': {
    args: z.tuple([]),
    return: ProviderSettingsSchema,
  },
  'provider:save-settings-credentials': {
    args: z.tuple([ProviderSettingsSavePayloadSchema]),
    return: ProviderSettingsSchema,
  },
  // Legacy: No-op, Claude Code handles refresh automatically
  'provider:refresh-tokens': {
    args: z.tuple([ProviderTypeSchema]),
    return: OAuthTokensSchema.nullable(),
  },
}
