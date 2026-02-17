/**
 * Session management hooks for local-first project storage.
 * Sessions are stored in ~/.bfloat-ide/projects.json as part of each project.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { AgentSession } from '@/app/types/project'

// Local session info format for SessionTabs
export interface LocalSessionInfo {
  sessionId: string
  lastModified: number
  name?: string
  provider?: 'claude' | 'codex' | 'bfloat'
}

/**
 * Hook to manage sessions for a project.
 * Mirrors bfloat-workbench's useSessions but reads from projects.json instead of backend API.
 */
export function useSessions(projectId: string | undefined) {
  const [sessions, setSessions] = useState<LocalSessionInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const hasLoaded = useRef(false)

  // Load sessions from projects.json
  const loadSessions = useCallback(async () => {
    if (!projectId || !window.conveyor?.localProjects) return

    setIsLoading(true)
    try {
      const projectSessions = await window.conveyor.localProjects.listSessions(projectId)

      if (projectSessions && projectSessions.length > 0) {
        // Convert AgentSession to LocalSessionInfo format
        const sessionInfos: LocalSessionInfo[] = projectSessions.map((s: AgentSession) => ({
          sessionId: s.sessionId,
          lastModified: new Date(s.lastUsedAt || s.createdAt).getTime(),
          name: s.name || undefined,
          provider: s.provider,
        }))

        // Sort by lastModified descending (newest first)
        sessionInfos.sort((a, b) => b.lastModified - a.lastModified)
        setSessions(sessionInfos)
        console.log('[useSessions] Loaded sessions from projects.json:', sessionInfos.length)
      } else {
        console.log('[useSessions] No sessions in projects.json')
        setSessions([])
      }
    } catch (err) {
      console.error('[useSessions] Failed to load sessions:', err)
      setSessions([])
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  // Initial load
  useEffect(() => {
    if (!projectId || hasLoaded.current) return
    hasLoaded.current = true
    loadSessions()
  }, [projectId, loadSessions])

  // Refresh sessions (called after mutations)
  const refresh = useCallback(() => {
    loadSessions()
  }, [loadSessions])

  return {
    sessions,
    isLoading,
    refresh,
  }
}

/**
 * Hook to save a session to projects.json.
 * Returns a mutate function that saves the session and updates the local cache.
 */
export function useSaveSession(
  projectId: string | undefined,
  onSuccess?: (session: AgentSession) => void
) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = useCallback(
    async (params: {
      sessionId: string
      provider: 'claude' | 'codex' | 'bfloat'
      model?: string
      name?: string | null
    }) => {
      console.log('[useSaveSession] ========================================')
      console.log('[useSaveSession] mutate called with:', {
        sessionId: params.sessionId,
        provider: params.provider,
        model: params.model,
        projectId,
        hasLocalProjectsApi: !!window.conveyor?.localProjects,
      })
      console.log('[useSaveSession] ========================================')

      if (!projectId || !window.conveyor?.localProjects) {
        console.error('[useSaveSession] Missing projectId or localProjects API', {
          projectId,
          hasConveyor: !!window.conveyor,
          hasLocalProjects: !!window.conveyor?.localProjects,
        })
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const now = new Date().toISOString()
        const session: AgentSession = {
          id: params.sessionId,
          projectId,
          sessionId: params.sessionId,
          provider: params.provider,
          model: params.model,
          name: params.name,
          createdAt: now,
          lastUsedAt: now,
        }

        console.log('[useSaveSession] Calling localProjects.addSession...')
        await window.conveyor.localProjects.addSession(projectId, session)
        console.log('[useSaveSession] ========================================')
        console.log('[useSaveSession] SUCCESS - Session saved:', params.sessionId)
        console.log('[useSaveSession] Project ID:', projectId)
        console.log('[useSaveSession] ========================================')
        onSuccess?.(session)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save session'
        console.error('[useSaveSession] Error:', errorMsg)
        setError(errorMsg)
      } finally {
        setIsLoading(false)
      }
    },
    [projectId, onSuccess]
  )

  // Return a stable object reference to prevent unnecessary re-renders
  // This ensures handleSessionIdChange doesn't recreate on every render
  return useMemo(
    () => ({
      mutate,
      isLoading,
      error,
    }),
    [mutate, isLoading, error]
  )
}

/**
 * Hook to delete a session from projects.json.
 */
export function useDeleteSession(
  projectId: string | undefined,
  onSuccess?: (sessionId: string) => void
) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = useCallback(
    async (sessionId: string) => {
      if (!projectId || !window.conveyor?.localProjects) {
        console.error('[useDeleteSession] Missing projectId or localProjects API')
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        await window.conveyor.localProjects.deleteSession(projectId, sessionId)
        console.log('[useDeleteSession] Session deleted:', sessionId)
        onSuccess?.(sessionId)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to delete session'
        console.error('[useDeleteSession] Error:', errorMsg)
        setError(errorMsg)
      } finally {
        setIsLoading(false)
      }
    },
    [projectId, onSuccess]
  )

  return {
    mutate,
    isLoading,
    error,
  }
}

/**
 * Hook to update a session's lastUsedAt timestamp.
 */
export function useUpdateSession(projectId: string | undefined) {
  const mutate = useCallback(
    async (sessionId: string, updates: Partial<AgentSession>) => {
      if (!projectId || !window.conveyor?.localProjects) return

      try {
        await window.conveyor.localProjects.updateSession(projectId, sessionId, updates)
      } catch (err) {
        console.warn('[useUpdateSession] Failed to update session:', err)
      }
    },
    [projectId]
  )

  return { mutate }
}
