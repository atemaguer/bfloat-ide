import { getSidecarApiSync } from '@/app/api/sidecar'

const HTML_DOCUMENT_PATTERN = /<!DOCTYPE html>|<html[\s>]/i
const INVALID_FILENAME_CHARS = /[^a-z0-9_-]/gi
const APPLE_INVALID_CREDENTIALS_PATTERN =
  /Invalid username and password combination|Used '.+?' as the username|Would you like to try again\?/i

export type DeployErrorKind = 'generic' | 'apple-credentials'

export interface ParsedDeployError {
  kind: DeployErrorKind
  message: string
}

function toSafeSegment(value: string): string {
  return value.toLowerCase().replace(INVALID_FILENAME_CHARS, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function buildDumpPath(projectPath: string, context: string, isHtml: boolean): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeContext = toSafeSegment(context || 'deploy')
  const ext = isHtml ? 'html' : 'txt'
  return `${projectPath}/.bfloat-debug/deploy-error-${stamp}-${safeContext}.${ext}`
}

function buildFallbackDumpPaths(projectPath: string, context: string, isHtml: boolean): string[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeContext = toSafeSegment(context || 'deploy')
  const ext = isHtml ? 'html' : 'txt'
  const bfloatRootMarker = `${'/'}${'.bfloat-ide'}${'/'}`
  const markerIndex = projectPath.indexOf(bfloatRootMarker)
  const homeDir = markerIndex > 0 ? projectPath.slice(0, markerIndex) : null

  const fallbackPaths = [
    `${projectPath}/deploy-error-${stamp}-${safeContext}.${ext}`,
    `${projectPath}/tmp-deploy-error-${stamp}-${safeContext}.${ext}`,
    `/tmp/bfloat-deploy-error-${stamp}-${safeContext}.${ext}`,
  ]

  if (homeDir) {
    fallbackPaths.push(`${homeDir}/.bfloat-ide/deploy-error-${stamp}-${safeContext}.${ext}`)
  }

  return [
    ...fallbackPaths,
  ]
}

export async function dumpDeployErrorPayload(params: {
  rawError: string | null | undefined
  context: string
  projectPath?: string
}): Promise<string | null> {
  const raw = (params.rawError || '').trim()
  if (!raw) return null
  if (!params.projectPath) return null

  const isHtml = HTML_DOCUMENT_PATTERN.test(raw)
  const path = buildDumpPath(params.projectPath, params.context, isHtml)
  const content = [
    `context: ${params.context}`,
    `capturedAt: ${new Date().toISOString()}`,
    `isHtml: ${String(isHtml)}`,
    '',
    raw,
    '',
  ].join('\n')

  try {
    let api
    try {
      api = getSidecarApiSync()
    } catch (error) {
      console.error(`[DeployError:${params.context}] Sidecar API unavailable; cannot dump raw response`, error)
      return null
    }
    const candidates = [path, ...buildFallbackDumpPaths(params.projectPath, params.context, isHtml)]
    for (const candidatePath of candidates) {
      try {
        await api.http.post('/api/fs/write', {
          path: candidatePath,
          content,
          createDirs: true,
        })
        console.error(`[DeployError:${params.context}] Dumped raw response to file`, { path: candidatePath })
        return candidatePath
      } catch {
        // Try the next fallback path.
      }
    }
    console.error(`[DeployError:${params.context}] Failed to dump raw response: no writable path`, {
      attemptedPaths: candidates,
    })
    return null
  } catch (error) {
    console.error(`[DeployError:${params.context}] Failed to dump raw response`, error)
    return null
  }
}

/**
 * Normalize noisy deploy errors into user-readable messages.
 */
export function parseDeployError(
  rawError: string | null | undefined,
  fallback = 'Deployment failed',
  context = 'deploy'
): ParsedDeployError {
  const message = (rawError || '').trim()
  if (!message) {
    return { kind: 'generic', message: fallback }
  }

  if (APPLE_INVALID_CREDENTIALS_PATTERN.test(message)) {
    return {
      kind: 'apple-credentials',
      message: 'Your Apple ID credentials were rejected. Enter your Apple ID and password again to continue publishing.',
    }
  }

  if (HTML_DOCUMENT_PATTERN.test(message)) {
    console.error(`[DeployError:${context}] HTML response detected`, {
      length: message.length,
      preview: message.slice(0, 400),
    })
    return {
      kind: 'generic',
      message:
        'Apple authentication returned an unexpected web response. This usually means Apple sign-in requires additional verification. Retry, or use App Store Connect API Key authentication.',
    }
  }

  if (message.length > 500) {
    console.error(`[DeployError:${context}] Long error message`, {
      length: message.length,
      preview: message.slice(0, 400),
    })
    return {
      kind: 'generic',
      message: `${message.slice(0, 497)}...`,
    }
  }

  return { kind: 'generic', message }
}

export function sanitizeDeployError(
  rawError: string | null | undefined,
  fallback = 'Deployment failed',
  context = 'deploy'
): string {
  return parseDeployError(rawError, fallback, context).message
}
