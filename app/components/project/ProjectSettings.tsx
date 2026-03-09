import { useState, useEffect, useRef } from 'react'
import { AlertCircle, Eye, EyeOff, GitBranch, Globe, Key, Loader2, Lock, Pencil, Plus, Save, Trash2 } from 'lucide-react'
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
import { themeStore } from '@/app/stores/theme'
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

type GitAuthPromptType = 'https_username' | 'https_password' | 'ssh_passphrase' | 'otp' | 'yes_no' | 'unknown'

interface GitAuthPrompt {
  type: GitAuthPromptType
  confidence: number
  context: string
  suggestion?: string
}

interface GitErrorGuidance {
  title: string
  steps: string[]
}

interface GitConnectDiagnostics {
  success: boolean
  remoteUrl?: string
  remoteType?: 'ssh' | 'https' | 'other'
  sshAgentHasIdentities?: boolean | null
  remoteReachable?: boolean | null
  probeError?: string
  suggestedHttpsUrl?: string
  error?: string
}

const REVENUECAT_API_KEY = 'REVENUECAT_API_KEY'
const STRIPE_SETUP_PROMPT = 'Use the /add-stripe skill to set up Stripe payments integration for this project'
const REVENUECAT_SETUP_PROMPT = 'Use the /add-revenuecat skill to set up RevenueCat in-app purchases for this project'

const getGitErrorGuidance = (message: string): GitErrorGuidance | null => {
  const text = message.toLowerCase()

  if (
    text.includes('no identities are loaded in ssh-agent') ||
    text.includes('no usable ssh key was found')
  ) {
    return {
      title: 'SSH key is not loaded',
      steps: [
        'Load your key: ssh-add ~/.ssh/<your-key>',
        'Try Connect Remote again',
        'If SSH is not available, switch to an HTTPS repository URL and use a token',
      ],
    }
  }

  if (text.includes('repository not found or ssh authentication failed')) {
    return {
      title: 'SSH connection could not be authenticated',
      steps: [
        'Confirm the repository URL is correct: git@github.com:<owner>/<repo>.git',
        'Load your SSH key: ssh-add ~/.ssh/<your-key>',
        'Retry Connect Remote, or switch to HTTPS + token if preferred',
      ],
    }
  }

  if (text.includes('https authentication failed')) {
    return {
      title: 'HTTPS credentials were rejected',
      steps: [
        'Verify your username and personal access token',
        'Retry Connect Remote and enter credentials when prompted',
        'If 2FA is enabled, complete OTP/code prompts',
      ],
    }
  }

  return null
}

const toHttpsRemoteUrl = (remoteUrl: string): string | null => {
  const trimmed = remoteUrl.trim()
  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/i)
  if (scpLikeMatch) {
    const [, host, repoPath] = scpLikeMatch
    return `https://${host}/${repoPath}`
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@([^/]+)\/(.+)$/i)
  if (sshUrlMatch) {
    const [, host, repoPath] = sshUrlMatch
    return `https://${host}/${repoPath}`
  }

  return null
}

export function ProjectSettings({ project, onProjectUpdate }: ProjectSettingsProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isUpdatingGit, setIsUpdatingGit] = useState(false)
  const [gitConnectError, setGitConnectError] = useState<string | null>(null)
  const [gitConnectSuccess, setGitConnectSuccess] = useState<string | null>(null)
  const [gitConnectSessionId, setGitConnectSessionId] = useState<string | null>(null)
  const [gitAuthPrompt, setGitAuthPrompt] = useState<GitAuthPrompt | null>(null)
  const [gitAuthInput, setGitAuthInput] = useState('')
  const [gitOtpInput, setGitOtpInput] = useState('')
  const [gitConnectLogTail, setGitConnectLogTail] = useState('')
  const [isRunningGitDiagnostics, setIsRunningGitDiagnostics] = useState(false)
  const [gitDiagnostics, setGitDiagnostics] = useState<GitConnectDiagnostics | null>(null)
  const gitConnectUnsubscribeRef = useRef<(() => void) | null>(null)
  const gitConnectSessionIdRef = useRef<string | null>(null)

  // Form state
  const [title, setTitle] = useState(project.title || '')
  const [slug, setSlug] = useState(project.slug || '')
  const [iosBundleId, setIosBundleId] = useState(project.iosBundleId || '')
  const [iosAppId, setIosAppId] = useState(project.iosAppId || '')
  const [androidPackageName, setAndroidPackageName] = useState(project.androidPackageName || '')
  const [isPublic, setIsPublic] = useState(project.isPublic || false)
  const [agentInstructions, setAgentInstructions] = useState(project.agentInstructions || '')
  const [gitRemoteUrl, setGitRemoteUrl] = useState(project.sourceUrl || '')
  const [gitRemoteBranch, setGitRemoteBranch] = useState(project.sourceBranch || 'main')
  const [connectedGitRemoteUrl, setConnectedGitRemoteUrl] = useState(project.sourceUrl || '')

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
  const resolvedTheme = useStore(themeStore.resolvedTheme)
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
    setGitRemoteUrl(project.sourceUrl || '')
    setGitRemoteBranch(project.sourceBranch || 'main')
    setConnectedGitRemoteUrl(project.sourceUrl || '')
    setIosAppIconPreview(project.iosAppIconUrl || null)
    setAndroidAppIconPreview(project.androidAppIconUrl || null)
  }, [project])

  const isGitConnected = Boolean(connectedGitRemoteUrl.trim())
  const gitErrorGuidance = gitConnectError ? getGitErrorGuidance(gitConnectError) : null
  const gitDiagnosticsTextColor = resolvedTheme === 'dark' ? '#fef3c7' : '#78350f'
  const gitDiagnosticsTitleColor = resolvedTheme === 'dark' ? '#fde68a' : '#422006'
  const autoFixHttpsUrl = toHttpsRemoteUrl(gitRemoteUrl)
  const canAutoFixToHttps =
    Boolean(autoFixHttpsUrl) &&
    Boolean(gitConnectError) &&
    /ssh|repository not found/i.test(gitConnectError || '')

  const isValidGitRemoteUrl = (value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) return false
    if (/^https?:\/\/\S+$/i.test(trimmed)) return true
    if (/^git@\S+:\S+$/i.test(trimmed)) return true
    if (/^ssh:\/\/\S+$/i.test(trimmed)) return true
    return false
  }

  const isValidGitBranchName = (value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) return false
    if (trimmed.includes(' ')) return false
    if (trimmed.startsWith('/') || trimmed.endsWith('/')) return false
    if (trimmed.includes('..')) return false
    return true
  }

  const updateGitRemote = async (nextSourceUrl: string | null, nextSourceBranch: string | null) => {
    const normalizedSourceUrl = nextSourceUrl?.trim() || null
    const normalizedSourceBranch = nextSourceBranch?.trim() || null

    await localProjectsStore.update(project.id, {
      sourceUrl: normalizedSourceUrl,
      sourceBranch: normalizedSourceBranch,
    })
    const updatedProject: Project = {
      ...project,
      sourceUrl: normalizedSourceUrl,
      sourceBranch: normalizedSourceBranch,
      updatedAt: new Date().toISOString(),
    }

    workbenchStore.setProjectMetadata(updatedProject)
    setGitRemoteUrl(normalizedSourceUrl || '')
    setGitRemoteBranch(normalizedSourceBranch || 'main')
    setConnectedGitRemoteUrl(normalizedSourceUrl || '')

    if (onProjectUpdate) {
      onProjectUpdate(updatedProject)
    }
  }

  const handleConnectGit = async (overrides?: { remoteUrl?: string; remoteBranch?: string }) => {
    const nextUrl = (overrides?.remoteUrl ?? gitRemoteUrl).trim()
    const nextBranch = (overrides?.remoteBranch ?? gitRemoteBranch).trim() || 'main'

    if (!isValidGitRemoteUrl(nextUrl)) {
      setGitConnectError('Enter a valid Git repository URL (HTTPS or SSH).')
      return
    }
    if (!isValidGitBranchName(nextBranch)) {
      setGitConnectError('Enter a valid branch name.')
      return
    }

    setIsUpdatingGit(true)
    setGitConnectError(null)
    setGitConnectSuccess(null)
    setGitDiagnostics(null)
    setGitAuthPrompt(null)
    setGitAuthInput('')
    setGitOtpInput('')
    setGitConnectLogTail('')

    try {
      const startResult = await projectFiles.startGitConnect(project.id, nextUrl, nextBranch)
      if (!startResult.success || !startResult.sessionId) {
        throw new Error(startResult.error || 'Failed to start Git connection flow')
      }

      const sessionId = startResult.sessionId
      setGitConnectSessionId(sessionId)
      gitConnectSessionIdRef.current = sessionId

      await new Promise<void>((resolve, reject) => {
        const unsubscribe = projectFiles.streamGitConnect(sessionId, {
          onLog: (chunk: string) => {
            if (!chunk) return
            setGitConnectLogTail((prev) => (prev + chunk).slice(-4000))
          },
          onInteractiveAuth: (event: GitAuthPrompt) => {
            setGitConnectError(null)
            setGitAuthPrompt(event)
            setGitAuthInput('')
            if (event.type !== 'otp') {
              setGitOtpInput('')
            }
          },
          onComplete: async (result: { success: boolean; error?: string }) => {
            gitConnectUnsubscribeRef.current?.()
            gitConnectUnsubscribeRef.current = null
            setGitConnectSessionId(null)
            gitConnectSessionIdRef.current = null
            setGitAuthPrompt(null)
            setGitAuthInput('')
            setGitOtpInput('')

            if (!result.success) {
              reject(new Error(result.error || 'Failed to connect Git repository'))
              return
            }

            try {
              await updateGitRemote(nextUrl, nextBranch)
              resolve()
            } catch (error) {
              reject(error instanceof Error ? error : new Error('Failed to save Git connection metadata'))
            }
          },
        })

        gitConnectUnsubscribeRef.current = unsubscribe
      })

      setGitConnectSuccess('Git repository connected.')
      toast.success('Git repository connected')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect Git repository'
      setGitConnectError(message)
      toast.error(message)
    } finally {
      setIsUpdatingGit(false)
    }
  }

  const handleAutoFixToHttps = async () => {
    if (!autoFixHttpsUrl) return

    setGitRemoteUrl(autoFixHttpsUrl)
    setGitConnectError(null)
    setGitConnectSuccess(null)
    setGitDiagnostics(null)
    await handleConnectGit({ remoteUrl: autoFixHttpsUrl })
  }

  const handleRunGitDiagnostics = async () => {
    const nextUrl = gitRemoteUrl.trim()
    if (!isValidGitRemoteUrl(nextUrl)) {
      setGitConnectError('Enter a valid Git repository URL (HTTPS or SSH).')
      return
    }

    setIsRunningGitDiagnostics(true)
    setGitConnectError(null)
    setGitConnectSuccess(null)
    setGitDiagnostics(null)
    try {
      const result = await projectFiles.runGitConnectDiagnostics(project.id, nextUrl)
      if (!result.success) {
        throw new Error(result.error || 'Failed to run Git diagnostics')
      }
      setGitDiagnostics(result)
      toast.success('Git diagnostics complete')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run Git diagnostics'
      setGitConnectError(message)
      toast.error(message)
    } finally {
      setIsRunningGitDiagnostics(false)
    }
  }

  const handleDisconnectGit = async () => {
    setIsUpdatingGit(true)
    setGitConnectError(null)
    setGitConnectSuccess(null)
    setGitDiagnostics(null)
    try {
      await updateGitRemote(null, null)
      setGitConnectSuccess('Git repository disconnected.')
      toast.success('Git repository disconnected')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect Git repository'
      setGitConnectError(message)
      toast.error(message)
    } finally {
      setIsUpdatingGit(false)
    }
  }

  const submitGitAuthInput = async (value: string) => {
    if (!gitConnectSessionId || !gitAuthPrompt) return
    const trimmed = value.trim()
    if (!trimmed) return

    const result = await projectFiles.submitGitConnectInput(gitConnectSessionId, `${trimmed}\n`)
    if (!result.success) {
      setGitConnectError(result.error || 'Failed to submit authentication input')
      return
    }

    setGitAuthPrompt(null)
    setGitAuthInput('')
    if (gitAuthPrompt.type === 'otp') {
      setGitOtpInput('')
    }
  }

  const cancelGitConnect = async () => {
    if (!gitConnectSessionId) return
    await projectFiles.cancelGitConnect(gitConnectSessionId)
    gitConnectUnsubscribeRef.current?.()
    gitConnectUnsubscribeRef.current = null
    setGitConnectSessionId(null)
    gitConnectSessionIdRef.current = null
    setGitAuthPrompt(null)
    setGitAuthInput('')
    setGitOtpInput('')
    setIsUpdatingGit(false)
    setGitConnectError('Git connection cancelled.')
  }

  useEffect(() => {
    return () => {
      const sessionId = gitConnectSessionIdRef.current
      if (sessionId) {
        projectFiles.cancelGitConnect(sessionId).catch(() => {})
      }
      gitConnectUnsubscribeRef.current?.()
      gitConnectUnsubscribeRef.current = null
      gitConnectSessionIdRef.current = null
    }
  }, [])

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

  const promptConvexIntentChoice = (convexSecrets: ReturnType<typeof getConvexSecretStatusFromSecrets>) => {
    if (!convexSecrets.hasUrl) {
      toast('Add your Convex URL first before running setup.', { icon: 'ℹ️' })
      return
    }

    if (!convexSecrets.hasDeployKey) {
      toast('Convex URL saved. Add CONVEX_DEPLOY_KEY to run setup.', { icon: 'ℹ️' })
      return
    }

    if (!detectConvexBootstrap(files)) {
      workbenchStore.setPendingIntegrationChoice({
        integrationId: 'convex',
        source: 'settings',
      })
      toast.success('Convex credentials saved. Choose Convex setup mode in chat...')
      return
    }

    toast.success('Convex credentials updated.')
  }

  const ensureConvexAuthEnvProvisioned = async (
    convexSecrets: ReturnType<typeof getConvexSecretStatusFromSecrets>
  ) => {
    if (!project.id) return
    if (!convexSecrets.hasUrl || !convexSecrets.hasDeployKey) return

    try {
      const result = await secretsApi.ensureConvexAuthEnv(project.id, normalizedAppType)
      if (result.success) return

      const warning = result.error || result.warning || 'Failed to provision Convex auth environment.'
      toast.error(`Convex auth env provisioning failed: ${warning}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Convex auth env provisioning failed: ${message}`)
    }
  }

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
      await ensureConvexAuthEnvProvisioned(convexSecrets)
      promptConvexIntentChoice(convexSecrets)
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

      await ensureConvexAuthEnvProvisioned(convexSecrets)
      promptConvexIntentChoice(convexSecrets)
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
            <CardTitle>Git</CardTitle>
            <CardDescription>Connect this project to your own Git repository remote</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <GitBranch size={14} className={isGitConnected ? 'text-emerald-500' : 'text-muted-foreground'} />
                <span className={isGitConnected ? 'text-emerald-500' : 'text-muted-foreground'}>
                  {isGitConnected ? 'Remote connected' : 'No remote connected'}
                </span>
              </div>

              <div className="settings-field">
                <label htmlFor="gitRemoteUrl">Repository URL</label>
                <Input
                  id="gitRemoteUrl"
                  type="text"
                  value={gitRemoteUrl}
                  onChange={(e) => {
                    setGitRemoteUrl(e.target.value)
                    setGitConnectError(null)
                    setGitConnectSuccess(null)
                    setGitDiagnostics(null)
                    setGitAuthPrompt(null)
                  }}
                  placeholder="https://github.com/you/repo.git or git@github.com:you/repo.git"
                />
              </div>

              <div className="settings-field">
                <label htmlFor="gitRemoteBranch">Remote Branch</label>
                <Input
                  id="gitRemoteBranch"
                  type="text"
                  value={gitRemoteBranch}
                  onChange={(e) => {
                    setGitRemoteBranch(e.target.value)
                    setGitConnectError(null)
                    setGitConnectSuccess(null)
                    setGitDiagnostics(null)
                  }}
                  placeholder="main"
                />
              </div>

              {gitConnectError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  {gitErrorGuidance ? (
                    <div className="space-y-2">
                      <div className="font-medium">{`Error: ${gitErrorGuidance.title}`}</div>
                      <ol className="list-decimal pl-5 space-y-1">
                        {gitErrorGuidance.steps.map((step, index) => (
                          <li key={`${index}-${step}`} className="text-red-700 dark:text-red-200">{step}</li>
                        ))}
                      </ol>
                      {canAutoFixToHttps && autoFixHttpsUrl && (
                        <div className="pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAutoFixToHttps}
                            disabled={isUpdatingGit}
                          >
                            Use HTTPS and retry automatically
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    gitConnectError
                  )}
                </div>
              )}
              {gitConnectSuccess && (
                <div
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  style={{ color: '#064e3b' }}
                >
                  {gitConnectSuccess}
                </div>
              )}

              {gitDiagnostics && (
                <div
                  className="rounded-md border border-amber-400 bg-amber-100 px-3 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
                  style={{ color: gitDiagnosticsTextColor }}
                >
                  <div className="mb-2 font-medium" style={{ color: gitDiagnosticsTitleColor }}>Git diagnostics</div>
                  <ol className="list-decimal space-y-1 pl-5" style={{ color: gitDiagnosticsTextColor }}>
                    <li style={{ color: gitDiagnosticsTextColor }}>{`Remote type: ${gitDiagnostics.remoteType || 'unknown'}`}</li>
                    <li style={{ color: gitDiagnosticsTextColor }}>
                      {gitDiagnostics.remoteReachable
                        ? 'Remote reachability check passed'
                        : 'Remote reachability check failed'}
                    </li>
                    {gitDiagnostics.remoteType === 'ssh' && (
                      <li style={{ color: gitDiagnosticsTextColor }}>
                        {gitDiagnostics.sshAgentHasIdentities === true
                          ? 'SSH agent has at least one loaded identity'
                          : gitDiagnostics.sshAgentHasIdentities === false
                            ? 'SSH agent has no loaded identities'
                            : 'SSH agent identity status is inconclusive'}
                      </li>
                    )}
                    {gitDiagnostics.probeError && (
                      <li style={{ color: gitDiagnosticsTextColor }}>{`Probe error: ${gitDiagnostics.probeError}`}</li>
                    )}
                  </ol>
                  {gitDiagnostics.suggestedHttpsUrl && (
                    <div className="pt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-500"
                        onClick={() => {
                          setGitRemoteUrl(gitDiagnostics.suggestedHttpsUrl || '')
                          setGitConnectError(null)
                        }}
                      >
                        Use suggested HTTPS URL
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {gitAuthPrompt && (
                <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="text-sm font-medium">Authentication required</div>
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono">
                    {gitAuthPrompt.context}
                  </div>
                  {gitAuthPrompt.suggestion && (
                    <div className="text-xs text-muted-foreground">{gitAuthPrompt.suggestion}</div>
                  )}

                  {gitAuthPrompt.type === 'yes_no' ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => submitGitAuthInput('y')}
                        disabled={!gitConnectSessionId}
                      >
                        Yes (y)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => submitGitAuthInput('n')}
                        disabled={!gitConnectSessionId}
                      >
                        No (n)
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type={gitAuthPrompt.type === 'https_password' || gitAuthPrompt.type === 'ssh_passphrase' ? 'password' : 'text'}
                        value={gitAuthPrompt.type === 'otp' ? gitOtpInput : gitAuthInput}
                        onChange={(e) => {
                          if (gitAuthPrompt.type === 'otp') {
                            setGitOtpInput(e.target.value.replace(/\D/g, '').slice(0, 8))
                          } else {
                            setGitAuthInput(e.target.value)
                          }
                        }}
                        placeholder={gitAuthPrompt.type === 'otp' ? 'Enter verification code' : 'Enter response'}
                        inputMode={gitAuthPrompt.type === 'otp' ? 'numeric' : undefined}
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => submitGitAuthInput(gitAuthPrompt.type === 'otp' ? gitOtpInput : gitAuthInput)}
                        disabled={!gitConnectSessionId}
                      >
                        Submit
                      </Button>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelGitConnect}
                      disabled={!gitConnectSessionId}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {isUpdatingGit && gitConnectLogTail && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Git Connect Output</div>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs font-mono text-muted-foreground">
                    {gitConnectLogTail}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRunGitDiagnostics}
                  disabled={isUpdatingGit || isRunningGitDiagnostics}
                >
                  {isRunningGitDiagnostics ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                  Run diagnostics
                </Button>
                {!isGitConnected && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleConnectGit}
                    disabled={isUpdatingGit}
                  >
                    {isUpdatingGit ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
                    Connect Remote
                  </Button>
                )}
                {gitConnectSessionId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelGitConnect}
                  >
                    Cancel Connect
                  </Button>
                )}
                {isGitConnected && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDisconnectGit}
                    disabled={isUpdatingGit}
                  >
                    {isUpdatingGit ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
                    Disconnect
                  </Button>
                )}
              </div>
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
              <div className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
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
