import { describe, expect, it } from 'bun:test'

import type { AgentMessage } from '@/lib/conveyor/schemas/ai-agent-schema'

import { applyAgentMessageToTranscript, hydrateTranscriptFromHistory } from './session-transcript'

describe('session transcript hydration', () => {
  it('hydrates a persisted transcript and tracks the latest sequence number', () => {
    const hydrated = hydrateTranscriptFromHistory([
      {
        kind: 'user_message',
        message: {
          id: 'user-1',
          role: 'user',
          content: 'Build a timer app',
          parts: [{ type: 'text', text: 'Build a timer app' }],
          createdAt: '2026-03-11T12:00:00.000Z',
        },
      },
      {
        kind: 'agent_message',
        message: {
          type: 'text',
          content: 'I will make a timer app.',
          metadata: { seq: 2 },
        } satisfies AgentMessage,
      },
      {
        kind: 'agent_message',
        message: {
          type: 'tool_call',
          content: {
            id: 'tool-1',
            name: 'Write',
            input: { file_path: 'app.tsx' },
            status: 'running',
          },
          metadata: { seq: 3 },
        } satisfies AgentMessage,
      },
      {
        kind: 'agent_message',
        message: {
          type: 'tool_result',
          content: {
            callId: 'tool-1',
            name: 'Write',
            output: 'ok',
            isError: false,
          },
          metadata: { seq: 4 },
        } satisfies AgentMessage,
      },
    ])

    expect(hydrated.lastSeq).toBe(4)
    expect(hydrated.messages).toHaveLength(2)
    expect(hydrated.messages[0]?.role).toBe('user')
    expect(hydrated.messages[1]?.role).toBe('assistant')
    expect(hydrated.messages[1]?.parts).toEqual([
      { type: 'text', text: 'I will make a timer app.' },
      {
        type: 'tool-Write',
        toolCallId: 'tool-1',
        toolName: 'Write',
        state: 'result',
        args: { file_path: 'app.tsx' },
        result: 'ok',
      },
    ])
  })

  it('merges consecutive assistant text chunks into one assistant message', () => {
    const afterFirstChunk = applyAgentMessageToTranscript([], {
      type: 'text',
      content: 'Hello',
      metadata: { seq: 1 },
    })

    const afterSecondChunk = applyAgentMessageToTranscript(afterFirstChunk, {
      type: 'text',
      content: ' world',
      metadata: { seq: 2 },
    })

    expect(afterSecondChunk).toHaveLength(1)
    expect(afterSecondChunk[0]?.content).toBe('Hello world')
    expect(afterSecondChunk[0]?.parts).toEqual([{ type: 'text', text: 'Hello world' }])
  })
})
