/**
 * Direct API Provider (formerly Bfloat Provider)
 *
 * Implementation of the AgentProvider interface using the Claude Agent SDK
 * with direct API access. This provider allows users to use their own API keys
 * for pay-per-use access to various AI models.
 *
 * Supports multiple AI providers:
 * - Anthropic (Claude models) - requires ANTHROPIC_API_KEY
 * - KIMI (Moonshot AI) - requires MOONSHOT_API_KEY
 * - MiniMax - requires MINIMAX_API_KEY
 * - ZAI (ZhipuAI) - requires ZHIPU_API_KEY
 *
 * This provider is for users who want to use direct API keys instead of
 * OAuth-based subscription access (Claude/Codex providers).
 */

import type {
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
  AgentModel,
} from '../types'
import { ClaudeAgentSession, findClaudeCodeBinaryPath } from './claude-provider'

const LOG_PREFIX = '[API Key Provider]'

// Model provider types
export type DirectApiProvider = 'anthropic' | 'kimi' | 'minimax' | 'zai'

// Provider-specific configurations
interface ProviderConfig {
  model: string
  displayName: string
  baseUrl: string
  apiKeyEnvVar: string
}

// Provider-specific model configurations with direct API endpoints
const PROVIDER_CONFIG: Record<DirectApiProvider, ProviderConfig> = {
  anthropic: {
    model: 'claude-sonnet-4-20250514',
    displayName: 'Claude (Anthropic)',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  kimi: {
    model: 'kimi-k2.5',
    displayName: 'KIMI K2.5',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
  },
  minimax: {
    model: 'MiniMax-M2.1',
    displayName: 'MiniMax M2.1',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
  },
  zai: {
    model: 'glm-4.7',
    displayName: 'ZAI GLM-4.7',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnvVar: 'ZHIPU_API_KEY',
  },
}

/**
 * Detect provider from model ID
 */
function getProviderFromModel(modelId: string): DirectApiProvider {
  if (modelId.startsWith('kimi')) return 'kimi'
  if (modelId.startsWith('MiniMax') || modelId.startsWith('minimax')) return 'minimax'
  if (modelId.startsWith('glm')) return 'zai'
  return 'anthropic'
}

/**
 * Check if an API key is available for a provider
 */
function hasApiKey(provider: DirectApiProvider): boolean {
  const envVar = PROVIDER_CONFIG[provider].apiKeyEnvVar
  return !!process.env[envVar]
}

/**
 * Get the API key for a provider
 */
function getApiKey(provider: DirectApiProvider): string | undefined {
  const envVar = PROVIDER_CONFIG[provider].apiKeyEnvVar
  return process.env[envVar]
}

// Available models - includes all providers
const API_KEY_MODELS: AgentModel[] = [
  // Anthropic models
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'bfloat', // Keep 'bfloat' for backwards compatibility
    description: 'Most capable model for complex tasks (requires ANTHROPIC_API_KEY)',
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'bfloat',
    description: 'Balanced performance and cost (requires ANTHROPIC_API_KEY)',
    contextWindow: 200000,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude Haiku 3.5',
    provider: 'bfloat',
    description: 'Fast and efficient for quick tasks (requires ANTHROPIC_API_KEY)',
    contextWindow: 200000,
  },
  // KIMI models (Moonshot AI)
  {
    id: 'kimi-k2.5',
    name: 'KIMI K2.5',
    provider: 'bfloat',
    description: 'KIMI K2.5 via Moonshot AI (requires MOONSHOT_API_KEY)',
    contextWindow: 128000,
  },
  // MiniMax models
  {
    id: 'MiniMax-M2.1',
    name: 'MiniMax M2.1',
    provider: 'bfloat',
    description: 'MiniMax M2.1 model (requires MINIMAX_API_KEY)',
    contextWindow: 128000,
  },
  // ZAI models (ZhipuAI)
  {
    id: 'glm-4.7',
    name: 'ZAI GLM-4.7',
    provider: 'bfloat',
    description: 'ZhipuAI GLM-4.7 (requires ZHIPU_API_KEY)',
    contextWindow: 128000,
  },
]

/**
 * Direct API Provider Implementation (formerly Bfloat Provider)
 *
 * Uses direct API keys for pay-per-use access to AI models.
 * Users must set the appropriate environment variables for each provider.
 */
export class BfloatAgentProvider implements AgentProvider {
  // Keep 'bfloat' ID for backwards compatibility
  readonly id: 'bfloat' = 'bfloat'
  readonly name = 'API Keys'

  async isAuthenticated(): Promise<boolean> {
    // Check if Claude Code CLI is installed and at least one API key is configured
    const binaryPath = findClaudeCodeBinaryPath()
    const isInstalled = !!binaryPath

    // Check if at least one API key is available
    const hasAnyApiKey = Object.keys(PROVIDER_CONFIG).some((provider) =>
      hasApiKey(provider as DirectApiProvider)
    )

    console.log(`${LOG_PREFIX} Auth check: CLI installed = ${isInstalled}, has API key = ${hasAnyApiKey}`)

    // Require both CLI and at least one API key
    return isInstalled && hasAnyApiKey
  }

  async createSession(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = `api-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Detect provider from model ID
    const modelProvider = getProviderFromModel(options.model || 'claude-sonnet-4-20250514')
    const config = PROVIDER_CONFIG[modelProvider]

    // Check if API key is available for this provider
    const apiKey = getApiKey(modelProvider)
    if (!apiKey) {
      throw new Error(
        `API key not configured for ${config.displayName}. ` +
        `Please set the ${config.apiKeyEnvVar} environment variable.`
      )
    }

    console.log(`${LOG_PREFIX} Creating session with provider: ${modelProvider}, model: ${config.model}`)

    // Create a Claude session with direct API configuration
    return new ClaudeAgentSession(sessionId, options, {
      providerId: 'bfloat',
      logPrefix: LOG_PREFIX,
      // Don't use OAuth token - use API key directly
      useOAuthToken: false,
      // Override env to use direct API with user's API key
      envOverrides: {
        // Direct API endpoint (no proxy)
        ANTHROPIC_BASE_URL: config.baseUrl,
        // User's API key
        ANTHROPIC_API_KEY: apiKey,
        // Don't use OAuth token
        CLAUDE_CODE_OAUTH_TOKEN: undefined,
        // Model settings - override all model tiers to use selected model
        ANTHROPIC_MODEL: config.model,
        ANTHROPIC_SMALL_FAST_MODEL: config.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: config.model,
        // Disable non-essential traffic (telemetry, etc.)
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // Longer timeout for non-Anthropic providers
        API_TIMEOUT_MS: modelProvider !== 'anthropic' ? '300000' : undefined,
      },
    })
  }

  async getAvailableModels(): Promise<AgentModel[]> {
    // Filter to only return models for which the user has an API key
    return API_KEY_MODELS.filter((model) => {
      const provider = getProviderFromModel(model.id)
      return hasApiKey(provider)
    })
  }

  async resumeSession(
    sessionId: string,
    options?: Partial<AgentSessionOptions>
  ): Promise<AgentSession> {
    const sessionOptions: AgentSessionOptions = {
      cwd: options?.cwd || process.cwd(),
      resumeSessionId: sessionId,
      ...options,
    }

    // Detect provider from model ID
    const modelProvider = getProviderFromModel(options?.model || 'claude-sonnet-4-20250514')
    const config = PROVIDER_CONFIG[modelProvider]

    // Check if API key is available
    const apiKey = getApiKey(modelProvider)
    if (!apiKey) {
      throw new Error(
        `API key not configured for ${config.displayName}. ` +
        `Please set the ${config.apiKeyEnvVar} environment variable.`
      )
    }

    console.log(`${LOG_PREFIX} Resuming session with provider: ${modelProvider}, model: ${config.model}`)

    return new ClaudeAgentSession(sessionId, sessionOptions, {
      providerId: 'bfloat',
      logPrefix: LOG_PREFIX,
      useOAuthToken: false,
      envOverrides: {
        // Direct API endpoint
        ANTHROPIC_BASE_URL: config.baseUrl,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_CODE_OAUTH_TOKEN: undefined,
        // Model settings
        ANTHROPIC_MODEL: config.model,
        ANTHROPIC_SMALL_FAST_MODEL: config.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: config.model,
        // Disable non-essential traffic
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // Longer timeout for non-Anthropic providers
        API_TIMEOUT_MS: modelProvider !== 'anthropic' ? '300000' : undefined,
      },
    })
  }
}

// Export helper functions for external use
export { getProviderFromModel, PROVIDER_CONFIG }
