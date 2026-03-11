import { describe, expect, it } from 'bun:test'

import { getSystemPrompt } from '../../../../lib/launch/system-prompt.ts'

describe('system prompt generation', () => {
  it('keeps Expo tab-removal guidance for Codex sessions', () => {
    const prompt = getSystemPrompt(false, 'codex')

    expect(prompt).toContain('Default to removing them')
    expect(prompt).toContain('Delete `app/(tabs)/` entirely.')
    expect(prompt).toContain('Start useful work quickly.')
  })

  it('omits Claude-style tool-transparency cadence from Codex sessions', () => {
    const prompt = getSystemPrompt(false, 'codex')

    expect(prompt).not.toContain('## Tool Transparency')
    expect(prompt).not.toContain('Before the first tool call, send one short status line')
  })

  it('retains tool-transparency guidance for Claude sessions', () => {
    const prompt = getSystemPrompt(false, 'claude')

    expect(prompt).toContain('## Tool Transparency')
    expect(prompt).toContain('Before the first tool call, send one short status line')
  })

  it('omits project exploration on resumed sessions for all providers', () => {
    const claudePrompt = getSystemPrompt(true, 'claude')
    const codexPrompt = getSystemPrompt(true, 'codex')

    expect(claudePrompt).not.toContain('On a new session, keep project discovery minimal:')
    expect(codexPrompt).not.toContain('On a new session, keep project discovery minimal:')
  })
})
