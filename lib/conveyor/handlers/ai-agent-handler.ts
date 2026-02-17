/**
 * AI Agent Handler
 *
 * IPC handlers for the common AI agent interface.
 * Provides a unified way to interact with Claude Agent SDK and Codex.
 */

import { handle } from '@/lib/main/shared'
import { BrowserWindow } from 'electron'
import { getAgentManager } from '@/lib/agents'
import type { AgentProviderId, AgentSessionOptions } from '@/lib/agents/types'
import { readSession, listSessions, sessionToMessages } from '@/lib/agents/session-reader'
import { getBackgroundRegistry } from '@/lib/agents/background-registry'
import { getMcpRegistry } from '@/lib/mcp'

// Track active streams for cleanup
const activeStreams: Map<string, { cancel: () => void }> = new Map()

export function registerAIAgentHandlers() {
  // ============================================================================
  // Provider Management
  // ============================================================================

  handle('ai-agent:get-providers', async () => {
    const manager = getAgentManager()
    const providers = manager.getProviders()

    return Promise.all(
      providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        isAuthenticated: await provider.isAuthenticated(),
      }))
    )
  })

  handle('ai-agent:get-authenticated-providers', async () => {
    const manager = getAgentManager()
    const providers = await manager.getAuthenticatedProviders()

    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      isAuthenticated: true,
    }))
  })

  handle('ai-agent:is-authenticated', async (providerId: AgentProviderId) => {
    const manager = getAgentManager()
    const provider = manager.getProvider(providerId)

    if (!provider) {
      return false
    }

    return provider.isAuthenticated()
  })

  handle('ai-agent:get-models', async (providerId: AgentProviderId) => {
    const manager = getAgentManager()
    const provider = manager.getProvider(providerId)

    if (!provider) {
      return []
    }

    return provider.getAvailableModels()
  })

  handle('ai-agent:set-default-provider', async (providerId: AgentProviderId) => {
    try {
      const manager = getAgentManager()
      manager.setDefaultProvider(providerId)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  handle('ai-agent:get-default-provider', async () => {
    const manager = getAgentManager()
    return manager.getDefaultProviderId()
  })

  // ============================================================================
  // Session Management
  // ============================================================================

  handle(
    'ai-agent:create-session',
    async (options: AgentSessionOptions & { provider?: AgentProviderId }) => {
      try {
        console.log('[AI Agent Handler] ========================================')
        console.log('[AI Agent Handler] CREATE SESSION REQUEST')
        console.log('[AI Agent Handler] Received options:', JSON.stringify({ ...options, authToken: options.authToken ? '[REDACTED]' : undefined }, null, 2))
        console.log('[AI Agent Handler] Provider:', options.provider || 'default')
        console.log('[AI Agent Handler] Model:', options.model || 'default')
        console.log('[AI Agent Handler] CWD:', options.cwd)
        console.log('[AI Agent Handler] Permission Mode:', options.permissionMode || 'default')
        console.log('[AI Agent Handler] env:', options.env)
        console.log('[AI Agent Handler] ========================================')

        // Build session options with MCP servers via the registry
        const sessionOptions = { ...options }

        const registry = getMcpRegistry()
        // Default to 'claude' - uses existing subscription via OAuth
        const providerId = options.provider || 'claude'
        const mcpCtx = { cwd: options.cwd, env: options.env, authToken: options.authToken }

        sessionOptions.mcpServers = {
          ...sessionOptions.mcpServers,
          ...(await registry.getServersForProvider(providerId, mcpCtx)) as any,
        }

        // Remove authToken from options passed to session (not needed after MCP setup)
        delete sessionOptions.authToken

        console.log('[AI Agent Handler] MCP Servers configured:', Object.keys(sessionOptions.mcpServers || {}))

        const manager = getAgentManager()
        const session = await manager.createSession(sessionOptions)

        console.log('[AI Agent Handler] Session created:', session.id, 'with provider:', session.provider)

        // Register with background registry if projectId is provided
        if (options.projectId) {
          const registry = getBackgroundRegistry()
          registry.register(session.id, options.projectId, session.provider, options.cwd)
        }

        return {
          success: true,
          sessionId: session.id,
        }
      } catch (error) {
        console.error('[AI Agent Handler] Failed to create session:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  handle('ai-agent:prompt', async (sessionId: string, message: string) => {
    try {
      const manager = getAgentManager()
      const session = manager.getSession(sessionId)

      if (!session) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`,
        }
      }

      // Create a unique channel for this stream
      const streamChannel = `ai-agent:stream:${sessionId}:${Date.now()}`

      // Start the streaming in the background - use setImmediate to defer until after
      // the IPC response is sent so the renderer has time to set up the listener
      setImmediate(() => {
        // Track stream channel in background registry
        const registry = getBackgroundRegistry()
        registry.setStreamChannel(sessionId, streamChannel)

        const streamPromise = (async () => {
          let cancelled = false

          activeStreams.set(sessionId, {
            cancel: () => {
              cancelled = true
            },
          })

          try {
            for await (const agentMessage of session.prompt(message)) {
              if (cancelled) break

              // Log message type for debugging
              console.log('[AI Agent Handler] Sending message:', agentMessage.type)
              if (agentMessage.type === 'init') {
                console.log('[AI Agent Handler] Init message content:', JSON.stringify(agentMessage.content))
                const initSessionId = (agentMessage.content as { sessionId?: string })?.sessionId
                if (initSessionId) {
                  registry.registerAlias(sessionId, initSessionId)
                }
              }

              // Buffer message in background registry for reconnection
              registry.pushMessage(sessionId, agentMessage)

              // Send message to all renderer windows
              const windows = BrowserWindow.getAllWindows()
              console.log('[AI Agent Handler] Sending to', windows.length, 'windows via channel:', streamChannel)
              for (const window of windows) {
                window.webContents.send(streamChannel, agentMessage)
              }
            }
          } finally {
              activeStreams.delete(sessionId)

              // Mark session as completed in background registry
              registry.markCompleted(sessionId)

              // Send end signal
              const windows = BrowserWindow.getAllWindows()
              for (const window of windows) {
                window.webContents.send(streamChannel, { type: 'stream_end' })
              }
            }
          })()

          // Don't await the promise, let it run in the background
          streamPromise.catch((error) => {
            console.error('[AI Agent] Stream error:', error)

            // Mark session as errored in background registry
            registry.markError(sessionId)

            const windows = BrowserWindow.getAllWindows()
            for (const window of windows) {
              window.webContents.send(streamChannel, {
                type: 'error',
                content: {
                  code: 'stream_error',
                  message: error instanceof Error ? error.message : 'Unknown error',
                  recoverable: false,
                },
              })
            }
          })
        })

      return {
        success: true,
        streamChannel,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  handle('ai-agent:interrupt', async (sessionId: string) => {
    try {
      const manager = getAgentManager()
      const session = manager.getSession(sessionId)

      if (!session) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`,
        }
      }

      // Cancel the active stream if any
      const stream = activeStreams.get(sessionId)
      if (stream) {
        stream.cancel()
      }

      await session.interrupt()

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  handle('ai-agent:get-session-state', async (sessionId: string) => {
    const manager = getAgentManager()
    const session = manager.getSession(sessionId)

    if (!session) {
      return null
    }

    return session.getState()
  })

  handle('ai-agent:get-active-sessions', async () => {
    const manager = getAgentManager()
    const sessions = manager.getActiveSessions()

    return sessions.map((session) => ({
      id: session.id,
      provider: session.provider,
      state: session.getState(),
    }))
  })

  handle('ai-agent:terminate-session', async (sessionId: string) => {
    try {
      const manager = getAgentManager()

      // Cancel the active stream if any
      const stream = activeStreams.get(sessionId)
      if (stream) {
        stream.cancel()
      }

      await manager.terminateSession(sessionId)

      // Unregister from background registry
      const registry = getBackgroundRegistry()
      registry.unregister(sessionId)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  // ============================================================================
  // Background Session Management
  // ============================================================================

  handle('ai-agent:get-background-session', async (projectId: string) => {
    const registry = getBackgroundRegistry()
    const bgSession = registry.getByProject(projectId)

    if (!bgSession) {
      return { success: true, session: undefined }
    }

    return {
      success: true,
      session: {
        sessionId: bgSession.sessionId,
        projectId: bgSession.projectId,
        provider: bgSession.provider,
        cwd: bgSession.cwd,
        streamChannel: bgSession.streamChannel,
        status: bgSession.status,
        startedAt: bgSession.startedAt,
      },
    }
  })

  handle('ai-agent:list-background-sessions', async () => {
    const registry = getBackgroundRegistry()
    return registry.getAllActive().map((s) => ({
      sessionId: s.sessionId,
      projectId: s.projectId,
      provider: s.provider,
      status: s.status,
      startedAt: s.startedAt,
    }))
  })

  handle('ai-agent:get-background-messages', async (sessionId: string, afterSeq?: number) => {
    const registry = getBackgroundRegistry()
    const messages = registry.getMessagesSince(sessionId, afterSeq || 0)
    console.log('[AI Agent Handler] get-background-messages', {
      sessionId,
      afterSeq: afterSeq || 0,
      count: messages.length,
    })
    return {
      success: true,
      messages,
    }
  })

  handle('ai-agent:unregister-background-session', async (sessionId: string) => {
    const registry = getBackgroundRegistry()
    registry.unregister(sessionId)
    return { success: true }
  })

  handle('ai-agent:get-background-session-by-id', async (sessionId: string) => {
    const registry = getBackgroundRegistry()
    const bgSession = registry.getBySessionId(sessionId)

    if (!bgSession) {
      return { success: true, session: undefined }
    }

    return {
      success: true,
      session: {
        sessionId: bgSession.sessionId,
        projectId: bgSession.projectId,
        provider: bgSession.provider,
        cwd: bgSession.cwd,
        streamChannel: bgSession.streamChannel,
        status: bgSession.status,
        startedAt: bgSession.startedAt,
      },
    }
  })

  // ============================================================================
  // Session Reading (from local CLI storage)
  // ============================================================================

  handle(
    'ai-agent:read-session',
    async (
      sessionId: string,
      provider: 'claude' | 'codex' | 'bfloat',
      projectPath?: string
    ) => {
      try {
        console.log('[AI Agent Handler] Reading session:', { sessionId, provider, projectPath })
        const session = await readSession(sessionId, provider, projectPath)

        if (!session) {
          return {
            success: false,
            error: 'Session not found',
          }
        }

        // Convert to chat-compatible format
        const messages = sessionToMessages(session)

        // Debug: Log detailed message info before IPC serialization
        const textMsgs = messages.filter(m => m.role === 'assistant' && m.blocks?.some(b => b.type === 'text'))
        console.log('[AI Agent Handler] Messages before IPC return:', {
          totalMessages: messages.length,
          assistantMessages: messages.filter(m => m.role === 'assistant').length,
          messagesWithTextBlocks: textMsgs.length,
        })

        if (textMsgs.length > 0) {
          const firstText = textMsgs[0]
          const textBlock = firstText.blocks?.find(b => b.type === 'text') as { type: 'text'; content: string } | undefined
          console.log('[AI Agent Handler] First text message details:', {
            id: firstText.id,
            contentLength: firstText.content?.length || 0,
            blocksCount: firstText.blocks?.length || 0,
            firstBlockType: firstText.blocks?.[0]?.type,
            textBlockContent: textBlock?.content?.substring(0, 100) + '...',
          })
        } else {
          console.warn('[AI Agent Handler] WARNING: No text messages to return!')
        }

        return {
          success: true,
          session: {
            sessionId: session.sessionId,
            provider: session.provider,
            messages,
            cwd: session.cwd,
            createdAt: session.createdAt,
            lastModified: session.lastModified,
          },
        }
      } catch (error) {
        console.error('[AI Agent Handler] Failed to read session:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  handle(
    'ai-agent:list-sessions',
    async (provider: 'claude' | 'codex' | 'bfloat', projectPath?: string) => {
      try {
        const sessions = await listSessions(provider, projectPath)
        return {
          success: true,
          sessions,
        }
      } catch (error) {
        console.error('[AI Agent Handler] Failed to list sessions:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  // ============================================================================
  // Project Name Generation
  // ============================================================================

  /**
   * Generate a project name from a description using AI
   * This is a lightweight one-shot call that doesn't create a full session
   */
  handle(
    'ai-agent:generate-project-name',
    async (description: string, provider: 'claude' | 'codex' | 'bfloat' = 'claude') => {
      try {
        console.log('[AI Agent Handler] Generating project name for:', description.substring(0, 100))

        const manager = getAgentManager()
        const agentProvider = manager.getProvider(provider === 'bfloat' ? 'claude' : provider)

        if (!agentProvider) {
          console.log('[AI Agent Handler] Provider not available, using fallback')
          return {
            success: true,
            name: generateFallbackName(description),
            source: 'fallback',
          }
        }

        // Check if provider is authenticated
        const isAuth = await agentProvider.isAuthenticated()
        if (!isAuth) {
          console.log('[AI Agent Handler] Provider not authenticated, using fallback')
          return {
            success: true,
            name: generateFallbackName(description),
            source: 'fallback',
          }
        }

        // Create a minimal session for name generation
        const session = await agentProvider.createSession({
          cwd: process.cwd(),
          permissionMode: 'default',
          systemPrompt: `You are a project naming expert. Generate a short, memorable project name (2-4 words, no spaces, use kebab-case like "my-app" or "photo-editor").
The name should be:
- Descriptive but concise
- Easy to type and remember
- Related to the project's purpose
- Professional and suitable for a code repository

Respond with ONLY the project name, nothing else. No explanation, no quotes, just the name.`,
        })

        // Send the description as a prompt
        const promptText = `Generate a project name for: ${description.substring(0, 500)}`

        // Collect the response
        let generatedName = ''

        // Create a promise that resolves when we get the name
        const namePromise = new Promise<string>((resolve, reject) => {
          let timeoutId: NodeJS.Timeout | null = null

          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId)
            session.off('message', messageHandler)
          }

          const messageHandler = (message: import('@/lib/agents/types').AgentMessage) => {
            if (message.type === 'text' && message.content) {
              generatedName += message.content
            }
            if (message.type === 'done' || message.type === 'error') {
              cleanup()
              if (message.type === 'error') {
                reject(new Error((message.content as import('@/lib/agents/types').ErrorContent).error))
              } else {
                // Clean up the name - extract just the name part
                const cleanName = generatedName
                  .trim()
                  .split('\n')[0] // Take first line only
                  .replace(/['"]/g, '') // Remove quotes
                  .replace(/\s+/g, '-') // Replace spaces with dashes
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '') // Remove invalid chars
                  .substring(0, 50) // Limit length

                resolve(cleanName || generateFallbackName(description))
              }
            }
          }

          session.on('message', messageHandler)

          // Timeout after 15 seconds
          timeoutId = setTimeout(() => {
            cleanup()
            session.interrupt().catch(() => {})
            resolve(generateFallbackName(description))
          }, 15000)
        })

        // Send the prompt
        await session.prompt(promptText)

        // Wait for the response
        const name = await namePromise

        // Terminate the session
        await session.terminate().catch(() => {})

        console.log('[AI Agent Handler] Generated project name:', name)

        return {
          success: true,
          name,
          source: 'ai',
        }
      } catch (error) {
        console.error('[AI Agent Handler] Failed to generate project name:', error)
        return {
          success: true,
          name: generateFallbackName(description),
          source: 'fallback',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )
}

/**
 * Generate a fallback project name from description (simple extraction)
 */
function generateFallbackName(description: string): string {
  // Take first few words and convert to kebab-case
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this', 'build', 'create', 'make', 'want'].includes(w))
    .slice(0, 3)

  if (words.length === 0) {
    return `project-${Date.now().toString(36)}`
  }

  return words.join('-').substring(0, 30)
}
