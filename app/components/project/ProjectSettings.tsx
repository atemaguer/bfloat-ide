import { useState, useEffect } from 'react'
import { AlertCircle, Eye, EyeOff, Globe, Key, Loader2, Lock, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { MobileOnly } from '@/app/components/common/FeatureGate'
import type { Project } from '@/app/types/project'
import { Input, Textarea } from '@/app/components/ui/input'
import { Button } from '@/app/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { ImageDropzone } from '@/app/components/ui/image-dropzone'
import { Switch } from '@/app/components/ui/Switch'
import { localProjectsStore } from '@/app/stores/local-projects'
import { useStore } from '@/app/hooks/useStore'
import { workbenchStore } from '@/app/stores/workbench'
import { SecretModal } from '@/app/components/settings/sections/SecretModal'
import {
  IntegrationCredentialsModal,
  type IntegrationSaveResult,
} from '@/app/components/settings/sections/IntegrationCredentialsModal'
import { secrets as secretsApi, projectFiles } from '@/app/api/sidecar'
import { isConvexSecretKey } from '@/app/lib/integrations/secrets'
import { detectConvexBootstrap, getConvexSecretStatusFromSecrets } from '@/app/lib/integrations/convex'
import { getRequiredSecretKeys, hasRequiredSecrets, type ConnectIntegrationId } from '@/app/lib/integrations/credentials'
import './styles.css'

interface ProjectSettingsProps {
  project: Project
  onProjectUpdate?: (project: Project) => void
}

const REVENUECAT_API_KEY = 'REVENUECAT_API_KEY'
const STRIPE_SETUP_PROMPT = 'Use the /add-stripe skill to set up Stripe payments integration for this project'
const REVENUECAT_SETUP_PROMPT = 'Use the /add-revenuecat skill to set up RevenueCat in-app purchases for this project'

export function ProjectSettings({ project, onProjectUpdate }: ProjectSettingsProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Form state
  const [title, setTitle] = useState(project.title || '')
  const [slug, setSlug] = useState(project.slug || '')
  const [iosBundleId, setIosBundleId] = useState(project.iosBundleId || '')
  const [iosAppId, setIosAppId] = useState(project.iosAppId || '')
  const [androidPackageName, setAndroidPackageName] = useState(project.androidPackageName || '')
  const [isPublic, setIsPublic] = useState(project.isPublic || false)
  const [agentInstructions, setAgentInstructions] = useState(project.agentInstructions || '')

  // App icon state
  const [iosAppIcon, setIosAppIcon] = useState<File | null>(null)
  const [androidAppIcon, setAndroidAppIcon] = useState<File | null>(null)
  const [iosAppIconPreview, setIosAppIconPreview] = useState<string | null>(project.iosAppIconUrl || null)
  const [androidAppIconPreview, setAndroidAppIconPreview] = useState<string | null>(project.androidAppIconUrl || null)

  // Secrets state
  interface Secret {
    key: string
    value: string
  }
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(true)
  const [secretsError, setSecretsError] = useState<string | null>(null)
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set())
  const [isSecretModalOpen, setIsSecretModalOpen] = useState(false)
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null)
  const [secretModalDefaultKey, setSecretModalDefaultKey] = useState<string | null>(null)
  const [isIntegrationModalOpen, setIsIntegrationModalOpen] = useState(false)
  const [activeIntegrationId, setActiveIntegrationId] = useState<ConnectIntegrationId | null>(null)
  const [deletingSecretKey, setDeletingSecretKey] = useState<string | null>(null)
  const pendingIntegrationConnect = useStore(workbenchStore.pendingIntegrationConnect)
  const files = useStore(workbenchStore.files)
  const normalizedAppType: 'web' | 'mobile' =
    project.appType === 'nextjs' || project.appType === 'vite' || project.appType === 'node' || project.appType === 'web'
      ? 'web'
      : 'mobile'
  const requiredStripeKeys = getRequiredSecretKeys('stripe', normalizedAppType)

  const validateSecretWriteTarget = (
    result: { projectId?: string; writePath?: string },
    actionLabel: string
  ): boolean => {
    if (!project.id) return true

    if (result.projectId && result.projectId !== project.id) {
      const msg = `${actionLabel} targeted ${result.projectId}, but active project is ${project.id}.`
      console.error('[ProjectSettings]', msg, result)
      setSecretsError(msg)
      toast.error('Secret save targeted a different project. Please reload the project.')
      return false
    }

    if (result.writePath && !result.writePath.includes(project.id)) {
      const msg = `${actionLabel} wrote to ${result.writePath}, which does not match active project ${project.id}.`
      console.error('[ProjectSettings]', msg, result)
      setSecretsError(msg)
      toast.error('Secret write path does not match active project. Please reload the project.')
      return false
    }

    return true
  }

  // Sync form with updated project prop
  useEffect(() => {
    setTitle(project.title || '')
    setSlug(project.slug || '')
    setIosBundleId(project.iosBundleId || '')
    setIosAppId(project.iosAppId || '')
    setAndroidPackageName(project.androidPackageName || '')
    setIsPublic(project.isPublic || false)
    setAgentInstructions(project.agentInstructions || '')
    setIosAppIconPreview(project.iosAppIconUrl || null)
    setAndroidAppIconPreview(project.androidAppIconUrl || null)
  }, [project])

  // Load secrets
  const loadSecrets = async () => {
    if (!project.id) {
      setSecrets([])
      setIsLoadingSecrets(false)
      return
    }

    try {
      setIsLoadingSecrets(true)
      setSecretsError(null)
      const result = await secretsApi.readSecrets(project.id)
      if (result.error) {
        setSecretsError(result.error)
      } else {
        setSecrets(result.secrets)
      }
    } catch (err) {
      setSecretsError(err instanceof Error ? err.message : 'Failed to load secrets')
    } finally {
      setIsLoadingSecrets(false)
    }
  }

  useEffect(() => {
    loadSecrets()
  }, [project.id])

  const handleAddSecret = () => {
    setEditingSecret(null)
    setSecretModalDefaultKey(null)
    setIsSecretModalOpen(true)
  }

  const handleEditSecret = (secret: Secret) => {
    setEditingSecret(secret)
    setSecretModalDefaultKey(null)
    setIsSecretModalOpen(true)
  }

  // Handle "Connect integration" requests from chat/workbench by opening
  // the integration credentials modal with all required fields.
  useEffect(() => {
    if (!pendingIntegrationConnect || isLoadingSecrets) return

    setActiveIntegrationId(pendingIntegrationConnect.integrationId)
    setIsIntegrationModalOpen(true)
    workbenchStore.clearPendingIntegrationConnect()
  }, [pendingIntegrationConnect, isLoadingSecrets])

  const handleSaveSecret = async (key: string, value: string) => {
    if (!project.id) return

    const nextValue = value.trim()
    const previousSecret = secrets.find((s) => s.key === key)
    const previousValue = previousSecret?.value.trim() || ''
    const isChanged = previousValue !== nextValue

    const result = await secretsApi.setSecret(project.id, key, value)
    if (!result.success) {
      throw new Error(result.error || 'Failed to save secret')
    }
    if (!validateSecretWriteTarget(result, `Saving ${key}`)) {
      return
    }

    await loadSecrets()
    workbenchStore.bumpSecretsVersion()
    if (isChanged && nextValue) {
      workbenchStore.mergePendingEnvVars({ [key]: nextValue })
    }

    // Auto-run Convex setup only when URL + deploy key are both present.
    if (isConvexSecretKey(key) && isChanged) {
      const nextSecrets = secrets.filter((secret) => secret.key !== key)
      if (nextValue) {
        nextSecrets.push({ key, value: nextValue })
      }

      const convexSecrets = getConvexSecretStatusFromSecrets(nextSecrets, normalizedAppType)
      if (!convexSecrets.hasUrl) {
        toast('Add your Convex URL first before running setup.', { icon: 'ℹ️' })
      } else if (!convexSecrets.hasDeployKey) {
        toast('Convex URL saved. Add CONVEX_DEPLOY_KEY to run setup.', { icon: 'ℹ️' })
      } else if (!detectConvexBootstrap(files)) {
        workbenchStore.triggerChatPrompt('Use the /convex-setup skill to set up Convex backend integration for this project')
        toast.success('Convex credentials saved. Starting Convex setup in chat...')
      } else {
        toast.success('Convex credentials updated.')
      }
    }

    if (key === REVENUECAT_API_KEY && isChanged && nextValue) {
      workbenchStore.triggerChatPrompt(REVENUECAT_SETUP_PROMPT, {
        integrationId: 'revenuecat',
        projectId: project.id,
        requiredSecretKeys: [REVENUECAT_API_KEY],
        waitForSecrets: true,
        timeoutMs: 8000,
      })
      toast.success('RevenueCat key saved. Starting RevenueCat setup in chat...')
    }

    if (requiredStripeKeys.includes(key) && isChanged && nextValue) {
      const nextSecretKeys = new Set(secrets.map((secret) => secret.key))
      nextSecretKeys.add(key)
      const hasStripeKeys = hasRequiredSecrets([...nextSecretKeys], 'stripe', normalizedAppType)

      if (hasStripeKeys) {
        workbenchStore.triggerChatPrompt(STRIPE_SETUP_PROMPT, {
          integrationId: 'stripe',
          projectId: project.id,
          requiredSecretKeys: requiredStripeKeys,
          waitForSecrets: true,
          timeoutMs: 8000,
        })
        toast.success('Stripe credentials saved. Starting Stripe setup in chat...')
      }
    }
  }

  const handleSaveIntegrationSecrets = async (
    entries: Array<{ key: string; value: string }>
  ): Promise<IntegrationSaveResult> => {
    if (!project.id || !activeIntegrationId) {
      return {
        successes: [],
        failures: entries.map((entry) => ({
          key: entry.key,
          error: 'Project is not ready',
        })),
      }
    }

    const successes: string[] = []
    const failures: Array<{ key: string; error: string }> = []

    for (const entry of entries) {
      const result = await secretsApi.setSecret(project.id, entry.key, entry.value)
      if (result.success) {
        if (!validateSecretWriteTarget(result, `Saving ${entry.key}`)) {
          failures.push({
            key: entry.key,
            error: 'Secret write target mismatch',
          })
          continue
        }
        successes.push(entry.key)
      } else {
        failures.push({
          key: entry.key,
          error: result.error || 'Failed to save',
        })
      }
    }

    if (successes.length > 0) {
      await loadSecrets()
      workbenchStore.bumpSecretsVersion()
      const pendingEnv: Record<string, string> = {}
      for (const entry of entries) {
        if (successes.includes(entry.key) && entry.value.trim()) {
          pendingEnv[entry.key] = entry.value.trim()
        }
      }
      if (Object.keys(pendingEnv).length > 0) {
        workbenchStore.mergePendingEnvVars(pendingEnv)
      }
    }

    if (activeIntegrationId === 'convex' && successes.length > 0) {
      const result = await secretsApi.readSecrets(project.id)
      const nextSecrets = result.secrets || []
      const convexSecrets = getConvexSecretStatusFromSecrets(nextSecrets, normalizedAppType)

      if (!convexSecrets.hasUrl) {
        toast('Add your Convex URL first before running setup.', { icon: 'ℹ️' })
      } else if (!convexSecrets.hasDeployKey) {
        toast('Convex URL saved. Add CONVEX_DEPLOY_KEY to run setup.', { icon: 'ℹ️' })
      } else if (!detectConvexBootstrap(files)) {
        workbenchStore.triggerChatPrompt('Use the /convex-setup skill to set up Convex backend integration for this project')
        toast.success('Convex credentials saved. Starting Convex setup in chat...')
      } else {
        toast.success('Convex credentials updated.')
      }
    }

    if (activeIntegrationId === 'revenuecat' && successes.length > 0) {
      const result = await secretsApi.readSecrets(project.id)
      const secretKeys = (result.secrets || []).map((secret) => secret.key)
      const hasRevenuecatKey = hasRequiredSecrets(secretKeys, 'revenuecat', normalizedAppType)

      if (hasRevenuecatKey) {
        workbenchStore.triggerChatPrompt(REVENUECAT_SETUP_PROMPT, {
          integrationId: 'revenuecat',
          projectId: project.id,
          requiredSecretKeys: [REVENUECAT_API_KEY],
          waitForSecrets: true,
          timeoutMs: 8000,
        })
        toast.success('RevenueCat credentials saved. Starting RevenueCat setup in chat...')
      }
    }

    if (activeIntegrationId === 'stripe' && successes.length > 0) {
      const result = await secretsApi.readSecrets(project.id)
      const secretKeys = (result.secrets || []).map((secret) => secret.key)
      const hasStripeKeys = hasRequiredSecrets(secretKeys, 'stripe', normalizedAppType)

      if (hasStripeKeys) {
        workbenchStore.triggerChatPrompt(STRIPE_SETUP_PROMPT, {
          integrationId: 'stripe',
          projectId: project.id,
          requiredSecretKeys: requiredStripeKeys,
          waitForSecrets: true,
          timeoutMs: 8000,
        })
        toast.success('Stripe credentials saved. Starting Stripe setup in chat...')
      }
    }

    if (successes.length > 0 && activeIntegrationId !== 'convex' && activeIntegrationId !== 'revenuecat' && activeIntegrationId !== 'stripe') {
      toast.success('Integration credentials saved.')
    }

    return { successes, failures }
  }

  const handleDeleteSecret = async (key: string) => {
    if (!project.id) return

    setDeletingSecretKey(key)
    try {
      const result = await secretsApi.deleteSecret(project.id, key)
      if (!result.success) {
        setSecretsError(result.error || 'Failed to delete secret')
      } else {
        await loadSecrets()
        workbenchStore.bumpSecretsVersion()
      }
    } catch (err) {
      setSecretsError(err instanceof Error ? err.message : 'Failed to delete secret')
    } finally {
      setDeletingSecretKey(null)
    }
  }

  const toggleSecretVisibility = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const maskValue = (value: string) => {
    return '\u2022'.repeat(Math.min(value.length, 24))
  }

  const handleIosAppIconChange = (file: File | null) => {
    setIosAppIcon(file)
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setIosAppIconPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else {
      setIosAppIconPreview(null)
    }
  }

  const handleAndroidAppIconChange = (file: File | null) => {
    setAndroidAppIcon(file)
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setAndroidAppIconPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else {
      setAndroidAppIconPreview(null)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      const updates: Partial<Project> = {
        title,
        slug,
        iosBundleId,
        iosAppId,
        androidPackageName,
        isPublic,
        agentInstructions,
      }

      await localProjectsStore.update(project.id, updates)
      const synced = await projectFiles.syncAgentInstructions(agentInstructions)
      if (!synced) {
        toast.error('Saved settings, but failed to sync AGENTS.md/CLAUDE.md')
      }

      const updatedProject: Project = { ...project, ...updates, updatedAt: new Date().toISOString() }

      if (onProjectUpdate) {
        onProjectUpdate(updatedProject)
      }

      toast.success('Project settings saved')
    } catch (error) {
      console.error('Error saving project settings:', error)
      toast.error('Failed to save project settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteProject = async () => {
    setIsDeleting(true)

    try {
      await localProjectsStore.delete(project.id)
      toast.success('Project deleted')
      setTimeout(() => {
        window.location.href = '/'
      }, 1000)
    } catch (error) {
      console.error('Error deleting project:', error)
      toast.error('Failed to delete project')
      setShowDeleteDialog(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="project-settings">
      <div className="project-settings-header">
        <h2>Project Settings</h2>
        <p className="project-settings-description">
          Configure your project settings and deployment options.
        </p>
        <div className="project-settings-badges">
          <span className="badge">{project.title}</span>
          {isPublic ? (
            <span className="badge badge-public">
              <Globe size={12} /> Public
            </span>
          ) : (
            <span className="badge badge-private">
              <Lock size={12} /> Private
            </span>
          )}
        </div>
      </div>

      <form className="project-settings-form" onSubmit={handleSaveSettings}>
        <Card className="settings-card">
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>Basic information about your project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="settings-grid">
              <div className="settings-field">
                <label htmlFor="title">Project Title</label>
                <Input
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter project title"
                  required
                />
              </div>

              <div className="settings-field">
                <label htmlFor="slug">Project URL Slug</label>
                <Input
                  id="slug"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-app-name"
                  required
                />
              </div>

              <MobileOnly>
                <div className="settings-field">
                  <label htmlFor="iosBundleId">iOS Bundle Identifier</label>
                  <Input
                    id="iosBundleId"
                    type="text"
                    value={iosBundleId}
                    onChange={(e) => setIosBundleId(e.target.value)}
                    placeholder="com.example.myapp"
                  />
                </div>
              </MobileOnly>

              <MobileOnly>
                <div className="settings-field">
                  <label htmlFor="iosAppId">iOS App ID</label>
                  <Input
                    id="iosAppId"
                    type="text"
                    value={iosAppId}
                    onChange={(e) => setIosAppId(e.target.value)}
                    placeholder="com.example.myapp"
                  />
                </div>
              </MobileOnly>

              <MobileOnly>
                <div className="settings-field">
                  <label htmlFor="androidPackageName">Android Package Name</label>
                  <Input
                    id="androidPackageName"
                    type="text"
                    value={androidPackageName}
                    onChange={(e) => setAndroidPackageName(e.target.value)}
                    placeholder="com.example.myapp"
                  />
                </div>
              </MobileOnly>
            </div>

            <div className="settings-section">
              <h3>Agent Instructions</h3>
              <div className="settings-field">
                <label htmlFor="agentInstructions">Shared Instructions for Claude + Codex</label>
                <Textarea
                  id="agentInstructions"
                  value={agentInstructions}
                  onChange={(e) => setAgentInstructions(e.target.value)}
                  placeholder="Add project-specific instructions for both agents..."
                  className="min-h-[140px] font-mono text-xs"
                />
              </div>
            </div>

            <MobileOnly>
              <div className="settings-section">
                <h3>App Icons</h3>
                <div className="app-icons-grid">
                  <ImageDropzone
                    onImageChange={handleIosAppIconChange}
                    imageUrl={iosAppIconPreview || undefined}
                    label="iOS App Store Icon"
                    helpText="for iOS App Store"
                    maxSize="1024 x 1024px"
                  />

                  <ImageDropzone
                    onImageChange={handleAndroidAppIconChange}
                    imageUrl={androidAppIconPreview || undefined}
                    label="Google Play Store Icon"
                    helpText="for Google Play Store"
                    maxSize="512 x 512px"
                  />
                </div>
              </div>
            </MobileOnly>
          </CardContent>
        </Card>

        <Card className="settings-card">
          <CardHeader>
            <CardTitle>Visibility Settings</CardTitle>
            <CardDescription>Control who can see your project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="visibility-setting">
              <div className="visibility-info">
                <label htmlFor="project-visibility">Project Access</label>
                <div className="visibility-description">
                  {isPublic ? (
                    <span className="visibility-status visibility-public">
                      <Globe size={14} />
                      Anyone can view this project
                    </span>
                  ) : (
                    <span className="visibility-status visibility-private">
                      <Lock size={14} />
                      Only you can access this project
                    </span>
                  )}
                </div>
              </div>
              <Switch
                id="project-visibility"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="settings-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Development Variables</CardTitle>
                <CardDescription>Environment variables used during local development</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddSecret}
                className="gap-1.5"
              >
                <Plus size={14} />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {secretsError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive mb-4">
                {secretsError}
              </div>
            )}
            {isLoadingSecrets ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="animate-spin text-muted-foreground mr-2" />
                <span className="text-sm text-muted-foreground">Loading secrets...</span>
              </div>
            ) : secrets.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <Key size={32} className="text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground">No secrets configured</span>
                <span className="text-xs text-muted-foreground/70">
                  Add API keys for Stripe, Convex, and more
                </span>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border -mx-6">
                {secrets.map((secret) => (
                  <div
                    key={secret.key}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground font-mono">
                        {secret.key}
                      </span>
                      <span className="text-sm text-muted-foreground font-mono truncate">
                        {visibleSecrets.has(secret.key) ? secret.value : maskValue(secret.value)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <button
                        type="button"
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        onClick={() => toggleSecretVisibility(secret.key)}
                        title={visibleSecrets.has(secret.key) ? 'Hide value' : 'Show value'}
                      >
                        {visibleSecrets.has(secret.key) ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        onClick={() => handleEditSecret(secret)}
                        title="Edit secret"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={() => handleDeleteSecret(secret.key)}
                        disabled={deletingSecretKey === secret.key}
                        title="Delete secret"
                      >
                        {deletingSecretKey === secret.key ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="settings-actions">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 size={16} className="spinner" />
                Saving Changes...
              </>
            ) : (
              <>
                <Save size={16} />
                Save Changes
              </>
            )}
          </Button>
        </div>

        <div className="danger-zone">
          <h3 className="danger-zone-title">
            <AlertCircle size={16} />
            Danger Zone
          </h3>
          <Card className="settings-card danger-card">
            <CardHeader>
              <CardTitle className="danger-card-title">Delete Project</CardTitle>
              <CardDescription>This action cannot be undone</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="danger-description">
                Deleting this project will permanently remove all associated data, deployments, and configurations.
              </p>
              <div className="danger-actions">
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 size={16} />
                  Delete Project
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="dialog-title-danger">
              <AlertCircle size={20} />
              Delete Project
            </DialogTitle>
          </DialogHeader>
          <div className="dialog-body">
            <p className="dialog-description">
              Are you sure you want to delete this project? This action{' '}
              <strong>cannot be undone</strong>.
            </p>
            <div className="delete-warning">
              <p className="delete-warning-title">You will lose:</p>
              <ul className="delete-warning-list">
                <li>All project files and code</li>
                <li>Deployment configurations</li>
                <li>App icons and assets</li>
                <li>Integration settings</li>
              </ul>
            </div>
          </div>
          <div className="dialog-actions">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteProject}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 size={16} className="spinner" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Yes, Delete Project
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SecretModal
        open={isSecretModalOpen}
        onOpenChange={setIsSecretModalOpen}
        onSave={handleSaveSecret}
        existingSecrets={secrets}
        editingSecret={editingSecret}
        defaultKey={secretModalDefaultKey}
      />
      <IntegrationCredentialsModal
        open={isIntegrationModalOpen}
        onOpenChange={setIsIntegrationModalOpen}
        integrationId={activeIntegrationId}
        appType={normalizedAppType}
        existingSecrets={secrets}
        onSaveMany={handleSaveIntegrationSecrets}
      />
    </div>
  )
}
