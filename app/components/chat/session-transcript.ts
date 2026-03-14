import { generateId } from 'ai'

import type { AgentMessage } from '@/lib/conveyor/schemas/ai-agent-schema'
import type { ChatMessage, MessagePart } from '@/app/types/project'

export interface SessionHistoryDisplayMessage {
  id: string
  role: 'user'
  content: string
  parts?: Record<string, unknown>[]
  createdAt: string
}

export interface SessionHistoryEntry {
  kind: 'user_message' | 'agent_message'
  message: SessionHistoryDisplayMessage | AgentMessage
}

export function applyAgentMessageToTranscript(
  messages: ChatMessage[],
  msg: AgentMessage,
): ChatMessage[] {
  const messageTimestamp =
    typeof msg.timestamp === 'string' && msg.timestamp.length > 0 ? new Date(msg.timestamp).toISOString() : new Date().toISOString()

  if (msg.type === 'text') {
    const textContent = msg.content as string
    const lastMsg = messages[messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      const existingParts = lastMsg.parts || []
      const lastPart = existingParts[existingParts.length - 1]

      const newParts =
        lastPart && lastPart.type === 'text' && 'text' in lastPart
          ? [
              ...existingParts.slice(0, -1),
              { type: 'text' as const, text: (lastPart.text || '') + textContent },
            ]
          : [...existingParts, { type: 'text' as const, text: textContent }]

      return [
        ...messages.slice(0, -1),
        {
          ...lastMsg,
          content: (lastMsg.content || '') + textContent,
          parts: newParts,
        },
      ]
    }

    return [
      ...messages,
      {
        id: generateId(),
        role: 'assistant',
        content: textContent,
        parts: [{ type: 'text', text: textContent }],
        createdAt: messageTimestamp,
      },
    ]
  }

  if (msg.type === 'tool_call') {
    const toolContent = msg.content as {
      id: string
      name: string
      input: Record<string, unknown>
      status?: string
      output?: string
    }

    const toolPart: MessagePart = {
      type: `tool-${toolContent.name}`,
      toolCallId: toolContent.id || generateId(),
      toolName: toolContent.name,
      state: (toolContent.status === 'completed' ? 'result' : 'call') as 'call' | 'result',
      args: toolContent.input,
      result: toolContent.output,
    }

    const lastMsg = messages[messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      return [
        ...messages.slice(0, -1),
        {
          ...lastMsg,
          parts: [...(lastMsg.parts || []), toolPart],
        },
      ]
    }

    return [
      ...messages,
      {
        id: generateId(),
        role: 'assistant',
        content: '',
        parts: [toolPart],
        createdAt: messageTimestamp,
      },
    ]
  }

  if (msg.type === 'tool_result') {
    const resultContent = msg.content as { callId: string; output: string }
    const lastMsg = messages[messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.parts) {
      const updatedParts = lastMsg.parts.map((part) => {
        if ('toolCallId' in part && part.toolCallId === resultContent.callId) {
          return {
            ...part,
            state: 'result' as const,
            result: resultContent.output,
          }
        }
        return part
      })

      return [
        ...messages.slice(0, -1),
        {
          ...lastMsg,
          parts: updatedParts,
        },
      ]
    }

    return messages
  }

  if (msg.type === 'reasoning') {
    const reasoningContent = msg.content as string
    const lastMsg = messages[messages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      return [
        ...messages.slice(0, -1),
        {
          ...lastMsg,
          parts: [...(lastMsg.parts || []), { type: 'reasoning' as const, text: reasoningContent || '' }],
        },
      ]
    }

    return [
      ...messages,
      {
        id: generateId(),
        role: 'assistant',
        content: reasoningContent || '',
        parts: [{ type: 'reasoning', text: reasoningContent || '' }],
        createdAt: messageTimestamp,
      },
    ]
  }

  return messages
}

export function hydrateTranscriptFromHistory(entries: SessionHistoryEntry[]): { messages: ChatMessage[]; lastSeq: number } {
  let messages: ChatMessage[] = []
  let lastSeq = 0

  for (const entry of entries) {
    if (entry.kind === 'user_message') {
      const message = entry.message as SessionHistoryDisplayMessage
      messages = [
        ...messages,
        {
          id: message.id,
          role: 'user',
          content: message.content,
          parts: (message.parts as MessagePart[] | undefined) || [{ type: 'text', text: message.content }],
          createdAt: message.createdAt,
        },
      ]
      continue
    }

    const message = entry.message as AgentMessage
    const seq = message.metadata?.seq
    if (typeof seq === 'number' && seq > lastSeq) {
      lastSeq = seq
    }
    messages = applyAgentMessageToTranscript(messages, message)
  }

  return { messages, lastSeq }
}
