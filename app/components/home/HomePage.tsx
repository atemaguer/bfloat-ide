import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FolderOpen,
  Github,
  Search,
  LayoutGrid,
  List,
  MessageCircle,
  MoreVertical,
  Trash2,
  Loader2,
  AlertCircle,
  Smartphone,
  Globe,
} from 'lucide-react'
import { useStore } from '@/app/hooks/useStore'
import { aiAgent } from '@/app/api/sidecar'
import { localProjectsStore } from '@/app/stores/local-projects'
import type { AppType, Project } from '@/app/types/project'
import type { ProviderId, ProviderInfo } from '@/lib/conveyor/schemas/ai-agent-schema'
import { ChatInput, type ImageAttachment } from '@/app/components/chat'
import { HomeSidebar } from './HomeSidebar'
import { HomeRightPanel } from './HomeRightPanel'
import { themeStore } from '@/app/stores/theme'

import './home-sidebar.css'
import logoDark from '@/app/assets/plain-icon-dark.png'
import logoLight from '@/app/assets/plain-icon-light.png'


// Format relative time
function formatRelativeTime(dateString?: string): string {
  if (!dateString) return ''

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Generate color based on title
function getProjectColor(title: string): string {
  const colors = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export default function HomePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [appType, setAppType] = useState<AppType>('mobile')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedProvider, _setSelectedProvider] = useState<ProviderId>('claude')
  const [selectedModel, setSelectedModel] = useState<string>('claude-sonnet-4-20250514')

  // Default models per provider
  const defaultModelForProvider: Record<ProviderId, string> = {
    claude: 'claude-sonnet-4-20250514',
    codex: 'o4-mini',
  }

  // When switching providers, also update the model to the provider's default
  const setSelectedProvider = useCallback((id: ProviderId) => {
    _setSelectedProvider(id)
    setSelectedModel(defaultModelForProvider[id] || '')
  }, [])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [backgroundProjectIds, setBackgroundProjectIds] = useState<Set<string>>(new Set())

  const projects = useStore(localProjectsStore.sortedProjects)
  const isLoadingProjects = useStore(localProjectsStore.isLoading)
  const resolvedTheme = useStore(themeStore.resolvedTheme)

  // Load projects on mount
  useEffect(() => {
    localProjectsStore.load()
  }, [])

  // Poll for background agent sessions (for indicators on project cards)
  useEffect(() => {
    const fetchBackgroundSessions = () => {
      aiAgent
        .listBackgroundSessions()
        .then((sessions) => {
          const activeIds = new Set(sessions.map((s) => s.projectId))
          setBackgroundProjectIds(activeIds)
        })
        .catch((error) => {
          console.error('Failed to fetch background sessions:', error)
        })
    }

    // Fetch immediately and then poll every 5 seconds
    fetchBackgroundSessions()
    const interval = setInterval(fetchBackgroundSessions, 5000)
    return () => clearInterval(interval)
  }, [])

  // Fetch provider auth status
  useEffect(() => {
    aiAgent
      .getProviders()
      .then((providerList) => {
        setProviders(providerList)
        const authenticatedProvider = providerList.find((p) => p.isAuthenticated)
        if (authenticatedProvider) {
          setSelectedProvider(authenticatedProvider.id)
        }
      })
      .catch((error) => {
        console.error('Failed to fetch providers:', error)
      })
  }, [])

  // Always show both Claude and Codex, with auth status from the API
  const visibleProviders: ProviderInfo[] = useMemo(() => {
    const claudeInfo = providers.find((p) => p.id === 'claude')
    const codexInfo = providers.find((p) => p.id === 'codex')
    return [
      { id: 'claude' as const, name: 'Claude', isAuthenticated: claudeInfo?.isAuthenticated ?? false },
      { id: 'codex' as const, name: 'Codex', isAuthenticated: codexInfo?.isAuthenticated ?? false },
    ]
  }, [providers])

  const isProviderAuthenticated = providers.find((p) => p.id === selectedProvider)?.isAuthenticated ?? false

  const handleSubmit = async (_prompt: string, attachments: ImageAttachment[] = []) => {
    console.log('[HomePage] handleSubmit called, prompt:', _prompt.substring(0, 50), 'attachments:', attachments.length)
    if (!_prompt.trim() && attachments.length === 0) return
    if (isCreating) return

    setIsCreating(true)
    setCreateError(null)
    console.log('[HomePage] Creating project with', attachments.length, 'attachments')

    // Attachments are already in FileUIPart format with url (data URL)
    // Convert to navigation state format
    const imageDataForNavigation: Array<{ filename: string; base64: string; type: string }> = []
    for (const attachment of attachments) {
      if (attachment.type === 'file') {
        imageDataForNavigation.push({
          filename: attachment.filename || 'attachment.png',
          base64: attachment.url, // url is already a data URL
          type: attachment.mediaType,
        })
        console.log('[HomePage] Prepared image for navigation:', attachment.filename)
      }
    }

    try {
      // Generate project name using AI (with fallback)
      let projectName: string | undefined
      try {
        console.log('[HomePage] Generating project name using AI...')
        const nameResult = await aiAgent.generateProjectName(_prompt.trim(), selectedProvider)
        if (nameResult.success && nameResult.name) {
          projectName = nameResult.name
          console.log('[HomePage] AI generated project name:', projectName, '(source:', nameResult.source, ')')
        }
      } catch (nameError) {
        console.warn('[HomePage] AI name generation failed, using fallback:', nameError)
      }

      const project = await localProjectsStore.createFromPrompt(_prompt.trim(), appType, projectName)
      console.log('[HomePage] Project created:', project.id, 'title:', project.title, 'with', imageDataForNavigation.length, 'images for navigation')
      navigate(`/projects/${project.id}`, {
        state: {
          provider: selectedProvider,
          model: selectedModel,
          images: imageDataForNavigation.length > 0 ? imageDataForNavigation : undefined,
        },
      })
    } catch (error) {
      console.error('Failed to create workspace:', error)
      setCreateError(error instanceof Error ? error.message : 'Failed to create project. Please try again.')
      setIsCreating(false)
    }
  }

  const handleProjectClick = (project: Project) => {
    navigate(`/projects/${project.id}`)
  }

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()

    setDeletingProjectId(projectId)
    setOpenDropdownId(null)

    try {
      await localProjectsStore.delete(projectId)
    } catch (error) {
      console.error('Failed to delete project:', error)
    } finally {
      setDeletingProjectId(null)
    }
  }

  const handleDropdownToggle = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    setOpenDropdownId(openDropdownId === projectId ? null : projectId)
  }

  const handleImportFromGitHub = async () => {
    // TODO: Implement local GitHub import dialog
    console.log('GitHub import not yet implemented for local-first mode')
  }

  const handleImportFromLocal = async () => {
    // TODO: Implement local folder import dialog
    console.log('Local import not yet implemented for local-first mode')
  }

  const handleOpenCommandPalette = () => {
    // Trigger command palette via keyboard event
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  const filteredProjects = projects.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="home-layout">
      {/* Sidebar */}
      <HomeSidebar
        projects={projects}
        isLoadingProjects={isLoadingProjects}
        onProjectClick={handleProjectClick}
        onNewProject={() => {
          // Focus the chat input
          const input = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement
          input?.focus()
        }}
        onSearch={handleOpenCommandPalette}
      />

      {/* Main Content */}
      <div className={`home-main ${projects.length === 0 && !isLoadingProjects ? 'empty-state' : ''}`}>
        <div className="home-main-content">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ marginBottom: '16px' }}
          >
            <img
              src={resolvedTheme === 'dark' ? logoDark : logoLight}
              alt="Logo"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
              }}
            />
          </motion.div>

          {/* Welcome Message */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            style={{
              fontSize: '24px',
              fontWeight: 500,
              marginBottom: '16px',
              color: 'hsl(var(--foreground))',
            }}
          >
            Welcome to Bfloat IDE
          </motion.h1>

          <div className="home-content-grid">
          {/* Left Column */}
          <div className="home-content-left">
          {/* Chat Input */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            style={{ marginBottom: projects.length > 0 ? '32px' : '16px' }}
          >
            <ChatInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={handleSubmit}
              isDisabled={isCreating}
              placeholder="Describe the app you want to build..."
              showMic={true}
              providerSelector={{
                provider: selectedProvider,
                onProviderChange: (id) => setSelectedProvider(id as ProviderId),
                onModelChange: (modelId) => setSelectedModel(modelId),
                options: visibleProviders.map((p) => ({
                  id: p.id,
                  label: p.id === 'claude' ? 'Claude' : 'Codex',
                  isAuthenticated: p.isAuthenticated,
                })),
                isAuthenticated: isProviderAuthenticated,
              }}
              appTypeSelector={{
                appType: appType,
                onAppTypeChange: setAppType,
              }}
            />
            {createError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'hsl(var(--destructive) / 0.1)',
                  color: 'hsl(var(--destructive))',
                  fontSize: '13px',
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{createError}</span>
              </div>
            )}
          </motion.div>

          {/* Divider - only show when there are projects */}
          {projects.length > 0 && (
            <div style={{ height: '1px', backgroundColor: 'hsl(var(--border))', marginBottom: '32px' }} />
          )}

          {/* Action Cards - Import Options */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '32px',
            }}
          >
            <button
              onClick={handleImportFromGitHub}
              className="home-action-card"
            >
              <Github size={18} strokeWidth={1.5} />
              <span style={{ fontSize: '14px', fontWeight: 500 }}>Import from GitHub</span>
            </button>
            <button
              onClick={handleImportFromLocal}
              className="home-action-card"
            >
              <FolderOpen size={18} strokeWidth={1.5} />
              <span style={{ fontSize: '14px', fontWeight: 500 }}>Import Local Folder</span>
            </button>
          </motion.div>

          {/* Open existing project */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
          >
            {/* Only show section header and search if there are projects */}
            {(projects.length > 0 || isLoadingProjects) && (
              <>
                <h2
                  style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    marginBottom: '16px',
                    color: 'hsl(var(--foreground))',
                  }}
                >
                  Open existing project
                </h2>

                {/* Search and View Toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div className="home-search-bar">
                    <Search size={16} style={{ color: 'hsl(var(--muted-foreground))' }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search projects"
                      style={{
                        flex: 1,
                        backgroundColor: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontSize: '14px',
                        color: 'hsl(var(--foreground))',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>

                  <div className="home-view-toggle">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`home-view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`home-view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                    >
                      <List size={16} />
                    </button>
                  </div>
                </div>

                {/* Project Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: viewMode === 'grid' ? 'repeat(2, 1fr)' : '1fr',
                    gap: '12px',
                  }}
                >
                  {isLoadingProjects
                    ? [...Array(4)].map((_, i) => (
                        <div key={i} className="home-skeleton-card">
                          <div
                            className="home-skeleton-bar"
                            style={{ width: '60%', height: '16px', marginBottom: '8px' }}
                          />
                          <div
                            className="home-skeleton-bar"
                            style={{ width: '40%', height: '12px' }}
                          />
                        </div>
                      ))
                    : filteredProjects.map((project) => {
                        return (
                          <div
                            key={project.id}
                            className={`home-project-card ${deletingProjectId === project.id ? 'deleting' : ''}`}
                            onClick={() => handleProjectClick(project)}
                          >
                            {/* Project Header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '6px',
                                  backgroundColor: getProjectColor(project.title),
                                  color: 'white',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                }}
                              >
                                {project.title[0]?.toUpperCase()}
                              </span>
                              <span style={{ fontSize: '14px', fontWeight: 500, color: 'hsl(var(--foreground))', flex: 1 }}>
                                {project.title}
                              </span>
                              {/* Dropdown Menu Button */}
                              <button
                                onClick={(e) => handleDropdownToggle(e, project.id)}
                                className={`home-dropdown-btn ${openDropdownId === project.id ? 'open' : ''}`}
                              >
                                <MoreVertical size={14} />
                              </button>
                            </div>

                            {/* Dropdown Menu */}
                            {openDropdownId === project.id && (
                              <>
                                <div
                                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOpenDropdownId(null)
                                  }}
                                />
                                <div className="home-dropdown-menu">
                                  <button
                                    onClick={(e) => handleDeleteProject(e, project.id)}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      width: '100%',
                                      padding: '8px 12px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      backgroundColor: 'transparent',
                                      color: '#ef4444',
                                      fontSize: '13px',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                  >
                                    <Trash2 size={14} />
                                    Delete
                                  </button>
                                </div>
                              </>
                            )}

                            {/* Project Badges (Type) */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                marginBottom: '12px',
                                paddingLeft: '34px',
                                flexWrap: 'wrap',
                              }}
                            >
                              {/* App Type Badge */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: project.appType === 'mobile' || project.appType === 'expo' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                  color: project.appType === 'mobile' || project.appType === 'expo' ? '#a855f7' : '#3b82f6',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                }}
                              >
                                {project.appType === 'mobile' || project.appType === 'expo' ? (
                                  <Smartphone size={10} />
                                ) : (
                                  <Globe size={10} />
                                )}
                                <span>{project.appType === 'mobile' || project.appType === 'expo' ? 'Mobile' : 'Web'}</span>
                              </div>

                              {/* Background Agent Running Indicator */}
                              {backgroundProjectIds.has(project.id) && (
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                                    color: '#22c55e',
                                    fontSize: '11px',
                                    fontWeight: 500,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: '6px',
                                      height: '6px',
                                      borderRadius: '50%',
                                      backgroundColor: '#22c55e',
                                      animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                                    }}
                                  />
                                  <span>Running</span>
                                </div>
                              )}
                            </div>

                            {/* Divider */}
                            <div style={{ height: '1px', backgroundColor: 'hsl(var(--border))', marginBottom: '12px' }} />

                            {/* Last Activity */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: '12px',
                                color: 'hsl(var(--muted-foreground))',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <MessageCircle size={12} />
                                <span>New Chat</span>
                              </div>
                              <span>{formatRelativeTime(project.updatedAt || project.createdAt)}</span>
                            </div>
                          </div>
                        )
                      })}
                </div>
              </>
            )}

            {/* Empty State */}
            {projects.length === 0 && !isLoadingProjects && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '24px',
                  textAlign: 'center',
                }}
              >
                <div className="home-empty-icon-box">
                  <FolderOpen size={28} strokeWidth={1.5} style={{ color: 'hsl(var(--muted-foreground))' }} />
                </div>
                <h3
                  style={{
                    fontSize: '16px',
                    fontWeight: 500,
                    color: 'hsl(var(--foreground))',
                    marginBottom: '8px',
                  }}
                >
                  No projects yet
                </h3>
                <p
                  style={{
                    fontSize: '14px',
                    color: 'hsl(var(--muted-foreground))',
                    maxWidth: '300px',
                    lineHeight: 1.5,
                  }}
                >
                  Describe your app idea above to create your first project, or import an existing one.
                </p>
              </div>
            )}
          </motion.div>
          </div>

          {/* Right Column */}
          <HomeRightPanel
            projects={projects}
            onStartProject={(prompt, appType) => {
              setAppType(appType)
              if (prompt) {
                setPrompt(prompt)
              }
              // Focus the chat input
              setTimeout(() => {
                const input = document.querySelector('.chat-input-textarea') as HTMLTextAreaElement
                input?.focus()
              }, 50)
            }}
            onProjectClick={handleProjectClick}
          />
          </div>
        </div>
      </div>
    </div>
  )
}
