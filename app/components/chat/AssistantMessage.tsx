/**
 * AssistantMessage Component - Grouped tool display design
 *
 * Renders AI assistant messages with text and grouped tool actions.
 * Consecutive tool calls are grouped into collapsible accordions.
 * Todos are displayed separately in the TaskProgress card above chat input.
 *
 * Features:
 * - Grouped tool display with collapsible accordions
 * - Single tools shown inline
 * - AskUserQuestion interactive forms (when enabled)
 * - Thinking indicator during streaming
 */

import { memo, useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Shimmer } from '@/app/components/ui/shimmer'
import { Markdown } from './Markdown'
import { ToolAccordion } from './ToolAccordion'
import { AskUserQuestion, type AskUserQuestionInput } from './AskUserQuestion'
import { ConvexSetupBanner } from './ConvexSetupBanner'
import { ConvexIntentBanner, type ConvexIntentMode } from './ConvexIntentBanner'
import { FirebaseSetupBanner } from './FirebaseSetupBanner'
import { StripeSetupBanner } from './StripeSetupBanner'
import { RevenueCatSetupBanner } from './RevenueCatSetupBanner'
import { isClaudeAuthError } from './ClaudeAuthBanner'
import {
  shouldRenderConvexIntentBanner,
  shouldRenderIntegrationSetupBanner,
  type IntegrationSetupRenderState,
} from './integrationSetupPolicy'
import type { MessagePart } from '@/app/types/project'
import type { ConvexIntegrationStage } from '@/app/lib/integrations/convex'
import type { ToolAction } from './types'
import { convertToolPartToAction } from './types'

// Section types
interface TextSection {
  type: 'text'
  content: string
}

interface ToolGroupSection {
  type: 'tool_group'
  actions: ToolAction[]
}

interface AskUserSection {
  type: 'ask_user'
  input: AskUserQuestionInput
  toolCallId: string
  isAnswered: boolean
}

interface SetupSectionMeta {
  originalPrompt?: string
  forceFrontendDesignSkill?: boolean
}

interface ConvexSetupSection {
  type: 'convex_setup'
  meta: SetupSectionMeta
}

interface ConvexIntentSection {
  type: 'convex_intent'
}

interface FirebaseSetupSection {
  type: 'firebase_setup'
  meta: SetupSectionMeta
}

interface StripeSetupSection {
  type: 'stripe_setup'
  meta: SetupSectionMeta
}

interface RevenueCatSetupSection {
  type: 'revenuecat_setup'
  meta: SetupSectionMeta
}

interface ClaudeAuthSection {
  type: 'claude_auth'
}

interface ReasoningSection {
  type: 'reasoning'
  content: string
}

// All section types
type Section =
  | TextSection
  | ToolGroupSection
  | AskUserSection
  | ConvexSetupSection
  | ConvexIntentSection
  | FirebaseSetupSection
  | StripeSetupSection
  | RevenueCatSetupSection
  | ClaudeAuthSection
  | ReasoningSection

interface AssistantMessageProps {
  messageId: string
  parts: MessagePart[]
  isStreaming?: boolean
  onAskUserSubmit?: (toolCallId: string, answers: Record<string, string>) => void
  onIntegrationConnect?: (id: string) => void
  onIntegrationUse?: (id: string) => void
  onIntegrationSkip?: (
    integrationId: string,
    originalPrompt?: string,
    forceFrontendDesignSkill?: boolean,
    messageId?: string
  ) => void
  onConvexIntentSelect?: (mode: ConvexIntentMode) => void
  onClaudeReconnect?: () => void
  onClaudeAuthError?: () => void
  convexStage?: ConvexIntegrationStage
  convexMissingKey?: 'url' | 'deploy_key' | null
  isFirebaseConnected?: boolean
  isFirebaseSettingUp?: boolean
  isStripeConnected?: boolean
  isStripeSettingUp?: boolean
  isRevenueCatConnected?: boolean
  isRevenueCatSettingUp?: boolean
  isClaudeAuthenticated?: boolean
}

// Parse message parts into displayable sections with tool grouping
function parseIntoSections(parts: MessagePart[]): Section[] {
  const rawSections: Section[] = []
  let currentToolGroup: ToolAction[] = []
  const getSetupMeta = (part: MessagePart): SetupSectionMeta => ({
    originalPrompt: typeof part.originalPrompt === 'string' ? part.originalPrompt : undefined,
    forceFrontendDesignSkill:
      typeof part.forceFrontendDesignSkill === 'boolean' ? part.forceFrontendDesignSkill : undefined,
  })

  // Helper to flush accumulated tools into a group section
  const flushToolGroup = () => {
    if (currentToolGroup.length > 0) {
      rawSections.push({
        type: 'tool_group',
        actions: [...currentToolGroup],
      })
      currentToolGroup = []
    }
  }

  for (const part of parts) {
    if (!part) continue

    // Skip metadata parts
    if (part.type === 'data-metadata' || part.type === 'step-start') continue

    // Handle convex setup prompt
    if (part.type === 'convex-setup-prompt') {
      flushToolGroup()
      rawSections.push({ type: 'convex_setup', meta: getSetupMeta(part) })
      continue
    }

    if (part.type === 'convex-intent-prompt') {
      flushToolGroup()
      rawSections.push({ type: 'convex_intent' })
      continue
    }

    // Handle firebase setup prompt
    if (part.type === 'firebase-setup-prompt') {
      flushToolGroup()
      rawSections.push({ type: 'firebase_setup', meta: getSetupMeta(part) })
      continue
    }

    // Handle stripe setup prompt
    if (part.type === 'stripe-setup-prompt') {
      flushToolGroup()
      rawSections.push({ type: 'stripe_setup', meta: getSetupMeta(part) })
      continue
    }

    // Handle revenuecat setup prompt
    if (part.type === 'revenuecat-setup-prompt') {
      flushToolGroup()
      rawSections.push({ type: 'revenuecat_setup', meta: getSetupMeta(part) })
      continue
    }

    const isToolPart = part.type?.startsWith('tool-') ?? false

    if (isToolPart) {
      // Skip non-display tool types
      if (part.type === 'tool-context' || part.type === 'tool-think') continue

      const toolName =
        ((part as Record<string, unknown>).toolName as string)?.toLowerCase() ||
        part.type.replace('tool-', '').toLowerCase()
      const args = (part as Record<string, unknown>).args as Record<string, unknown>
      const toolCallId = (part as Record<string, unknown>).toolCallId as string
      const state = (part as Record<string, unknown>).state as string
      const result = (part as Record<string, unknown>).result as Record<string, unknown> | undefined

      // Skip TodoWrite - it's displayed in TaskProgress card
      if (toolName === 'todowrite') continue

      // Handle AskUserQuestion - flush tools first, then add ask section
      if (toolName === 'askuserquestion' && args?.questions) {
        flushToolGroup()

        const answers = result?.answers || args.answers
        const isAnswered = !!answers && Object.keys(answers as object).length > 0

        rawSections.push({
          type: 'ask_user',
          input: {
            questions: args.questions as AskUserQuestionInput['questions'],
            answers: answers as Record<string, string> | undefined,
          },
          toolCallId: toolCallId || `ask-${rawSections.length}`,
          isAnswered,
        })
        continue
      }

      // Convert to ToolAction and accumulate in current group
      const action = convertToolPartToAction({
        type: part.type,
        toolCallId,
        toolName,
        state,
        args,
        result: (part as Record<string, unknown>).result,
      })

      if (action) {
        currentToolGroup.push(action)
      }
    } else if (part.type === 'reasoning' && 'text' in part && part.text) {
      flushToolGroup()
      rawSections.push({ type: 'reasoning', content: part.text })
    } else if (part.type === 'text' && 'text' in part && part.text) {
      // Strip <suggestions> tags (complete or partial during streaming)
      const text = part.text.replace(/<suggestions[\s\S]*$/, '').trim()
      if (text) {
        // Flush any accumulated tools before adding text
        flushToolGroup()

        // Check if this is a Claude auth error
        if (isClaudeAuthError(text)) {
          rawSections.push({ type: 'claude_auth' })
        } else {
          rawSections.push({
            type: 'text',
            content: text,
          })
        }
      }
    }
  }

  // Don't forget to flush any remaining tools
  flushToolGroup()

  return rawSections
}

function getSectionKey(section: Section, index: number): string {
  if (section.type === 'text' || section.type === 'reasoning') {
    return `${section.type}-${index}-${section.content.slice(0, 32)}`
  }
  if (section.type === 'tool_group') {
    return `tool-group-${section.actions[0]?.id || index}`
  }
  if (section.type === 'ask_user') {
    return `ask-user-${section.toolCallId}`
  }
  return `${section.type}-${index}`
}

function isAnimatedBannerSection(section: Section): boolean {
  return (
    section.type === 'convex_setup' ||
    section.type === 'convex_intent' ||
    section.type === 'firebase_setup' ||
    section.type === 'stripe_setup' ||
    section.type === 'revenuecat_setup'
  )
}

export const AssistantMessage = memo(function AssistantMessage({
  messageId,
  parts,
  isStreaming,
  onAskUserSubmit,
  onIntegrationConnect,
  onIntegrationUse,
  onIntegrationSkip,
  onConvexIntentSelect,
  onClaudeReconnect,
  onClaudeAuthError,
  convexStage = 'disconnected',
  convexMissingKey,
  isFirebaseConnected,
  isFirebaseSettingUp,
  isStripeConnected,
  isStripeSettingUp,
  isRevenueCatConnected,
  isRevenueCatSettingUp,
  isClaudeAuthenticated,
}: AssistantMessageProps) {
  // Track submitting state for AskUserQuestion
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const lastAuthErrorSignatureRef = useRef<string | null>(null)

  // Filter out null/undefined parts
  const safeParts = useMemo(() => parts.filter((part): part is MessagePart => part != null), [parts])

  // Parse into sections
  const sections = useMemo(() => parseIntoSections(safeParts), [safeParts])
  const integrationSetupRenderState = useMemo<IntegrationSetupRenderState>(
    () => ({
      convexStage,
      isFirebaseConnected: !!isFirebaseConnected,
      isFirebaseSettingUp: !!isFirebaseSettingUp,
      isStripeConnected: !!isStripeConnected,
      isStripeSettingUp: !!isStripeSettingUp,
      isRevenueCatConnected: !!isRevenueCatConnected,
      isRevenueCatSettingUp: !!isRevenueCatSettingUp,
    }),
    [
      convexStage,
      isFirebaseConnected,
      isFirebaseSettingUp,
      isStripeConnected,
      isStripeSettingUp,
      isRevenueCatConnected,
      isRevenueCatSettingUp,
    ]
  )
  const visibleSections = useMemo(
    () =>
      sections.filter((section) => {
        if (section.type === 'convex_setup') {
          return shouldRenderIntegrationSetupBanner('convex-setup-prompt', integrationSetupRenderState)
        }
        if (section.type === 'firebase_setup') {
          return shouldRenderIntegrationSetupBanner('firebase-setup-prompt', integrationSetupRenderState)
        }
        if (section.type === 'convex_intent') {
          return shouldRenderConvexIntentBanner(integrationSetupRenderState)
        }
        if (section.type === 'stripe_setup') {
          return shouldRenderIntegrationSetupBanner('stripe-setup-prompt', integrationSetupRenderState)
        }
        if (section.type === 'revenuecat_setup') {
          return shouldRenderIntegrationSetupBanner('revenuecat-setup-prompt', integrationSetupRenderState)
        }
        return true
      }),
    [sections, integrationSetupRenderState]
  )

  // Notify parent when Claude auth error is detected
  useEffect(() => {
    const authErrorTextSections = sections
      .filter((section): section is TextSection => section.type === 'text')
      .map((section) => section.content)
      .filter((content) => isClaudeAuthError(content))
    const hasAuthError = sections.some((s) => s.type === 'claude_auth') || authErrorTextSections.length > 0

    if (!hasAuthError) {
      lastAuthErrorSignatureRef.current = null
      return
    }

    const signature = authErrorTextSections.join('\n').slice(0, 400) || 'claude-auth-section'
    const shouldNotify = !isClaudeAuthenticated && lastAuthErrorSignatureRef.current !== signature

    if (shouldNotify) {
      lastAuthErrorSignatureRef.current = signature
      onClaudeAuthError?.()
    }

    if (isClaudeAuthenticated) {
      lastAuthErrorSignatureRef.current = null
    }
  }, [sections, isClaudeAuthenticated, onClaudeAuthError])

  // Handle AskUserQuestion submission
  const handleAskUserSubmit = useCallback(
    (toolCallId: string, answers: Record<string, string>) => {
      setSubmittingId(toolCallId)
      onAskUserSubmit?.(toolCallId, answers)
    },
    [onAskUserSubmit]
  )

  // Check if there's any renderable content
  const hasContent = visibleSections.length > 0

  // Show thinking indicator if no content yet
  if (!hasContent && isStreaming) {
    return (
      <div className="assistant-thinking">
        <Shimmer duration={1.5}>Thinking...</Shimmer>
      </div>
    )
  }

  if (!hasContent) return null

  return (
    <div className="assistant-message">
      <AnimatePresence initial={false}>
        {visibleSections.map((section, index) => {
          const sectionKey = getSectionKey(section, index)

          let content: ReactNode = null

          if (section.type === 'text') {
            const isLastSection = index === visibleSections.length - 1
            content = (
              <div className="assistant-text">
                <Markdown isAnimating={isLastSection && !!isStreaming}>{section.content}</Markdown>
              </div>
            )
          }

          if (section.type === 'reasoning') {
            content = <div className="assistant-reasoning">{section.content}</div>
          }

          if (section.type === 'tool_group') {
            const isLastSection = index === visibleSections.length - 1
            content = <ToolAccordion actions={section.actions} isStreaming={isLastSection && isStreaming} />
          }

          if (section.type === 'convex_setup') {
            content = (
              <ConvexSetupBanner
                stage={convexStage}
                missingKey={convexMissingKey}
                onConnect={() => onIntegrationConnect?.('convex')}
                onUse={() => onIntegrationUse?.('convex')}
                onSkip={() =>
                  onIntegrationSkip?.(
                    'convex',
                    section.meta.originalPrompt,
                    section.meta.forceFrontendDesignSkill,
                    messageId
                  )
                }
              />
            )
          }

          if (section.type === 'convex_intent') {
            content = <ConvexIntentBanner onSelect={(mode) => onConvexIntentSelect?.(mode)} />
          }

          if (section.type === 'firebase_setup') {
            content = (
              <FirebaseSetupBanner
                isConnected={!!isFirebaseConnected}
                isSettingUp={!!isFirebaseSettingUp}
                onConnect={() => onIntegrationConnect?.('firebase')}
                onUse={() => onIntegrationUse?.('firebase')}
                onSkip={() =>
                  onIntegrationSkip?.(
                    'firebase',
                    section.meta.originalPrompt,
                    section.meta.forceFrontendDesignSkill,
                    messageId
                  )
                }
              />
            )
          }

          if (section.type === 'ask_user') {
            content = (
              <AskUserQuestion
                input={section.input}
                onSubmit={(answers) => handleAskUserSubmit(section.toolCallId, answers)}
                isSubmitting={submittingId === section.toolCallId}
                isAnswered={section.isAnswered}
              />
            )
          }

          if (section.type === 'stripe_setup') {
            content = (
              <StripeSetupBanner
                isConnected={!!isStripeConnected}
                isSettingUp={!!isStripeSettingUp}
                onConnect={() => onIntegrationConnect?.('stripe')}
                onUse={() => onIntegrationUse?.('stripe')}
                onSkip={() =>
                  onIntegrationSkip?.(
                    'stripe',
                    section.meta.originalPrompt,
                    section.meta.forceFrontendDesignSkill,
                    messageId
                  )
                }
              />
            )
          }

          if (section.type === 'revenuecat_setup') {
            content = (
              <RevenueCatSetupBanner
                isConnected={!!isRevenueCatConnected}
                isSettingUp={!!isRevenueCatSettingUp}
                onConnect={() => onIntegrationConnect?.('revenuecat')}
                onUse={() => onIntegrationUse?.('revenuecat')}
                onSkip={() =>
                  onIntegrationSkip?.(
                    'revenuecat',
                    section.meta.originalPrompt,
                    section.meta.forceFrontendDesignSkill,
                    messageId
                  )
                }
              />
            )
          }

          if (!content) {
            return null
          }

          return (
            <motion.div
              key={sectionKey}
              layout={isAnimatedBannerSection(section)}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98, height: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              {content}
            </motion.div>
          )
        })}
      </AnimatePresence>

      {/* Streaming indicator at end */}
      {isStreaming && (
        <div className="streaming-indicator">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
    </div>
  )
})

AssistantMessage.displayName = 'AssistantMessage'
