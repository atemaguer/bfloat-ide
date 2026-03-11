import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Loader2, ArrowLeft } from 'lucide-react'
import { useStore } from '@/app/hooks/useStore'
import { motion } from 'framer-motion'

import { workbenchStore } from '@/app/stores/workbench'
import { projectStore } from '@/app/stores/project-store'
import { localProjectsStore } from '@/app/stores/local-projects'
import type { FileMap, Project } from '@/app/types/project'
import type { ProviderId } from '@/lib/conveyor/schemas/ai-agent-schema'
import { detectAppTypeFromPackageJson } from '@/lib/launch'
import { Button } from '@/app/components/ui/button'
import { ProjectContent } from './ProjectContent'
import { filesystem, terminal } from '@/app/api/sidecar'
import './styles.css'

function normalizePathForProjectMatch(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isPathForProject(candidatePath: string | null | undefined, projectId: string): boolean {
  if (!candidatePath) return false
  const normalized = normalizePathForProjectMatch(candidatePath)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] === projectId
}

function ProjectPageContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  // Load project from local store
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Get initial provider, model and images from navigation state (set during project creation)
  const locationState = location.state as {
    provider?: ProviderId
    model?: string
    images?: Array<{ filename: string; base64: string; type: string }>
  } | null
  const initialProvider = locationState?.provider
  const initialModel = locationState?.model
  const initialImages = locationState?.images

  // Use new projectStore for file system state
  const syncStatus = useStore(projectStore.status)
  const storeProjectId = useStore(projectStore.projectId)
  const projectPath = useStore(projectStore.projectPath)
  const storeError = useStore(projectStore.error)

  const hasRegisteredApi = useRef(false)
  const hasStartedSync = useRef(false)

  // Load project from local store
  useEffect(() => {
    if (!id) {
      setError(new Error('No project ID provided'))
      setIsLoading(false)
      return
    }

    const loadProject = async () => {
      setIsLoading(true)
      try {
        // Always refresh from storage to avoid stale in-memory metadata
        // (e.g., sourceUrl/sourceBranch updated in settings).
        await localProjectsStore.load()
        const proj = localProjectsStore.get(id)

        if (!proj) {
          setError(new Error('Project not found'))
        } else {
          console.log('[ProjectPage] Loaded project metadata:', {
            projectId: proj.id,
            hasSourceUrl: !!proj.sourceUrl,
            sourceBranch: proj.sourceBranch || null,
          })
          setProject(proj)
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load project'))
      } finally {
        setIsLoading(false)
      }
    }

    loadProject()
  }, [id])

  // Register filesystem API once
  useEffect(() => {
    if (!hasRegisteredApi.current) {
      workbenchStore.registerFilesystemApi(filesystem)
      hasRegisteredApi.current = true
    }
  }, [])

  // Initialize projectStore IPC listener on mount
  useEffect(() => {
    projectStore.initializeListener()
  }, [])

  // Start project sync - for local projects, use the local path or create a new workspace
  useEffect(() => {
    if (!project || hasStartedSync.current) return

    hasStartedSync.current = true

    const openProject = async () => {
      // For local-first: use sourceUrl as the clone URL or local path
      // If no sourceUrl, this is a new project created from prompt - create empty workspace
      const cloneUrl = project.sourceUrl || ''

      console.log('[ProjectPage] Opening project via projectStore:', {
        projectId: project.id,
        hasSourceUrl: !!project.sourceUrl,
        appType: project.appType,
      })

      try {
        const openStart = performance.now()
        await projectStore.open(project.id, cloneUrl, project.appType || undefined)
        console.log(`[ProjectPage] Project opened successfully in ${Math.round(performance.now() - openStart)}ms`)
      } catch (err) {
        console.error('[ProjectPage] Failed to open project:', err)
      }
    }

    openProject()
  }, [project?.id, project?.sourceUrl])

  // Track if this is a real unmount vs React Strict Mode's simulated unmount
  const isMountedRef = useRef(true)
  const unmountTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup on unmount - uses a timeout to distinguish real unmounts from Strict Mode
  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false

      // Use a small delay to distinguish real unmounts from React Strict Mode's simulated unmount
      // In Strict Mode, the component remounts immediately, so the timeout gets cleared
      unmountTimeoutRef.current = setTimeout(() => {
        // Only run cleanup if component is still unmounted after the delay
        if (!isMountedRef.current) {
          console.log('[ProjectPage] ===== UNMOUNTING (real) =====')

          // Save all unsaved changes and commit to git BEFORE closing
          workbenchStore
            .saveAllAndCommit()
            .then(() => {
              console.log('[ProjectPage] Closing project on unmount')
              return projectStore.close()
            })
            .then(() => {
              // Kill workbench terminals, but keep agent sessions alive so the
              // chat can reconnect when the user returns to this project.
              console.log('[ProjectPage] Killing all terminals')
              const killAllTerminals =
                typeof (terminal as { killAll?: () => Promise<unknown> }).killAll === 'function'
                  ? (terminal as { killAll: () => Promise<unknown> }).killAll()
                  : Promise.resolve()

              return killAllTerminals.catch((err: Error) => {
                console.error('[ProjectPage] Failed to kill terminals:', err)
              })
            })
            .catch((err: Error) => {
              console.error('[ProjectPage] Failed during cleanup:', err)
            })
            .finally(() => {
              console.log('[ProjectPage] Resetting workbench state on unmount')
              workbenchStore.reset()
              console.log('[ProjectPage] ===== END UNMOUNT =====')
            })
        }
      }, 100) // 100ms delay to wait for potential remount
    }
  }, [])

  // Clear the unmount timeout if component remounts (Strict Mode)
  useEffect(() => {
    if (unmountTimeoutRef.current) {
      clearTimeout(unmountTimeoutRef.current)
      unmountTimeoutRef.current = null
    }
  }, [])

  // Bridge: Sync file changes from projectStore to workbenchStore
  // When files change in projectStore, update workbenchStore for existing components
  const fileTree = useStore(projectStore.fileTreeArray)
  const lastFileChange = useStore(projectStore.lastFileChange)

  // Track if initial sync has completed to avoid re-running full sync
  const initialSyncDone = useRef(false)
  const lastSyncedFileTree = useRef<string>('')
  const normalizeAppType = (rawAppType?: Project['appType']): 'web' | 'mobile' => {
    return rawAppType === 'nextjs' || rawAppType === 'vite' || rawAppType === 'node' || rawAppType === 'web'
      ? 'web'
      : 'mobile'
  }

  // Initial file sync - only runs once when project becomes ready
  // Uses parallel loading with concurrency limit for performance
  useEffect(() => {
    if (syncStatus !== 'ready' || !project) return
    if (storeProjectId !== project.id || !isPathForProject(projectPath, project.id)) return

    // Create a fingerprint of the file tree to detect actual changes
    const fileTreeFingerprint = fileTree.map(n => n.path).sort().join('|')

    // Skip if we've already synced this exact file tree
    if (initialSyncDone.current && lastSyncedFileTree.current === fileTreeFingerprint) {
      return
    }

    // Track if this effect execution is still current (not superseded by a newer one)
    let isCancelled = false

    // Load all file contents in parallel with concurrency limit
    const syncFilesToWorkbench = async () => {
      const fileNodes = fileTree.filter(node => node.type === 'file')
      const fileMap: FileMap = {}

      // Use parallel loading with concurrency limit (10 concurrent reads)
      const CONCURRENCY = 10
      const chunks: typeof fileNodes[] = []
      for (let i = 0; i < fileNodes.length; i += CONCURRENCY) {
        chunks.push(fileNodes.slice(i, i + CONCURRENCY))
      }

      for (const chunk of chunks) {
        if (isCancelled) {
          console.log('[ProjectPage] File sync cancelled (superseded)')
          return
        }

        // Load chunk in parallel
        const results = await Promise.all(
          chunk.map(async (node) => {
            try {
              const openFile = await projectStore.openFile(node.path)
              return {
                path: node.path,
                content: openFile.content,
                isBinary: openFile.isBinary,
              }
            } catch (err) {
              console.error(`[ProjectPage] Failed to load file: ${node.path}`, err)
              return null
            }
          })
        )

        // Add successful results to fileMap
        for (const result of results) {
          if (result) {
            fileMap[result.path] = {
              type: 'file',
              content: result.content,
              isBinary: result.isBinary,
            }
          }
        }
      }

      // Final check before setting files
      if (isCancelled) {
        console.log('[ProjectPage] File sync cancelled before setFiles (superseded)')
        return
      }

      const fileCount = Object.keys(fileMap).length
      console.log(`[ProjectPage] Initial sync: ${fileCount} files loaded to workbench`)
      workbenchStore.setFiles(fileMap)

      const detectedAppType = detectAppTypeFromPackageJson(
        fileMap as Record<string, { type: string; content: string } | null | undefined>
      )
      const currentAppType = normalizeAppType(project.appType)
      if (detectedAppType && detectedAppType !== currentAppType) {
        console.log(`[ProjectPage] Auto-detected app type "${detectedAppType}" (was "${project.appType || 'unset'}")`)
        try {
          await localProjectsStore.update(project.id, { appType: detectedAppType })
          setProject((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              appType: detectedAppType,
              updatedAt: new Date().toISOString(),
            }
          })
        } catch (err) {
          console.error('[ProjectPage] Failed to persist detected app type:', err)
        }
      }

      initialSyncDone.current = true
      lastSyncedFileTree.current = fileTreeFingerprint
    }

    syncFilesToWorkbench()

    // Cleanup: mark this effect as cancelled if dependencies change
    return () => {
      isCancelled = true
    }
  }, [fileTree, syncStatus, project, storeProjectId, projectPath])

  // Incremental file sync - only updates changed files, not the entire tree
  // This is much faster than re-reading all files on every change
  useEffect(() => {
    // Only run after initial sync is done
    if (!initialSyncDone.current || syncStatus !== 'ready' || !project) return
    if (storeProjectId !== project.id || !isPathForProject(projectPath, project.id)) return
    // Skip the first run (initial sync handles it)
    if (lastFileChange === 0) return

    // Get the changed file paths from projectStore's invalidated cache
    // When a file changes, projectStore invalidates it from openFiles cache
    // We just need to check which files are no longer in cache and reload them
    const currentFiles = workbenchStore.files.getState()
    const openFilesCache = projectStore.openFiles.getState()

    // Find files that were invalidated (in workbench but not in projectStore cache)
    const invalidatedFiles = Object.keys(currentFiles).filter(
      path => currentFiles[path]?.type === 'file' && !openFilesCache[path]
    )

    if (invalidatedFiles.length === 0) {
      // Check for new files in fileTree that aren't in workbench
      const workbenchPaths = new Set(Object.keys(currentFiles))
      const newFiles = fileTree.filter(
        node => node.type === 'file' && !workbenchPaths.has(node.path)
      )

      if (newFiles.length === 0) return

      // Load new files
      const loadNewFiles = async () => {
        for (const node of newFiles) {
          try {
            const openFile = await projectStore.openFile(node.path)
            workbenchStore.updateFileEntry(node.path, {
              type: 'file',
              content: openFile.content,
              isBinary: openFile.isBinary,
            })
          } catch (err) {
            console.error(`[ProjectPage] Failed to load new file: ${node.path}`, err)
          }
        }
        console.log(`[ProjectPage] Incremental sync: ${newFiles.length} new files added`)
      }
      loadNewFiles()
      return
    }

    // Reload only the invalidated files
    const reloadInvalidatedFiles = async () => {
      for (const path of invalidatedFiles) {
        try {
          const openFile = await projectStore.openFile(path)
          workbenchStore.updateFileEntry(path, {
            type: 'file',
            content: openFile.content,
            isBinary: openFile.isBinary,
          })
        } catch (err) {
          console.error(`[ProjectPage] Failed to reload file: ${path}`, err)
        }
      }
      console.log(`[ProjectPage] Incremental sync: ${invalidatedFiles.length} files reloaded`)
    }

    reloadInvalidatedFiles()
  }, [lastFileChange, syncStatus, project, fileTree, storeProjectId, projectPath])

  // Set up project metadata - files are handled separately by the sync effect above
  // This uses setProjectMetadata to avoid race conditions where setProject clears files
  // before the async file sync completes
  useEffect(() => {
    if (!project) return

    // Wait until sync is ready (files loaded from git clone)
    if (syncStatus !== 'ready') {
      return
    }

    // Use setProjectMetadata to ONLY set project info and messages
    // Files are managed separately via the sync effect and projectStore
    workbenchStore.setProjectMetadata(project)
  }, [project, syncStatus])

  // Note: Session saving is now handled directly by Chat component via useSaveSession hook
  // This follows Remix-like architecture where components manage their own data

  // Loading state
  if (isLoading) {
    return (
      <div className="project-page">
        <div className="project-loading">
          <Loader2 className="animate-spin" size={32} />
          <span>Loading project...</span>
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="project-page">
        <div className="project-error">
          <h2>Error</h2>
          <p>{error?.message || 'Project not found'}</p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft size={16} />
            Back to Home
          </Button>
        </div>
      </div>
    )
  }

  // Show sync error (but not 'opening' - that's handled by progressive loading)
  if (syncStatus === 'error') {
    return (
      <div className="project-page">
        <div className="project-error">
          <h2>Git Error</h2>
          <p>{storeError || 'Failed to clone repository'}</p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft size={16} />
            Back to Home
          </Button>
        </div>
      </div>
    )
  }

  // Extract Convex fields from project
  const { convexDeployment, convexDeploymentKey, convexUrl } = project || {}
  // For local-first, Convex integration is manual via env vars
  const hasConvexIntegration = !!convexDeploymentKey
  const alignedProjectPath =
    storeProjectId === project.id && isPathForProject(projectPath, project.id)
      ? projectPath
      : null

  // Progressive loading: render content immediately, pass syncStatus for per-section loading states
  // - Chat renders immediately (shows "preparing workspace" if projectPath is null)
  // - Workbench tabs show loading states based on syncStatus
  return (
    <motion.div
      className="project-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Content - renders immediately, components handle their own loading states */}
      <ProjectContent
        project={project}
        hasConvexIntegration={hasConvexIntegration}
        convexDeploymentKey={convexDeploymentKey}
        convexUrl={convexUrl}
        convexDeployment={convexDeployment}
        projectPath={alignedProjectPath}
        storeProjectId={storeProjectId}
        syncStatus={syncStatus}
        initialProvider={initialProvider}
        initialModel={initialModel}
        initialImages={initialImages}
      />
    </motion.div>
  )
}

export default function ProjectPage() {
  return <ProjectPageContent />
}
