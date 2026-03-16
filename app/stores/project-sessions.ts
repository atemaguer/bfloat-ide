import { createStore, type StoreApi } from 'zustand/vanilla'

import type { ChatMessage } from '@/app/types/project'
import type { ProviderId } from '@/lib/conveyor/schemas/ai-agent-schema'

export type ProjectSessionStatus = 'idle' | 'hydrating' | 'running' | 'completed' | 'error'

export interface ProjectSessionViewState {
  messages: ChatMessage[]
  status: ProjectSessionStatus
  isAttachedToTransport: boolean
  isHydrated: boolean
  lastHydratedAt: number | null
  lastRuntimeSeenAt: number | null
  needsRefresh: boolean
  isLoadingSession: boolean
  isResumingSession: boolean
  runtimeSessionId: string | null
  providerSessionId: string | null
  provider: ProviderId
  model: string | null
  transcriptLastSeq: number
  runtimeLastSeq: number
  error: string | null
}

const DRAFT_SESSION_KEY = '__draft__'

function getDefaultModelForProvider(provider: ProviderId): string {
  return provider === 'codex' ? 'gpt-5.3-codex' : 'claude-sonnet-4-20250514'
}

function createSessionViewState(provider: ProviderId, messages: ChatMessage[] = []): ProjectSessionViewState {
  return {
    messages,
    status: 'idle',
    isAttachedToTransport: false,
    isHydrated: messages.length > 0,
    lastHydratedAt: messages.length > 0 ? Date.now() : null,
    lastRuntimeSeenAt: null,
    needsRefresh: false,
    isLoadingSession: false,
    isResumingSession: false,
    runtimeSessionId: null,
    providerSessionId: null,
    provider,
    model: getDefaultModelForProvider(provider),
    transcriptLastSeq: 0,
    runtimeLastSeq: 0,
    error: null,
  }
}

interface ProjectSessionBundle {
  selectedSessionId: StoreApi<string | null>
  sessionStates: StoreApi<Record<string, ProjectSessionViewState>>
}

class ProjectSessionsStore {
  private bundles = new Map<string, ProjectSessionBundle>()

  private getOrCreateBundle(projectId: string, defaultProvider: ProviderId, initialMessages: ChatMessage[] = []): ProjectSessionBundle {
    const existing = this.bundles.get(projectId)
    if (existing) {
      if (initialMessages.length > 0) {
        const current = existing.sessionStates.getState()
        const draftState = current[DRAFT_SESSION_KEY]
        if (!draftState || draftState.messages.length === 0) {
          existing.sessionStates.setState(
            {
              ...current,
              [DRAFT_SESSION_KEY]: createSessionViewState(defaultProvider, initialMessages),
            },
            true
          )
        }
      }
      return existing
    }

    const bundle: ProjectSessionBundle = {
      selectedSessionId: createStore<string | null>(() => null),
      sessionStates: createStore<Record<string, ProjectSessionViewState>>(() => ({
        [DRAFT_SESSION_KEY]: createSessionViewState(defaultProvider, initialMessages),
      })),
    }
    this.bundles.set(projectId, bundle)
    return bundle
  }

  getSelectedSessionStore(projectId: string, defaultProvider: ProviderId, initialMessages: ChatMessage[] = []): StoreApi<string | null> {
    return this.getOrCreateBundle(projectId, defaultProvider, initialMessages).selectedSessionId
  }

  getSessionStatesStore(
    projectId: string,
    defaultProvider: ProviderId,
    initialMessages: ChatMessage[] = []
  ): StoreApi<Record<string, ProjectSessionViewState>> {
    return this.getOrCreateBundle(projectId, defaultProvider, initialMessages).sessionStates
  }

  getSessionState(
    projectId: string,
    sessionKey: string,
    defaultProvider: ProviderId,
    initialMessages: ChatMessage[] = []
  ): ProjectSessionViewState {
    const bundle = this.getOrCreateBundle(projectId, defaultProvider, initialMessages)
    const current = bundle.sessionStates.getState()
    return current[sessionKey] ?? createSessionViewState(defaultProvider)
  }

  ensureSession(
    projectId: string,
    sessionKey: string,
    provider: ProviderId,
    initialMessages: ChatMessage[] = []
  ): ProjectSessionViewState {
    const bundle = this.getOrCreateBundle(projectId, provider, initialMessages)
    const current = bundle.sessionStates.getState()
    const existing = current[sessionKey]
    if (existing) {
      return existing
    }

    const next = {
      ...current,
      [sessionKey]: createSessionViewState(provider),
    }
    bundle.sessionStates.setState(next, true)
    return next[sessionKey]
  }

  setSelectedSessionId(projectId: string, sessionId: string | null, defaultProvider: ProviderId, initialMessages: ChatMessage[] = []): void {
    const bundle = this.getOrCreateBundle(projectId, defaultProvider, initialMessages)
    bundle.selectedSessionId.setState(sessionId, true)
  }

  replaceSessionState(
    projectId: string,
    sessionKey: string,
    state: ProjectSessionViewState,
    defaultProvider: ProviderId,
    initialMessages: ChatMessage[] = []
  ): void {
    const bundle = this.getOrCreateBundle(projectId, defaultProvider, initialMessages)
    const current = bundle.sessionStates.getState()
    bundle.sessionStates.setState(
      {
        ...current,
        [sessionKey]: state,
      },
      true
    )
  }

  updateSessionState(
    projectId: string,
    sessionKey: string,
    updater: (prev: ProjectSessionViewState) => ProjectSessionViewState,
    defaultProvider: ProviderId,
    initialMessages: ChatMessage[] = []
  ): void {
    const bundle = this.getOrCreateBundle(projectId, defaultProvider, initialMessages)
    const current = bundle.sessionStates.getState()
    const previous = current[sessionKey] ?? createSessionViewState(defaultProvider)
    const nextState = updater(previous)

    if (nextState === previous) return

    bundle.sessionStates.setState(
      {
        ...current,
        [sessionKey]: nextState,
      },
      true
    )
  }

  moveSessionState(
    projectId: string,
    fromKey: string,
    toKey: string,
    provider: ProviderId,
    apply?: (state: ProjectSessionViewState) => ProjectSessionViewState,
    initialMessages: ChatMessage[] = []
  ): void {
    const bundle = this.getOrCreateBundle(projectId, provider, initialMessages)
    const current = bundle.sessionStates.getState()
    const fromState = current[fromKey] ?? createSessionViewState(provider)
    const nextState = apply ? apply(fromState) : fromState
    const next = { ...current, [toKey]: nextState }

    if (fromKey !== toKey) {
      delete next[fromKey]
    }

    bundle.sessionStates.setState(next, true)
  }

  deleteSessionState(projectId: string, sessionKey: string, defaultProvider: ProviderId): void {
    const bundle = this.getOrCreateBundle(projectId, defaultProvider)
    const current = bundle.sessionStates.getState()
    if (!(sessionKey in current)) return
    const next = { ...current }
    delete next[sessionKey]
    bundle.sessionStates.setState(next, true)
  }

  markSessionNeedsRefresh(projectId: string, sessionKey: string, defaultProvider: ProviderId, needsRefresh = true): void {
    this.updateSessionState(
      projectId,
      sessionKey,
      (prev) => ({ ...prev, needsRefresh }),
      defaultProvider
    )
  }

  markProjectNeedsRefresh(projectId: string, defaultProvider: ProviderId): void {
    const bundle = this.getOrCreateBundle(projectId, defaultProvider)
    const current = bundle.sessionStates.getState()
    const next: Record<string, ProjectSessionViewState> = {}
    for (const [key, value] of Object.entries(current)) {
      next[key] = {
        ...value,
        needsRefresh: value.isHydrated,
      }
    }
    bundle.sessionStates.setState(next, true)
  }
}

export const projectSessionsStore = new ProjectSessionsStore()
export { DRAFT_SESSION_KEY, createSessionViewState, getDefaultModelForProvider }
