import { cleanTerminalOutput } from './clean-logs'

const TAIL_LINES = 100

export function buildDeployErrorPrompt(ctx: {
  platform: 'web' | 'ios'
  provider?: string
  errorMessage?: string
  logs: string
}): string {
  const cleaned = cleanTerminalOutput(ctx.logs)
  const lines = cleaned.split('\n').filter(line => {
    const trimmed = line.trim()
    // Filter out empty lines and lines that are only stream tags like [stdout], [stderr]
    if (!trimmed) return false
    if (/^\[(stdout|stderr)\]$/.test(trimmed)) return false
    return true
  })
  const tail = lines.slice(-TAIL_LINES).join('\n')

  const label = ctx.platform === 'web'
    ? `Web deployment (${ctx.provider || 'Vercel'})`
    : 'iOS deployment (EAS Build)'

  let prompt = `The ${label} just failed.`
  if (ctx.errorMessage) {
    prompt += ` Error: "${ctx.errorMessage}"`
  }
  if (tail) {
    prompt += '\n\nPlease analyze the build logs below and fix any code, configuration, or dependency issues causing the failure.\n\n'
    prompt += '```\n' + tail + '\n```'
  } else {
    prompt += '\n\nNo detailed build logs were available. Please check my code for likely build issues (TypeScript errors, missing dependencies, bad imports, etc.) and fix them.'
  }
  prompt += '\n\nAfter fixing, let me know so I can re-deploy.'

  return prompt
}
