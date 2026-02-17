/**
 * Agent Module
 *
 * Provides a unified interface for controlling AI coding agents
 * (Claude Agent SDK and Codex).
 */

// Types
export type {
  AgentProviderId,
  AgentTool,
  AgentPermissionMode,
  AgentModel,
  AgentSessionOptions,
  AgentMessageType,
  ToolCallContent,
  ToolResultContent,
  ErrorContent,
  InitContent,
  DoneContent,
  AgentMessage,
  AgentSessionState,
  AgentSession,
  AgentProvider,
  AgentManager,
  AgentSessionEvents,
} from './types'

// Providers
export { ClaudeAgentProvider } from './providers/claude-provider'
export { CodexAgentProvider } from './providers/codex-provider'

// Manager
export { getAgentManager, resetAgentManager, DefaultAgentManager } from './manager'

// Skills Injection
export { ensureSkillsInjected, needsSkillsInjection, injectSkills } from './skills-injector'
