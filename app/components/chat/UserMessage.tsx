/**
 * UserMessage Component - Manus-inspired design
 *
 * Displays user messages in a clean rounded container.
 * Supports text content and attachments (images, files).
 * Loads persisted attachments from disk when reopening chat.
 */

import { memo, useState, useEffect } from 'react'
import type { MessagePart } from '@/app/types/project'
import { Markdown } from './Markdown'

interface LoadedImage {
  url: string
  filename: string
}

interface UserMessageProps {
  content: string
  parts?: MessagePart[]
}

/**
 * Parse attachment paths from message content
 * Format: [Attachments: ./path1, ./path2]
 */
function parseAttachmentPaths(content: string): { paths: string[]; cleanContent: string } {
  const attachmentMatch = content.match(/\[Attachments:\s*([^\]]+)\]/)
  if (!attachmentMatch) {
    return { paths: [], cleanContent: content }
  }

  const pathsStr = attachmentMatch[1]
  const paths = pathsStr.split(',').map((p) => p.trim()).filter(Boolean)
  const cleanContent = content.replace(/\s*\[Attachments:[^\]]+\]/, '').trim()

  return { paths, cleanContent }
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }
  return mimeTypes[ext || ''] || 'image/png'
}

export const UserMessage = memo(function UserMessage({
  content,
  parts = [],
}: UserMessageProps) {
  const [loadedImages, setLoadedImages] = useState<LoadedImage[]>([])

  // Extract image parts - parts with type 'image' and a url
  const imageParts = parts.filter(
    (part) => part.type === 'image' && part.url
  )

  // Parse attachment paths from content (for persisted messages)
  const { paths: attachmentPaths, cleanContent } = parseAttachmentPaths(content)

  // Load images from disk if we have attachment paths but no image parts
  useEffect(() => {
    if (attachmentPaths.length === 0 || imageParts.length > 0) {
      return
    }

    const loadImages = async () => {
      const loaded: LoadedImage[] = []

      for (const path of attachmentPaths) {
        try {
          const result = await window.conveyor.projectFiles.readFile(path)
          if (result.isBinary && result.content) {
            const mimeType = getMimeType(path)
            const dataUrl = `data:${mimeType};base64,${result.content}`
            const filename = path.split('/').pop() || 'image'
            loaded.push({ url: dataUrl, filename })
          }
        } catch (error) {
          console.warn('[UserMessage] Failed to load attachment:', path, error)
        }
      }

      setLoadedImages(loaded)
    }

    loadImages()
  }, [attachmentPaths.join(','), imageParts.length])

  // Extract text parts and clean any attachment notation from them
  const textParts = parts.filter((part) => part.type === 'text')
  const rawDisplayText = textParts.length > 0
    ? textParts.map((p) => p.text).join('\n')
    : cleanContent

  // Always clean attachment notation from display text
  const displayText = rawDisplayText.includes('[Attachments:')
    ? rawDisplayText.split('[Attachments:')[0].trim()
    : rawDisplayText.trim()

  // Combine image parts from props and loaded images
  const allImages = [
    ...imageParts.map((part) => ({
      url: part.url!,
      filename: part.filename || 'Attached image',
    })),
    ...loadedImages,
  ]

  return (
    <div className="user-message">
      {/* Image attachments */}
      {allImages.length > 0 && (
        <div className="user-message-images">
          {allImages.map((image, index) => (
            <div key={index} className="user-message-image">
              <img
                src={image.url}
                alt={image.filename}
                style={{
                  maxWidth: '200px',
                  maxHeight: '200px',
                  borderRadius: '8px',
                  objectFit: 'cover',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Text content */}
      {displayText && <div className="user-message-text"><Markdown>{displayText}</Markdown></div>}
    </div>
  )
})

UserMessage.displayName = 'UserMessage'
