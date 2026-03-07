/**
 * AI Agent Schema
 *
 * Zod schemas for the common AI agent interface IPC channels.
 * Used for controlling Claude Agent SDK and Codex.
 */

import { z } from 'zod'

// Provider ID schema
export const providerIdSchema = z.enum(['claude', 'codex'])

// Permission mode schema
export const permissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'delegate', 'dontAsk'])

// Tool schema
export const agentToolSchema = z.enum([
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
  'TodoRead',
  'AskUser',
])

// Agent definition schema (for team orchestration)
export const agentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.enum(['sonnet', 'opus', 'haiku', 'inherit']).optional(),
  mcpServers: z.array(z.union([z.string(), z.record(z.unknown())])).optional(),
})

// Model schema
export const agentModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: providerIdSchema,
  description: z.string().optional(),
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),
})

// Session options schema
export const sessionOptionsSchema = z.object({
  cwd: z.string(),
  model: z.string().optional(),
  permissionMode: permissionModeSchema.optional(),
  allowedTools: z.array(agentToolSchema).optional(),
  disallowedTools: z.array(z.string()).optional(), // Tool names to disable (e.g., 'AskUserQuestion')
  systemPrompt: z.string().optional(),
  resumeSessionId: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  provider: providerIdSchema.optional(),
  env: z.record(z.string(), z.string()).optional(), // Environment variables
  projectId: z.string().optional(), // Project ID for background session tracking
  maxTurns: z.number().optional(), // Maximum agentic turns (prevents infinite loops)
  authToken: z.string().optional(), // User auth token for fetching integration credentials (e.g., Stripe)
  agents: z.record(z.string(), agentDefinitionSchema).optional(), // Agent/subagent definitions for team orchestration
})

// Message type schema
export const messageTypeSchema = z.enum([
  'init',
  'text',
  'reasoning',
  'tool_call',
  'tool_result',
  'queue_user_prompt',
  'error',
  'done',
])

// Tool call content schema
export const toolCallContentSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
  status: z.enum(['pending', 'running', 'completed', 'error']),
})

// Tool result content schema
export const toolResultContentSchema = z.object({
  callId: z.string(),
  name: z.string(),
  output: z.string(),
  isError: z.boolean(),
})

// Error content schema
export const errorContentSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
})

// Queue-user-prompt content schema
export const queueUserPromptContentSchema = z.object({
  prompt: z.string(),
  reason: z.string().optional(),
  source: z.string().optional(),
})

// Init content schema
export const initContentSchema = z.object({
  sessionId: z.string(),
  availableTools: z.array(z.string()),
  model: z.string(),
})

// Done content schema
export const doneContentSchema = z.object({
  sessionId: z.string(),
  result: z.string().optional(),
  interrupted: z.boolean(),
})

// Message metadata schema
export const messageMetadataSchema = z.object({
  tokens: z.number().optional(),
  cost: z.number().optional(),
  timestamp: z.number().optional(),
  seq: z.number().optional(),
})

// Agent message schema
export const agentMessageSchema = z.object({
  type: messageTypeSchema,
  content: z.union([
    z.string(),
    toolCallContentSchema,
    toolResultContentSchema,
    queueUserPromptContentSchema,
    errorContentSchema,
    initContentSchema,
    doneContentSchema,
  ]),
  metadata: messageMetadataSchema.optional(),
})

// Session state schema
export const sessionStateSchema = z.object({
  id: z.string(),
  status: z.enum(['idle', 'running', 'completed', 'error', 'interrupted']),
  messageCount: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  startTime: z.number(),
  endTime: z.number().optional(),
})

// Provider info schema
export const providerInfoSchema = z.object({
  id: providerIdSchema,
  name: z.string(),
  isAuthenticated: z.boolean(),
})

// AI Agent API Schema
export const aiAgentApiSchema = {
  // Get all providers
  'ai-agent:get-providers': {
    args: z.tuple([]),
    return: z.array(providerInfoSchema),
  },

  // Get authenticated providers
  'ai-agent:get-authenticated-providers': {
    args: z.tuple([]),
    return: z.array(providerInfoSchema),
  },

  // Check if a provider is authenticated
  'ai-agent:is-authenticated': {
    args: z.tuple([providerIdSchema]),
    return: z.boolean(),
  },

  // Get available models for a provider
  'ai-agent:get-models': {
    args: z.tuple([providerIdSchema]),
    return: z.array(agentModelSchema),
  },

  // Create a new session
  'ai-agent:create-session': {
    args: z.tuple([sessionOptionsSchema]),
    return: z.object({
      success: z.boolean(),
      sessionId: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Send a prompt to a session (returns stream channel name)
  'ai-agent:prompt': {
    args: z.tuple([z.string(), z.string()]), // sessionId, message
    return: z.object({
      success: z.boolean(),
      streamChannel: z.string().optional(), // channel name for streaming events
      error: z.string().optional(),
    }),
  },

  // Interrupt a session
  'ai-agent:interrupt': {
    args: z.tuple([z.string()]), // sessionId
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Get session state
  'ai-agent:get-session-state': {
    args: z.tuple([z.string()]), // sessionId
    return: sessionStateSchema.nullable(),
  },

  // Get all active sessions
  'ai-agent:get-active-sessions': {
    args: z.tuple([]),
    return: z.array(
      z.object({
        id: z.string(),
        provider: providerIdSchema,
        state: sessionStateSchema,
      })
    ),
  },

  // Terminate a session
  'ai-agent:terminate-session': {
    args: z.tuple([z.string()]), // sessionId
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Terminate all sessions (used when leaving a project)
  'ai-agent:terminate-all-sessions': {
    args: z.tuple([]),
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Set default provider
  'ai-agent:set-default-provider': {
    args: z.tuple([providerIdSchema]),
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Get default provider
  'ai-agent:get-default-provider': {
    args: z.tuple([]),
    return: providerIdSchema,
  },

  // ==========================================================================
  // Session Reading (from local CLI storage)
  // ==========================================================================

  // Read a session from local CLI storage (Claude/Codex)
  'ai-agent:read-session': {
    args: z.tuple([
      z.string(), // sessionId
      providerIdSchema, // provider
      z.string().optional(), // projectPath
    ]),
    return: z.object({
      success: z.boolean(),
      session: z
        .object({
          sessionId: z.string(),
          provider: providerIdSchema,
          messages: z.array(
            z.object({
              id: z.string(),
              role: z.enum(['user', 'assistant']),
              content: z.string(),
              blocks: z.array(z.unknown()).optional(),
              timestamp: z.number(),
            })
          ),
          cwd: z.string().optional(),
          createdAt: z.number().optional(),
          lastModified: z.number().optional(),
        })
        .optional(),
      error: z.string().optional(),
    }),
  },

  // ==========================================================================
  // Background Session Management
  // ==========================================================================

  // Get background session for a project
  'ai-agent:get-background-session': {
    args: z.tuple([z.string()]), // projectId
    return: z.object({
      success: z.boolean(),
      session: z
        .object({
          sessionId: z.string(),
          projectId: z.string(),
          provider: providerIdSchema,
          cwd: z.string(),
          streamChannel: z.string().nullable(),
          status: z.enum(['running', 'completed', 'error']),
          startedAt: z.number(),
        })
        .optional(),
    }),
  },

  // List all background sessions (for home page indicators)
  'ai-agent:list-background-sessions': {
    args: z.tuple([]),
    return: z.array(
      z.object({
        sessionId: z.string(),
        projectId: z.string(),
        provider: providerIdSchema,
        status: z.enum(['running', 'completed', 'error']),
        startedAt: z.number(),
      })
    ),
  },

  // Unregister a background session (cleanup after reconnect)
  'ai-agent:unregister-background-session': {
    args: z.tuple([z.string()]), // sessionId
    return: z.object({
      success: z.boolean(),
    }),
  },

  // Get background session by session ID (for tab reconnection)
  'ai-agent:get-background-session-by-id': {
    args: z.tuple([z.string()]), // sessionId
    return: z.object({
      success: z.boolean(),
      session: z
        .object({
          sessionId: z.string(),
          projectId: z.string(),
          provider: providerIdSchema,
          cwd: z.string(),
          streamChannel: z.string().nullable(),
          status: z.enum(['running', 'completed', 'error']),
          startedAt: z.number(),
        })
        .optional(),
    }),
  },

  // Get buffered background messages since a sequence number (for replay on reconnect)
  'ai-agent:get-background-messages': {
    args: z.tuple([z.string(), z.number().optional()]), // sessionId, afterSeq
    return: z.object({
      success: z.boolean(),
      messages: z.array(agentMessageSchema),
    }),
  },

  // List sessions from local CLI storage
  'ai-agent:list-sessions': {
    args: z.tuple([
      providerIdSchema, // provider
      z.string().optional(), // projectPath
    ]),
    return: z.object({
      success: z.boolean(),
      sessions: z
        .array(
          z.object({
            sessionId: z.string(),
            lastModified: z.number(),
          })
        )
        .optional(),
      error: z.string().optional(),
    }),
  },
}

// Session message types (used by session reader UI)
export interface SessionMessageBlock {
  type: 'text' | 'tool'
  content?: string
  action?: {
    id: string
    type: string
    label: string
    status: 'running' | 'completed' | 'error'
    output?: string
    timestamp: number
  }
}

export interface SessionMessageData {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks?: SessionMessageBlock[]
  timestamp: number
}

// Export types
export type ProviderId = z.infer<typeof providerIdSchema>
export type PermissionMode = z.infer<typeof permissionModeSchema>
export type AgentTool = z.infer<typeof agentToolSchema>
export type AgentModel = z.infer<typeof agentModelSchema>
export type SessionOptions = z.infer<typeof sessionOptionsSchema>
export type MessageType = z.infer<typeof messageTypeSchema>
export type ToolCallContent = z.infer<typeof toolCallContentSchema>
export type ToolResultContent = z.infer<typeof toolResultContentSchema>
export type ErrorContent = z.infer<typeof errorContentSchema>
export type InitContent = z.infer<typeof initContentSchema>
export type DoneContent = z.infer<typeof doneContentSchema>
export type AgentMessage = z.infer<typeof agentMessageSchema>
export type SessionState = z.infer<typeof sessionStateSchema>
export type ProviderInfo = z.infer<typeof providerInfoSchema>
