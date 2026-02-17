import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import { memo } from 'react'

interface MarkdownProps {
  children: string
  isAnimating?: boolean
}

const plugins = { code }

export const Markdown = memo(function Markdown({ children: content, isAnimating = false }: MarkdownProps) {
  return (
    <Streamdown plugins={plugins} isAnimating={isAnimating}>
      {content}
    </Streamdown>
  )
})
