import { describe, expect, it } from 'bun:test'

import { normalizeCodexError } from './codex-provider.ts'

describe('normalizeCodexError', () => {
  it('returns plain string errors unchanged', () => {
    expect(normalizeCodexError('Model access denied')).toBe('Model access denied')
  })

  it('extracts nested error messages from object payloads', () => {
    const error = {
      error: {
        message: 'Codex authentication failed',
      },
    }

    expect(normalizeCodexError(error)).toBe('Codex authentication failed')
  })

  it('extracts stderr when message is not present', () => {
    const error = {
      stderr: 'codex: failed to read auth.json',
    }

    expect(normalizeCodexError(error)).toBe('codex: failed to read auth.json')
  })

  it('falls back to the default copy for generic unknown errors', () => {
    expect(normalizeCodexError('Unknown error')).toBe(
      'Codex failed before returning a detailed error. Check authentication, model access, or sidecar logs for details.'
    )
  })
})
