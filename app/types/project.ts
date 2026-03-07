// Project types for the IDE

import type { Deployment } from '@/app/stores/deploy'
import type { LaunchConfig } from '@/app/types/launch'

export interface ProjectFile {
  type: 'file'
  content: string
  isBinary?: boolean
}

export interface ProjectFolder {
  type: 'folder'
  children: Record<string, Dirent>
}

export type Dirent = ProjectFile | ProjectFolder

export type FileMap = Record<string, Dirent | null>

// App type for determining template and runtime
// 'web' for web apps, 'mobile' for Expo/React Native
// Legacy types ('expo', 'nextjs', 'vite', 'node') from database are mapped in Workbench.tsx
export type AppType = 'web' | 'mobile' | 'expo' | 'nextjs' | 'vite' | 'node'

export interface Project {
  id: string
  title: string
  description?: string
  files: FileMap | null
  // DEPRECATED: Messages are now stored locally via Claude/Codex sessions
  // This field is kept for backwards compatibility but should not be used
  messages?: ChatMessage[]
  isLocal: boolean
  createdAt: string
  updatedAt: string
  // App type: 'mobile' for mobile apps, 'web' for web apps
  appType?: AppType
  // Whether the AI is currently updating the project (generating files)
  updateInProgress?: boolean
  // Project settings fields
  slug?: string | null
  iosBundleId?: string | null
  iosAppId?: string | null
  androidPackageName?: string | null
  iosAppIconUrl?: string | null
  androidAppIconUrl?: string | null
  isPublic: boolean
  // Convex integration fields
  convexDeployment?: string
  convexUrl?: string
  convexProjectId?: number
  convexDeploymentKey?: string
  // Firebase integration fields
  firebaseProjectId?: string
  firebaseConfig?: {
    apiKey: string
    authDomain: string
    projectId: string
    storageBucket: string
    messagingSenderId: string
    appId: string
  }
  // Agent sessions for this project (local-first storage)
  sessions?: AgentSession[]
  // Deployment history (persisted to projects.json via sidecar)
  deployments?: Deployment[]
  // Cached launch config (file is source of truth, this is a cache)
  launchConfig?: LaunchConfig | null
  // Latest agent session (loaded from backend) - DEPRECATED, use sessions array
  latestAgentSession?: AgentSession | null
  // Import tracking (for GitHub imports)
  importStatus?: 'importing' | 'complete' | 'failed' | null
  importError?: string | null
  // Git remote URL for syncing (GitHub URL for imports, Gitea URL for regular projects)
  sourceUrl?: string | null
  // Preferred remote branch for syncing (defaults to "main" when not set)
  sourceBranch?: string | null
  // Shared custom instructions appended to AGENTS.md and CLAUDE.md
  agentInstructions?: string
  // Team sharing
  teamId?: string | null
  teamName?: string | null
  // Enabled integrations (from backend Project.integrations JSON field)
  integrations?: {
    stripe?: boolean
    convex?: boolean
    revenuecat?: boolean
  } | null
  // RevenueCat project ID (set when RevenueCat is connected)
  revenuecatProjectId?: string
  // Stripe connected account ID (set when Stripe is connected)
  stripeConnectedAccountId?: string
}

// Agent session for Claude/Codex CLI persistence
export interface AgentSession {
  id: string
  projectId: string
  sessionId: string  // The CLI session ID
  provider: 'claude' | 'codex'
  model?: string  // The model ID used for this session (e.g., 'claude-sonnet-4-20250514')
  name?: string | null
  createdAt: string
  lastUsedAt: string
  totalTokens?: number
  totalCostUsd?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  parts?: MessagePart[]
  createdAt?: string
  // Session/thread ID for resuming conversations
  sessionId?: string
  // Provider that generated this message (for display purposes)
  provider?: 'claude' | 'codex' | string
}

// ============================================================================
// MessagePart Type - Agent-Agnostic Common Format
// ============================================================================
// This is the unified format for storing and displaying messages from any agent.
// Both Claude Agent SDK and Codex SDK messages are translated to this format.
//
// Claude Agent SDK content blocks map to:
//   - text -> { type: 'text', text: '...' }
//   - tool_use -> { type: 'tool-{toolName}', toolCallId, toolName, state: 'running', args }
//   - tool_result -> { type: 'tool-{toolName}', toolCallId, toolName, state: 'result', result }
//   - thinking -> { type: 'thinking', text: '...' }
//   - image -> { type: 'image', url or data }
//
// Codex SDK ThreadItem variants map to:
//   - AgentMessageItem -> { type: 'text', text: '...' }
//   - ReasoningItem -> { type: 'reasoning', text: '...' }
//   - CommandExecutionItem -> { type: 'tool-Bash', ... }
//   - WebSearchItem -> { type: 'tool-WebSearch', ... }
// ============================================================================

export type MessagePartType =
  // Text content
  | 'text'
  // Extended thinking/reasoning (Claude thinking, Codex reasoning)
  | 'thinking'
  | 'reasoning'
  // Media content
  | 'image'
  | 'document'
  // Tool calls (dynamically typed as 'tool-{toolName}')
  | `tool-${string}`
  // Metadata
  | 'data-metadata'
  | 'step-start'
  // Context injections
  | 'tool-context'
  // Search results
  | 'search-result'

export interface MessagePart {
  // Part type - see MessagePartType for all supported types
  type: string

  // === Text Content ===
  text?: string

  // === Code Content (for code blocks in text) ===
  code?: string
  language?: string
  filename?: string

  // === Media Content ===
  url?: string
  // Base64 data for images/documents
  data?: string
  // MIME type for media
  mediaType?: string

  // === Tool Call Fields ===
  // Unique ID for this tool invocation
  toolCallId?: string
  // Name of the tool being called
  toolName?: string
  // State of the tool call
  state?: 'running' | 'result' | 'error'
  // Tool input arguments
  args?: Record<string, unknown>
  // Tool result (can be any type)
  result?: unknown

  // === Thinking/Reasoning Fields ===
  // Thinking content (for extended thinking blocks)
  thinking?: string
  // Signature for thinking verification (Claude)
  signature?: string

  // === Search Result Fields ===
  title?: string
  source?: string
  snippet?: string

  // === Metadata Fields ===
  // Timestamp for this part
  timestamp?: number
  // Duration in ms (for tool calls)
  duration?: number
  // Exit code (for command execution)
  exitCode?: number
  // Whether this was an error
  isError?: boolean

  // === Extensibility ===
  // Allow additional fields for future compatibility
  [key: string]: unknown
}

export interface EditorDocument {
  filePath: string
  value: string
  isBinary: boolean
  language?: string
}
