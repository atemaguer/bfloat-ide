import { z } from 'zod'

// App Store Connect API Key - save arguments
export const SaveASCApiKeyArgsSchema = z.object({
  projectPath: z.string(),
  keyId: z.string(),
  issuerId: z.string(),
  keyContent: z.string(), // Base64 encoded .p8 content
})

// Interactive build arguments - uses Apple ID + password flow
export const IOSBuildInteractiveArgsSchema = z.object({
  projectPath: z.string(),
  appleId: z.string(),
  password: z.string(),
})

// Submit 2FA code arguments
export const Submit2FACodeArgsSchema = z.object({
  code: z.string().length(6),
})

// Submit terminal input arguments
export const SubmitTerminalInputArgsSchema = z.object({
  input: z.string(),
})

// Apple session info
export const AppleSessionInfoSchema = z.object({
  exists: z.boolean(),
  appleId: z.string().optional(),
  ageInDays: z.number().optional(),
  isValid: z.boolean().optional(),
  statusMessage: z.string().optional(),
})

// Prompt type enum
export const PromptTypeSchema = z.enum([
  'apple_id',
  'password',
  '2fa',
  'menu',
  'yes_no',
  'unknown',
])

// Humanized prompt option for user-friendly UI
export const HumanizedPromptOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  recommended: z.boolean().optional(),
})

// Humanized prompt - user-friendly version of terminal prompts
export const HumanizedPromptSchema = z.object({
  title: z.string(),
  description: z.string(),
  options: z.array(HumanizedPromptOptionSchema),
  rawPrompt: z.string().optional(),
})

// Interactive auth event - sent when prompts are detected
export const InteractiveAuthEventSchema = z.object({
  type: PromptTypeSchema,
  confidence: z.number(),
  context: z.string(),
  suggestion: z.string().optional(),
  humanized: HumanizedPromptSchema.optional(),
})

// App Store Connect API Key - save result
export const SaveASCApiKeyResultSchema = z.object({
  success: z.boolean(),
  keyPath: z.string().optional(),
  error: z.string().optional(),
})

// App Store Connect API Key - check result
export const CheckASCApiKeyResultSchema = z.object({
  configured: z.boolean(),
  keyId: z.string().optional(),
  issuerId: z.string().optional(),
  keyPath: z.string().optional(),
})

// iOS build step enum
export const IOSBuildStepSchema = z.enum([
  'init',
  'credentials',
  'build',
  'submit',
  'complete',
  'error',
])

// iOS build progress update
export const IOSBuildProgressSchema = z.object({
  step: IOSBuildStepSchema,
  message: z.string(),
  percent: z.number(),
  logs: z.string().optional(),
  buildUrl: z.string().optional(),
  error: z.string().optional(),
})

// iOS build start arguments
export const IOSBuildArgsSchema = z.object({
  projectPath: z.string(),
  skipCredentials: z.boolean().optional(),
})

// iOS build result
export const IOSBuildResultSchema = z.object({
  success: z.boolean(),
  buildUrl: z.string().optional(),
  error: z.string().optional(),
  needsOtp: z.boolean().optional(),
})

// Cancel build arguments
export const CancelBuildArgsSchema = z.object({
  buildId: z.string().optional(),
})

export const deployApiSchema = {
  // Save App Store Connect API Key
  'deploy:save-asc-api-key': {
    args: z.tuple([SaveASCApiKeyArgsSchema]),
    return: SaveASCApiKeyResultSchema,
  },
  // Check if App Store Connect API Key is configured
  'deploy:check-asc-api-key': {
    args: z.tuple([z.object({ projectPath: z.string() })]),
    return: CheckASCApiKeyResultSchema,
  },
  // Start iOS build process (uses --non-interactive if API key configured)
  'deploy:ios-build': {
    args: z.tuple([IOSBuildArgsSchema]),
    return: IOSBuildResultSchema,
  },
  // Cancel ongoing build
  'deploy:cancel-build': {
    args: z.tuple([CancelBuildArgsSchema]),
    return: z.object({ success: z.boolean() }),
  },
  // Start interactive iOS build with Apple ID credentials
  'deploy:ios-build-interactive': {
    args: z.tuple([IOSBuildInteractiveArgsSchema]),
    return: IOSBuildResultSchema,
  },
  // Submit 2FA code during interactive build
  'deploy:submit-2fa': {
    args: z.tuple([Submit2FACodeArgsSchema]),
    return: z.object({ success: z.boolean() }),
  },
  // Submit terminal input during interactive build
  'deploy:submit-terminal-input': {
    args: z.tuple([SubmitTerminalInputArgsSchema]),
    return: z.object({ success: z.boolean() }),
  },
  // Check Apple session status
  'deploy:check-apple-session': {
    args: z.tuple([z.object({ appleId: z.string() })]),
    return: AppleSessionInfoSchema,
  },
  // Clear Apple session
  'deploy:clear-apple-session': {
    args: z.tuple([z.object({ appleId: z.string().optional() })]),
    return: z.object({ success: z.boolean(), cleared: z.number() }),
  },
  // List all Apple sessions
  'deploy:list-apple-sessions': {
    args: z.tuple([]),
    return: z.object({
      sessions: z.array(AppleSessionInfoSchema),
      hasValidSession: z.boolean(),
    }),
  },
  // Write Apple credentials to a temp file for deployment
  'deploy:write-apple-creds-file': {
    args: z.tuple([z.object({ appleId: z.string(), password: z.string() })]),
    return: z.object({ success: z.boolean(), path: z.string() }),
  },
  // Delete a credentials file
  'deploy:delete-creds-file': {
    args: z.tuple([z.object({ path: z.string() })]),
    return: z.object({ success: z.boolean() }),
  },
}

// Export types for use in handlers and API
export type SaveASCApiKeyArgs = z.infer<typeof SaveASCApiKeyArgsSchema>
export type SaveASCApiKeyResult = z.infer<typeof SaveASCApiKeyResultSchema>
export type CheckASCApiKeyResult = z.infer<typeof CheckASCApiKeyResultSchema>
export type IOSBuildStep = z.infer<typeof IOSBuildStepSchema>
export type IOSBuildProgress = z.infer<typeof IOSBuildProgressSchema>
export type IOSBuildArgs = z.infer<typeof IOSBuildArgsSchema>
export type IOSBuildResult = z.infer<typeof IOSBuildResultSchema>
export type IOSBuildInteractiveArgs = z.infer<typeof IOSBuildInteractiveArgsSchema>
export type Submit2FACodeArgs = z.infer<typeof Submit2FACodeArgsSchema>
export type SubmitTerminalInputArgs = z.infer<typeof SubmitTerminalInputArgsSchema>
export type AppleSessionInfo = z.infer<typeof AppleSessionInfoSchema>
export type PromptType = z.infer<typeof PromptTypeSchema>
export type HumanizedPromptOption = z.infer<typeof HumanizedPromptOptionSchema>
export type HumanizedPrompt = z.infer<typeof HumanizedPromptSchema>
export type InteractiveAuthEvent = z.infer<typeof InteractiveAuthEventSchema>
