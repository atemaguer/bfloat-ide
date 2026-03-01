/**
 * UserMessage Component - Manus-inspired design
 *
 * Displays user messages in a clean rounded container.
 * Supports text content and attachments (images, files).
 * Loads persisted attachments from disk when reopening chat.
 */

import { memo, useState, useEffect, useMemo } from 'react'
import type { MessagePart } from '@/app/types/project'
import { Markdown } from './Markdown'
import { projectFiles } from '@/app/api/sidecar'

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

/**
 * Legacy fallback:
 * Older versions persisted data URLs as plain text inside image files.
 * If we detect this payload after base64-decoding file bytes, return it.
 */
function extractLegacyDataUrlFromBinaryBase64(content: string): string | null {
  try {
    const decoded = atob(content)
    const trimmed = decoded.trim()
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(trimmed)) {
      return trimmed
    }
  } catch {
    // Not decodable as text payload, treat as normal binary image
  }
  return null
}

export const UserMessage = memo(function UserMessage({
  content,
  parts = [],
}: UserMessageProps) {
  const [loadedImages, setLoadedImages] = useState<LoadedImage[]>([])
  const [expandedImage, setExpandedImage] = useState<LoadedImage | null>(null)

  // Extract image parts - parts with type 'image' and a url
  const imageParts = parts.filter(
    (part) => part.type === 'image' && part.url
  )

  // Parse attachment paths from content (for persisted messages)
  const { paths: attachmentPaths, cleanContent } = useMemo(
    () => parseAttachmentPaths(content),
    [content]
  )

  // Load images from disk if we have attachment paths but no image parts
  useEffect(() => {
    if (attachmentPaths.length === 0 || imageParts.length > 0) {
      return
    }

    const loadImages = async () => {
      const loaded: LoadedImage[] = []

      for (const path of attachmentPaths) {
        try {
          const result = await projectFiles.readFile(path)
          if (result.isBinary && result.content) {
            const legacyDataUrl = extractLegacyDataUrlFromBinaryBase64(result.content)
            const dataUrl = legacyDataUrl ?? `data:${getMimeType(path)};base64,${result.content}`
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
  }, [attachmentPaths, imageParts.length])

  useEffect(() => {
    if (!expandedImage) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedImage(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [expandedImage])

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
              <button
                type="button"
                className="user-message-image-button"
                onClick={() => setExpandedImage(image)}
                aria-label={`Expand ${image.filename}`}
              >
                <img
                  src={image.url}
                  alt={image.filename}
                  className="user-message-image-thumbnail"
                />
              </button>
            </div>
          ))}
        </div>
      )}

      {expandedImage && (
        <div
          className="chat-image-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Expanded preview: ${expandedImage.filename}`}
        >
          <button
            type="button"
            className="chat-image-modal-dismiss-zone"
            onClick={() => setExpandedImage(null)}
            aria-label="Close expanded image"
          />
          <div className="chat-image-modal-content">
            <button
              type="button"
              className="chat-image-modal-close"
              onClick={() => setExpandedImage(null)}
              aria-label="Close expanded image preview"
            >
              ×
            </button>
            <img
              src={expandedImage.url}
              alt={expandedImage.filename}
              className="chat-image-modal-image"
            />
            <div className="chat-image-modal-caption">{expandedImage.filename}</div>
          </div>
        </div>
      )}

      {/* Text content */}
      {displayText && <div className="user-message-text"><Markdown>{displayText}</Markdown></div>}
    </div>
  )
})

UserMessage.displayName = 'UserMessage'
