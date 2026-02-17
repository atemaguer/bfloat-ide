/**
 * Prompt Classifier
 *
 * Hierarchical prompt classification with confidence scores.
 * Uses priority-ordered classifiers to detect EAS CLI prompts.
 *
 * Priority levels:
 * 1. High confidence (0.95): Apple ID, Password, 2FA
 * 2. Medium confidence (0.80): Menu patterns
 * 3. Low confidence (0.70): Generic yes/no, trailing ?
 * 4. Fallback (0.50): Structural indicators detected but no pattern match
 */

export type PromptType = 'apple_id' | 'password' | '2fa' | 'menu' | 'yes_no' | 'unknown'

export interface ClassificationResult {
  type: PromptType
  confidence: number
  matchedPattern?: string
  suggestion?: string
}

interface PromptPattern {
  type: PromptType
  patterns: RegExp[]
  confidence: number
  suggestion?: string
}

// Clean ANSI escape codes for pattern matching
function cleanAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[]/g, '')
    .replace(/\r/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x08]/g, '')
}

export class PromptClassifier {
  private patterns: PromptPattern[]

  constructor() {
    // Patterns ordered by priority (most specific first)
    this.patterns = [
      // High confidence: Yes/No prompts (check first - these are often misclassified)
      {
        type: 'yes_no',
        patterns: [
          /^\s*›\s*Yes,?\s*sign in/m, // Inquirer menu with "Yes, sign in" highlighted
          /Do you want to log in.*Apple/i, // Apple login confirmation
          /log in to your Apple account\?/i, // Alternative phrasing
          /\(y\/n\)/i,
          /\(yes\/no\)/i,
          /\[y\/n\]/i,
          /\[yes\/no\]/i,
          /continue\?\s*$/i,
          /proceed\?\s*$/i,
          /confirm\?\s*$/i,
        ],
        confidence: 0.90,
        suggestion: 'Respond with yes or no',
      },

      // High confidence: Apple ID prompt
      {
        type: 'apple_id',
        patterns: [
          /Apple ID:\s*$/m, // Line ends with "Apple ID:"
          /^\s*Apple ID\s*›/m, // Inquirer-style prompt
          /enter.*apple\s*id/i,
          /your\s+apple\s*id/i,
        ],
        confidence: 0.95,
        suggestion: 'Enter your Apple ID (email)',
      },

      // High confidence: Password prompt
      {
        type: 'password',
        patterns: [
          /Password\s*(\[.*\])?\s*:\s*$/m,
          /^\s*Password\s*›/m, // Inquirer-style prompt
          /enter.*password/i,
          /your\s+password/i,
          /password\s+for/i,
        ],
        confidence: 0.95,
        suggestion: 'Enter your password',
      },

      // High confidence: 2FA code prompt
      {
        type: '2fa',
        patterns: [
          /6.?digit\s+code/i,
          /verification\s+code/i,
          /two.?factor/i,
          /2fa\s+code/i,
          /enter.*code.*sent/i,
          /security\s+code/i,
          /trusted\s+device/i,
          /Code:\s*$/m,
        ],
        confidence: 0.95,
        suggestion: 'Enter the 6-digit verification code from your device',
      },

      // Medium confidence: Menu selection patterns
      {
        type: 'menu',
        patterns: [
          /^\s*›\s*.+$/m, // Line starting with › (menu selection indicator)
          /\[1\]/,
          /\(1\)/,
          /use\s+arrow\s+keys/i,
          /select.*option/i,
          /choose.*from/i,
          /pick\s+a/i,
          /which\s+.*\?/i,
        ],
        confidence: 0.85,
        suggestion: 'Select an option from the menu',
      },
    ]
  }

  /**
   * Classify the output tail to detect what type of prompt is being shown
   */
  classify(outputTail: string): ClassificationResult {
    const cleanTail = cleanAnsi(outputTail)

    // Check each pattern in priority order
    for (const patternGroup of this.patterns) {
      for (const pattern of patternGroup.patterns) {
        if (pattern.test(cleanTail)) {
          return {
            type: patternGroup.type,
            confidence: patternGroup.confidence,
            matchedPattern: pattern.source,
            suggestion: patternGroup.suggestion,
          }
        }
      }
    }

    // Fallback: Check for structural indicators
    const structuralConfidence = this.checkStructuralIndicators(cleanTail)

    if (structuralConfidence > 0.5) {
      return {
        type: 'unknown',
        confidence: structuralConfidence,
        suggestion: 'Unknown prompt detected - may need manual input',
      }
    }

    // No prompt detected
    return {
      type: 'unknown',
      confidence: 0,
    }
  }

  /**
   * Check for structural indicators that suggest a prompt
   * (colon at end, question mark, input field patterns)
   */
  private checkStructuralIndicators(text: string): number {
    const lines = text.trim().split('\n')
    const lastLine = lines[lines.length - 1]?.trim() || ''
    const lastFewLines = lines.slice(-3).join('\n')

    let confidence = 0

    // Trailing colon suggests input prompt
    if (lastLine.endsWith(':')) {
      confidence += 0.3
    }

    // Trailing question mark
    if (lastLine.endsWith('?')) {
      confidence += 0.25
    }

    // Trailing arrow or prompt characters
    if (/[›>]\s*$/.test(lastLine)) {
      confidence += 0.2
    }

    // Input field indicator (blank after prompt)
    if (/:\s*$/.test(lastLine) && lastLine.length < 50) {
      confidence += 0.15
    }

    // Check for common prompt words
    const promptWords = ['enter', 'input', 'type', 'provide', 'select', 'choose', 'pick']
    for (const word of promptWords) {
      if (lastFewLines.toLowerCase().includes(word)) {
        confidence += 0.1
        break
      }
    }

    return Math.min(confidence, 0.7) // Cap structural confidence
  }

  /**
   * Quick check if output looks like it's waiting for input
   * (lighter weight than full classification)
   */
  isLikelyWaitingForInput(outputTail: string): boolean {
    const cleanTail = cleanAnsi(outputTail)
    const lines = cleanTail.trim().split('\n')
    const lastLine = lines[lines.length - 1]?.trim() || ''

    // Quick structural checks
    if (lastLine.endsWith(':') || lastLine.endsWith('?')) {
      return true
    }

    // Check for any high-confidence pattern
    for (const patternGroup of this.patterns) {
      if (patternGroup.confidence >= 0.8) {
        for (const pattern of patternGroup.patterns) {
          if (pattern.test(cleanTail)) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Get suggestions for what to enter based on classification
   */
  getSuggestion(type: PromptType): string {
    const suggestions: Record<PromptType, string> = {
      apple_id: 'Enter your Apple ID (email address)',
      password: 'Enter your Apple ID password',
      '2fa': 'Enter the 6-digit verification code sent to your device',
      menu: 'Use number keys or arrows to select an option',
      yes_no: 'Type "y" for yes or "n" for no',
      unknown: 'This prompt may require manual input',
    }
    return suggestions[type]
  }
}
