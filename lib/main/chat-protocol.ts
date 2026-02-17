/**
 * Chat Protocol Handler for Electron
 *
 * Uses Electron's protocol.handle() to provide chat endpoints without an HTTP server.
 * This allows the renderer to use AI SDK's useChat with DefaultChatTransport via chat:// URLs.
 *
 * Endpoints:
 * - POST chat://api/chat - Send messages and receive streaming responses
 * - GET chat://api/chat/history - Load session history for resumption
 */

import { protocol } from 'electron'
import { getAgentManager } from '@/lib/agents'
import { readSession, sessionToMessages } from '@/lib/agents/session-reader'
import type { AgentSessionOptions, AgentProviderId, ToolCallContent, DoneContent, ErrorContent, InitContent } from '@/lib/agents/types'

// Track active sessions for cleanup
const activeSessions: Map<string, { cancel: () => void }> = new Map()

// Counter for generating unique IDs
let partIdCounter = 0

/**
 * Generate a unique ID for stream parts
 */
function generatePartId(): string {
  return `part-${Date.now()}-${++partIdCounter}`
}

/**
 * Create an SSE chunk string
 */
function sseChunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

/**
 * Handle POST chat://api/chat - streaming chat endpoint
 */
async function handleChatRequest(request: Request): Promise<Response> {
  const body = await request.json() as {
    messages: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>
    projectId?: string
    sessionId?: string
    provider?: AgentProviderId
    cwd?: string
  }

  const {
    messages,
    sessionId: requestSessionId,
    provider = 'claude',
    cwd,
  } = body

  console.log('[Chat Protocol] Chat request:', {
    messageCount: messages?.length,
    provider,
    sessionId: requestSessionId,
    cwd,
  })

  // Validate required fields
  if (!cwd) {
    return createErrorResponse('Missing cwd (working directory)')
  }

  // Extract the latest user message
  const lastUserMessage = messages?.filter(m => m.role === 'user').pop()
  const userPrompt = lastUserMessage?.parts?.find(p => p.type === 'text')?.text

  if (!userPrompt) {
    return createErrorResponse('No user message found')
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const write = (data: object) => {
        controller.enqueue(encoder.encode(sseChunk(data)))
      }

      const writeDone = () => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      }

      try {
        const manager = getAgentManager()

        // Create session options
        const sessionOptions: AgentSessionOptions & { provider?: AgentProviderId } = {
          cwd,
          provider,
          permissionMode: 'acceptEdits',
          resumeSessionId: requestSessionId || undefined,
        }

        const session = await manager.createSession(sessionOptions)

        // Track for cancellation
        let cancelled = false
        activeSessions.set(session.id, {
          cancel: () => {
            cancelled = true
            session.interrupt()
          },
        })

        // Generate a message ID for the assistant response
        const assistantMessageId = `msg-${Date.now()}`

        // Track part IDs for text and reasoning streaming
        let currentTextPartId: string | null = null
        let currentReasoningPartId: string | null = null

        // Emit start message
        write({
          type: 'start',
          messageId: assistantMessageId,
        })

        for await (const agentMessage of session.prompt(userPrompt)) {
          if (cancelled) break

          // Handle init message - extract session ID
          if (agentMessage.type === 'init') {
            const initContent = agentMessage.content as InitContent
            if (initContent.sessionId) {
              // Emit session ID as message metadata
              write({
                type: 'message-metadata',
                messageMetadata: {
                  sessionId: initContent.sessionId,
                  provider,
                },
              })
            }
            continue
          }

          // Handle done message
          if (agentMessage.type === 'done') {
            // End any open text stream
            if (currentTextPartId) {
              write({ type: 'text-end', id: currentTextPartId })
              currentTextPartId = null
            }
            // End any open reasoning stream
            if (currentReasoningPartId) {
              write({ type: 'reasoning-end', id: currentReasoningPartId })
              currentReasoningPartId = null
            }

            const doneContent = agentMessage.content as DoneContent
            write({
              type: 'finish',
              finishReason: doneContent.interrupted ? 'stop' : 'other',
            })
            continue
          }

          // Handle error message
          if (agentMessage.type === 'error') {
            const errorContent = agentMessage.content as ErrorContent
            write({
              type: 'error',
              errorText: errorContent.message,
            })
            continue
          }

          // Handle text message - stream as text-start/text-delta/text-end
          if (agentMessage.type === 'text') {
            const textContent = agentMessage.content as string
            if (!currentTextPartId) {
              // Start new text part
              currentTextPartId = generatePartId()
              write({ type: 'text-start', id: currentTextPartId })
            }
            // Write text delta
            write({
              type: 'text-delta',
              id: currentTextPartId,
              delta: textContent,
            })
            continue
          }

          // Handle reasoning message
          if (agentMessage.type === 'reasoning') {
            const reasoningContent = agentMessage.content as string
            if (!currentReasoningPartId) {
              // Start new reasoning part
              currentReasoningPartId = generatePartId()
              write({ type: 'reasoning-start', id: currentReasoningPartId })
            }
            // Write reasoning delta
            write({
              type: 'reasoning-delta',
              id: currentReasoningPartId,
              delta: reasoningContent,
            })
            continue
          }

          // Handle tool call - emit tool-input-available
          if (agentMessage.type === 'tool_call') {
            // End any open text stream first
            if (currentTextPartId) {
              write({ type: 'text-end', id: currentTextPartId })
              currentTextPartId = null
            }

            const toolContent = agentMessage.content as ToolCallContent
            write({
              type: 'tool-input-available',
              toolCallId: toolContent.id,
              toolName: toolContent.name,
              input: toolContent.input,
            })
            continue
          }

          // Handle tool result - emit tool-output-available
          if (agentMessage.type === 'tool_result') {
            const resultContent = agentMessage.content as { callId: string; name: string; output: string; isError: boolean }
            if (resultContent.isError) {
              write({
                type: 'tool-output-error',
                toolCallId: resultContent.callId,
                errorText: resultContent.output,
              })
            } else {
              write({
                type: 'tool-output-available',
                toolCallId: resultContent.callId,
                output: resultContent.output,
              })
            }
            continue
          }
        }

        // Ensure we close any open streams
        if (currentTextPartId) {
          write({ type: 'text-end', id: currentTextPartId })
        }
        if (currentReasoningPartId) {
          write({ type: 'reasoning-end', id: currentReasoningPartId })
        }

        // Cleanup
        activeSessions.delete(session.id)

        // Write final marker
        writeDone()
        controller.close()
      } catch (error) {
        console.error('[Chat Protocol] Error:', error)
        write({
          type: 'error',
          errorText: error instanceof Error ? error.message : 'Unknown error',
        })
        writeDone()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

/**
 * Handle GET chat://api/chat/history - load session history
 */
async function handleHistoryRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  const provider = (url.searchParams.get('provider') || 'claude') as 'claude' | 'codex' | 'bfloat'
  const projectPath = url.searchParams.get('projectPath') || undefined

  console.log('[Chat Protocol] History request:', { sessionId, provider, projectPath })

  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'Missing sessionId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await readSession(sessionId, provider, projectPath)

    if (!session) {
      return new Response(JSON.stringify({ success: false, error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Convert to chat-compatible format
    const messages = sessionToMessages(session)

    // Transform to UIMessage format
    const uiMessages = messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: msg.role === 'user'
        ? [{ type: 'text', text: msg.content }]
        : msg.blocks?.map((block) => {
            if (block.type === 'text') {
              return { type: 'text', text: block.content }
            } else if (block.type === 'tool' && block.action) {
              return {
                type: `tool-${block.action.type}`,
                toolCallId: block.action.id,
                toolName: block.action.type,
                args: { label: block.action.label },
                result: block.action.output,
                state: block.action.status === 'completed' ? 'result' : 'call',
              }
            }
            return { type: 'text', text: '' }
          }) || [{ type: 'text', text: msg.content }],
      createdAt: new Date(msg.timestamp).toISOString(),
    }))

    return new Response(JSON.stringify({
      success: true,
      session: {
        sessionId: session.sessionId,
        provider: session.provider,
        messages: uiMessages,
        cwd: session.cwd,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[Chat Protocol] History error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * Create an error response in SSE format
 */
function createErrorResponse(message: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({ type: 'error', errorText: message })))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}

/**
 * Register the chat protocol handler
 * Must be called after app is ready
 */
export function registerChatProtocol(): void {
  protocol.handle('chat', async (request) => {
    const url = new URL(request.url)

    console.log('[Chat Protocol] Request:', request.method, url.pathname)

    // Route requests
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      return handleChatRequest(request)
    } else if (request.method === 'GET' && url.pathname === '/api/chat/history') {
      return handleHistoryRequest(request)
    } else {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })

  console.log('[Chat Protocol] Registered chat:// protocol handler')
}

/**
 * Cleanup active sessions
 */
export function cleanupChatProtocol(): void {
  for (const [id, session] of activeSessions) {
    console.log('[Chat Protocol] Cancelling session:', id)
    session.cancel()
  }
  activeSessions.clear()
}

/**
 * Get the chat API endpoint URL
 * Note: Uses triple slash so path is correct (hostname is empty)
 */
export function getChatEndpoint(): string {
  return 'chat:///api/chat'
}

/**
 * Get the chat history endpoint URL
 * Note: Uses triple slash so path is correct (hostname is empty)
 */
export function getHistoryEndpoint(): string {
  return 'chat:///api/chat/history'
}
