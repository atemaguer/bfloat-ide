/**
 * SessionTabs - Cursor-style horizontal tab bar for switching between chat sessions.
 *
 * Each tab represents an AgentSession. The "+" button creates a new session.
 * Tabs are ordered by createdAt ASC (oldest first, newest on right).
 */

import { memo, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'

// Local session info (adapted from CLI storage)
interface LocalSessionInfo {
  sessionId: string
  lastModified: number
  name?: string
  provider?: 'claude' | 'codex' | 'bfloat'
}

interface SessionModelOption {
  id: string
  label: string
}

interface SessionAgentOption {
  id: 'claude' | 'bfloat' | 'codex'
  label: string
  models?: SessionModelOption[]
}

interface SessionTabsProps {
  sessions: LocalSessionInfo[]
  activeSessionId: string | null // null = unsaved new session
  sessionModelLabelById?: Record<string, string>
  newSessionAgentOptions?: SessionAgentOption[]
  selectedNewSessionProviderId?: 'claude' | 'bfloat' | 'codex'
  selectedNewSessionModelId?: string
  onSelectSession: (session: LocalSessionInfo) => void
  onNewSession: (providerId?: 'claude' | 'bfloat' | 'codex', modelId?: string) => void
  onDeleteSession: (session: LocalSessionInfo) => void
}

export const SessionTabs = memo(function SessionTabs({
  sessions,
  activeSessionId,
  sessionModelLabelById,
  newSessionAgentOptions,
  selectedNewSessionProviderId,
  selectedNewSessionModelId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: SessionTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sort sessions by lastModified ascending (oldest first)
  const sortedSessions = [...sessions].sort((a, b) => a.lastModified - b.lastModified)

  // Auto-scroll to the active tab when it changes
  useEffect(() => {
    if (!scrollRef.current) return
    const activeTab = scrollRef.current.querySelector('.session-tab.active')
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeSessionId])

  // Determine if we have an unsaved new session (no matching session in the list)
  const hasUnsavedNewSession =
    activeSessionId === null ||
    (activeSessionId && !sessions.some((s) => s.sessionId === activeSessionId))

  return (
    <div className="session-tabs">
      <div className="session-tabs-scroll" ref={scrollRef}>
        {sortedSessions.map((session, index) => {
          const isActive = session.sessionId === activeSessionId
          const label = session.name || `Session ${index + 1}`
          const modelLabel = sessionModelLabelById?.[session.sessionId]

          return (
            <button
              key={session.sessionId}
              className={`session-tab ${isActive ? 'active' : ''}`}
              onClick={() => !isActive && onSelectSession(session)}
              title={label}
            >
              <span className="session-tab-label">{label}</span>
              {modelLabel && <span className="session-tab-model">{modelLabel}</span>}
              <span
                className="session-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSession(session)
                }}
                title="Delete session"
              >
                <X size={12} />
              </span>
            </button>
          )
        })}

        {/* Show "New Session" tab if there's an unsaved session in progress */}
        {hasUnsavedNewSession && (
          <button className="session-tab active" title="New Session">
            <span className="session-tab-label">New Session</span>
          </button>
        )}
      </div>

      {/* "+" button to create a new session (pinned to the right) */}
      <div className="session-tabs-add-area">
        <div className="session-tab-add-wrap">
          <button
            className="session-tab-add"
            onClick={() => onNewSession(selectedNewSessionProviderId, selectedNewSessionModelId)}
            title="New session"
          >
            <Plus size={14} />
          </button>
          {newSessionAgentOptions && newSessionAgentOptions.length > 0 && (
            <div className="session-tab-add-menu" role="menu" aria-label="Select model for new session">
              {newSessionAgentOptions.map((agent) => {
                const hasModels = !!agent.models?.length
                const isProviderSelected = selectedNewSessionProviderId === agent.id
                return (
                  <div key={agent.id} className="session-tab-add-menu-group">
                    <button
                      className={`session-tab-add-menu-item ${isProviderSelected && !hasModels ? 'selected' : ''}`}
                      onClick={() => onNewSession(agent.id)}
                      role="menuitem"
                    >
                      <span>{agent.label}</span>
                      {hasModels && <span className="session-tab-add-menu-caret">›</span>}
                    </button>
                    {hasModels && (
                      <div className="session-tab-add-submenu">
                        {agent.models!.map((model) => {
                          const isModelSelected =
                            selectedNewSessionProviderId === agent.id &&
                            selectedNewSessionModelId === model.id
                          return (
                            <button
                              key={model.id}
                              className={`session-tab-add-menu-item ${isModelSelected ? 'selected' : ''}`}
                              onClick={() => onNewSession(agent.id, model.id)}
                              role="menuitem"
                            >
                              {model.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
