/**
 * Prompt Humanizer - Maps EAS terminal prompts to user-friendly UI
 *
 * Recognizes common EAS/Expo CLI prompts and provides:
 * - User-friendly question text
 * - Explanation of what each option does
 * - Recommended action
 */

export interface HumanizedPromptOption {
  label: string
  value: string
  recommended?: boolean
}

export interface HumanizedPrompt {
  title: string
  description: string
  options: HumanizedPromptOption[]
  rawPrompt?: string
}

interface PromptMapping {
  pattern: RegExp
  humanize: (match: RegExpMatchArray, rawText: string) => HumanizedPrompt
}

// Helper to clean ANSI escape codes
function cleanAnsi(text: string): string {
  return text
    // Remove ANSI escape sequences (colors, cursor movement, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Remove OSC sequences (title changes, hyperlinks, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Remove other escape sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[]/g, '')
    // Remove carriage returns (used for overwriting lines)
    .replace(/\r/g, '')
    // Remove backspace characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x08]/g, '')
    // Clean up multiple consecutive newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Common EAS/Expo CLI prompt mappings
const PROMPT_MAPPINGS: PromptMapping[] = [
  // Configure existing project
  {
    pattern: /Configure this project\?/i,
    humanize: (_match, rawText) => ({
      title: 'Link to Existing Project',
      description: 'We found an existing EAS project. Would you like to use it for this app?',
      options: [
        { label: 'Yes, use this project', value: 'y\n', recommended: true },
        { label: 'No, create new project', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Generate new credentials
  {
    pattern: /Generate new credentials\?|generate a new.*certificate/i,
    humanize: (_match, rawText) => ({
      title: 'Create App Signing',
      description: 'We need to create signing certificates for your app. This is required for App Store submission.',
      options: [
        { label: 'Yes, generate new', value: 'y\n', recommended: true },
        { label: 'No, I have existing', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Apple login prompt
  {
    pattern: /Do you want to log in to your Apple account\?|log in.*Apple/i,
    humanize: (_match, rawText) => ({
      title: 'Sign in to Apple',
      description: 'We need to sign in to your Apple Developer account to submit your app to the App Store.',
      options: [
        { label: 'Yes, sign in', value: 'y\n', recommended: true },
        { label: 'Skip for now', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Team selection
  {
    pattern: /Select a team|Which team/i,
    humanize: (_match, rawText) => ({
      title: 'Choose Development Team',
      description: 'Select which Apple Developer team should own this app. If you have multiple teams, choose the one with an active membership.',
      options: [
        { label: 'Select first team', value: '1\n', recommended: true },
        { label: 'Select second team', value: '2\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Let us generate a new certificate
  {
    pattern: /Let us generate a new.*cert|create a new.*certificate/i,
    humanize: (_match, rawText) => ({
      title: 'Create Distribution Certificate',
      description: 'A distribution certificate is needed to sign your app. Should we create one for you?',
      options: [
        { label: 'Yes, create for me', value: 'y\n', recommended: true },
        { label: 'No, I\'ll provide one', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Reuse existing certificate
  {
    pattern: /Would you like to reuse this certificate\?|reuse.*existing.*certificate/i,
    humanize: (_match, rawText) => ({
      title: 'Reuse Existing Certificate',
      description: 'We found an existing distribution certificate. Using it saves time and avoids certificate limits.',
      options: [
        { label: 'Yes, reuse it', value: 'y\n', recommended: true },
        { label: 'No, create new', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Create new provisioning profile
  {
    pattern: /create a new provisioning profile|Generate a new provisioning profile/i,
    humanize: (_match, rawText) => ({
      title: 'Create Provisioning Profile',
      description: 'A provisioning profile links your app to your developer account and certificates.',
      options: [
        { label: 'Yes, create for me', value: 'y\n', recommended: true },
        { label: 'No, I\'ll provide one', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Select provisioning profile
  {
    pattern: /Select a provisioning profile|Which provisioning profile/i,
    humanize: (_match, rawText) => ({
      title: 'Select Provisioning Profile',
      description: 'Choose which provisioning profile to use for this build.',
      options: [
        { label: 'Use first profile', value: '1\n', recommended: true },
        { label: 'Use second profile', value: '2\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Would you like EAS to generate credentials
  {
    pattern: /Would you like EAS to generate|Let EAS handle/i,
    humanize: (_match, rawText) => ({
      title: 'Auto-Generate Credentials',
      description: 'EAS can automatically create and manage your signing credentials. This is the easiest option.',
      options: [
        { label: 'Yes, handle it for me', value: 'y\n', recommended: true },
        { label: 'No, I\'ll manage myself', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Set up push notifications
  {
    pattern: /set up push notifications|configure push notifications/i,
    humanize: (_match, rawText) => ({
      title: 'Setup Push Notifications',
      description: 'Push notifications require additional credentials. Would you like to set them up now?',
      options: [
        { label: 'Yes, set up now', value: 'y\n', recommended: true },
        { label: 'Skip for now', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Use existing push key
  {
    pattern: /use.*existing.*push.*key|reuse.*push.*key/i,
    humanize: (_match, rawText) => ({
      title: 'Reuse Push Key',
      description: 'We found an existing push notification key. Would you like to use it?',
      options: [
        { label: 'Yes, reuse it', value: 'y\n', recommended: true },
        { label: 'No, create new', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Auto-create EAS project
  {
    pattern: /Would you like to automatically create an EAS project/i,
    humanize: (_match, rawText) => ({
      title: 'Create EAS Project',
      description: 'An EAS project links your app to Expo\'s build service. This is required for iOS builds.',
      options: [
        { label: 'Yes, create project', value: 'y\n', recommended: true },
        { label: 'No, skip', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // Generate new Apple Provisioning Profile
  {
    pattern: /Generate a new Apple Provisioning Profile\?/i,
    humanize: (_match, rawText) => ({
      title: 'Create Provisioning Profile',
      description: 'A provisioning profile links your app to your Apple Developer account. Should we create one?',
      options: [
        { label: 'Yes, create for me', value: 'y\n', recommended: true },
        { label: 'No, I\'ll provide one', value: 'n\n' },
      ],
      rawPrompt: cleanAnsi(rawText),
    }),
  },

  // General yes/no fallback - matches (Y/n) or (y/N) patterns
  {
    pattern: /\(Y\/n\)|\(y\/N\)|\[Y\/n\]|\[y\/N\]/i,
    humanize: (_match, rawText) => {
      const cleanText = cleanAnsi(rawText)
      // Extract the question part (before the Y/n or › symbol)
      // Remove › and other separator characters
      const normalizedText = cleanText.replace(/[›»→]/g, ' ')
      const questionMatch = normalizedText.match(/\?\s*([^([\n]*)\s*\(?[Yy]\/[Nn]\)?/i)
      // Get the text before the last ? as the question
      const beforeQuestion = normalizedText.split(/\?\s*\(?[Yy]\/[Nn]\)?/i)[0]
      const question = beforeQuestion?.trim()
        ? beforeQuestion.trim() + '?'
        : questionMatch?.[1]?.trim() || 'Confirm this action?'

      // Determine default from case (Y/n means Yes is default, y/N means No is default)
      const yesIsDefault = /\(Y\/n\)|\[Y\/n\]/i.test(rawText)

      return {
        title: 'Confirm Action',
        description: question,
        options: yesIsDefault
          ? [
              { label: 'Yes', value: 'y\n', recommended: true },
              { label: 'No', value: 'n\n' },
            ]
          : [
              { label: 'Yes', value: 'y\n' },
              { label: 'No', value: 'n\n', recommended: true },
            ],
        rawPrompt: cleanText,
      }
    },
  },
]

/**
 * Check if a prompt appears to be already answered
 * (e.g., "Apple ID: user@example.com" or "? Configure this project? Yes")
 */
function isPromptAnswered(text: string): boolean {
  const lines = text.trim().split('\n')
  const lastLine = lines[lines.length - 1]?.trim() || ''

  // If the last line ends with common prompt endings, it's still waiting
  if (/:\s*$/.test(lastLine) || /\?\s*$/.test(lastLine) || /\(y\/n\)\s*$/i.test(lastLine)) {
    return false
  }

  // Check for patterns that suggest input was already provided
  // e.g., "Apple ID: someone@example.com" - has content after the colon
  const colonPromptWithAnswer = /:\s+\S+/.test(lastLine)
  if (colonPromptWithAnswer && !lastLine.endsWith(':')) {
    return true
  }

  return false
}

/**
 * Humanizes a terminal prompt into a user-friendly format
 * @param rawText The raw terminal output containing the prompt
 * @returns HumanizedPrompt if recognized, undefined otherwise
 */
export function humanizePrompt(rawText: string): HumanizedPrompt | undefined {
  const cleanText = cleanAnsi(rawText)

  // Don't humanize if the prompt appears to be already answered
  if (isPromptAnswered(cleanText)) {
    return undefined
  }

  for (const mapping of PROMPT_MAPPINGS) {
    const match = cleanText.match(mapping.pattern)
    if (match) {
      return mapping.humanize(match, rawText)
    }
  }

  return undefined
}

/**
 * Clean ANSI codes from text for display
 * Re-exported for use in other modules
 */
export { cleanAnsi }
