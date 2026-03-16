/**
 * Messages Component - Custom chat display
 *
 * Renders the message list with a clean, avatar-free design.
 * User messages appear on the right, assistant messages on the left.
 */

import { memo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain } from 'lucide-react'

import type { ChatMessage } from '@/app/types/project'
import type { ConvexIntegrationStage } from '@/app/lib/integrations/convex'
import { workbenchStore } from '@/app/stores/workbench'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import type { ConvexIntentMode } from './ConvexIntentBanner'

interface MessagesProps {
  messages: ChatMessage[]
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

interface ToolCallPart {
  type: string
  input: {
    filePath: string
    content?: string
  }
  output: unknown
}

function validateJsonWrite(filePath: string, content: string): string | null {
  if (!filePath.toLowerCase().endsWith('.json')) return null

  try {
    JSON.parse(content)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown JSON parse error'
  }
}

export const Messages = memo(function Messages({
  messages,
  isStreaming,
  onAskUserSubmit,
  onIntegrationConnect,
  onIntegrationUse,
  onIntegrationSkip,
  onConvexIntentSelect,
  onClaudeReconnect,
  onClaudeAuthError,
  convexStage,
  convexMissingKey,
  isFirebaseConnected,
  isFirebaseSettingUp,
  isStripeConnected,
  isStripeSettingUp,
  isRevenueCatConnected,
  isRevenueCatSettingUp,
  isClaudeAuthenticated,
}: MessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Track whether we're in an active streaming session
  // This is used to determine if tool calls should be processed
  const wasStreamingRef = useRef(false)

  // Track streaming state transitions
  useEffect(() => {
    wasStreamingRef.current = isStreaming || false
  }, [isStreaming])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    // Keep latest assistant cards fully visible, especially near the input edge.
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    })
  }, [messages])

  // Process tool calls to apply file operations ONLY during active streaming
  // Historical messages (from backend or local session storage) should NEVER trigger
  // file writes since files are already on disk from the agent's work.
  // The agent (Claude Code / Codex) writes files directly to disk, so we only need
  // to update the in-memory state during live streaming for immediate UI feedback.
  useEffect(() => {
    if (messages.length === 0) return

    // CRITICAL: Only process tool calls during active streaming
    // This prevents historical messages from overwriting files on disk
    if (!isStreaming && !wasStreamingRef.current) {
      return
    }

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role === 'assistant' && lastMessage.parts) {
      const toolParts = lastMessage.parts.filter((part) => part?.type?.startsWith('tool-')) as ToolCallPart[]

      for (const part of toolParts) {
        // Only process tool calls that have output (completed)
        if (part.output) {
          const { filePath, content } = part.input
          if (filePath && content !== undefined) {
            const jsonError = validateJsonWrite(filePath, content)
            if (jsonError) {
              const errorMessage = `Blocked invalid JSON write to ${filePath}: ${jsonError}`
              console.error(`[Messages] ${errorMessage}`)
              workbenchStore.setPromptError(errorMessage)
              break
            }
          }

          switch (part.type) {
            case 'tool-createFile': {
              if (filePath && content !== undefined) {
                workbenchStore.addFile(filePath, content)
              }
              break
            }
            case 'tool-updateFile': {
              if (filePath && content !== undefined) {
                workbenchStore.updateFile(filePath, content)
              }
              break
            }
            case 'tool-deleteFile': {
              const { filePath } = part.input
              if (filePath) {
                workbenchStore.deleteFile(filePath)
              }
              break
            }
          }
        }
      }
    }
  }, [messages, isStreaming])

  // Empty state
  if (messages.length === 0) {
    return (
      <div className="messages-empty">
        <div className="messages-empty-icon">
          <Brain size={28} />
        </div>
        <h3>What would you like to build?</h3>
        <p>Describe your app idea and I'll help you bring it to life</p>
      </div>
    )
  }

  return (
    <div className="messages-list">
      <AnimatePresence mode="popLayout">
        {messages.map((message, index) => {
          const { role, parts = [] } = message
          const isUserMessage = role === 'user'
          const isLast = index === messages.length - 1

          // For user messages, extract content safely
          const content = isUserMessage
            ? parts
                .filter(
                  (part): part is { type: 'text'; text: string } =>
                    part != null && part.type === 'text' && typeof part.text === 'string'
                )
                .map((part) => part.text)
                .join('')
            : message.content || ''

          return (
            <motion.div
              key={message.id || index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={`message-item ${isUserMessage ? 'user' : 'assistant'}`}
            >
              {/* Message content */}
              {isUserMessage ? (
                <UserMessage content={content} parts={parts} />
              ) : (
                <AssistantMessage
                  messageId={message.id}
                  parts={parts}
                  isStreaming={isStreaming && isLast}
                  onAskUserSubmit={onAskUserSubmit}
                  onIntegrationConnect={onIntegrationConnect}
                  onIntegrationUse={onIntegrationUse}
                  onIntegrationSkip={onIntegrationSkip}
                  onConvexIntentSelect={onConvexIntentSelect}
                  onClaudeReconnect={onClaudeReconnect}
                  onClaudeAuthError={onClaudeAuthError}
                  convexStage={convexStage}
                  convexMissingKey={convexMissingKey}
                  isFirebaseConnected={isFirebaseConnected}
                  isFirebaseSettingUp={isFirebaseSettingUp}
                  isStripeConnected={isStripeConnected}
                  isStripeSettingUp={isStripeSettingUp}
                  isRevenueCatConnected={isRevenueCatConnected}
                  isRevenueCatSettingUp={isRevenueCatSettingUp}
                  isClaudeAuthenticated={isClaudeAuthenticated}
                />
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div ref={messagesEndRef} />
    </div>
  )
})
