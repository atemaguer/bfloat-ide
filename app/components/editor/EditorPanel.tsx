import { useCallback, useState, useEffect } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { Save, RotateCcw, X, ChevronRight, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'

import { workbenchStore } from '@/app/stores/workbench'
import { preferencesStore } from '@/app/stores/preferences'
import type { FileMap, EditorDocument } from '@/app/types/project'
import { FileTree } from './FileTree'
import { CodeEditor } from './CodeEditor'
import { FileIcon } from './FileIcons'
import './styles.css'

// Image file extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp']

// Font file extensions
const FONT_EXTENSIONS = ['.woff', '.woff2', '.ttf', '.otf', '.eot']

// Audio/Video extensions
const MEDIA_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.ogg', '.webm', '.m4a', '.aac']

// Archive extensions
const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.gz', '.rar', '.7z']

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))
  return IMAGE_EXTENSIONS.includes(ext)
}

function getImageMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
  }
  return mimeTypes[ext] || 'image/png'
}

function getBinaryFileDescription(filePath: string): { type: string; icon: string } {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))

  if (FONT_EXTENSIONS.includes(ext)) {
    return { type: 'Font file', icon: '🔤' }
  }
  if (MEDIA_EXTENSIONS.includes(ext)) {
    return { type: 'Media file', icon: '🎵' }
  }
  if (ARCHIVE_EXTENSIONS.includes(ext)) {
    return { type: 'Archive file', icon: '📦' }
  }
  if (ext === '.pdf') {
    return { type: 'PDF document', icon: '📄' }
  }
  return { type: 'Binary file', icon: '📎' }
}

interface EditorPanelProps {
  files: FileMap
  selectedFile?: string
  currentDocument?: EditorDocument
  unsavedFiles: Set<string>
  onFileSelect: (filePath: string) => void
  onEditorChange: (path: string, value: string) => void
  onFileSave: () => void
  onFileReset: () => void
  projectName?: string
  isLoading?: boolean  // For progressive loading - show skeleton while files sync
}

export function EditorPanel({
  files,
  selectedFile,
  currentDocument,
  unsavedFiles,
  onFileSelect,
  onEditorChange,
  onFileSave,
  onFileReset,
  projectName,
  isLoading = false,
}: EditorPanelProps) {
  const autoSave = useStore(preferencesStore.autoSave)
  const formatOnSave = useStore(preferencesStore.formatOnSave)
  // Track open tabs
  const [openTabs, setOpenTabs] = useState<string[]>([])

  // Image viewer state
  const [imageZoom, setImageZoom] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)

  // Reset image viewer state when file changes
  useEffect(() => {
    setImageZoom(1)
    setImageRotation(0)
  }, [selectedFile])

  // Add file to open tabs when selected
  useEffect(() => {
    if (selectedFile && !openTabs.includes(selectedFile)) {
      setOpenTabs((prev) => [...prev, selectedFile])
    }
  }, [selectedFile, openTabs])

  const handleEditorChange = useCallback(
    (value: string) => {
      if (currentDocument?.filePath) {
        onEditorChange(currentDocument.filePath, value)
      }
    },
    [currentDocument?.filePath, onEditorChange]
  )

  const handleCloseTab = useCallback(
    (filePath: string, e: React.MouseEvent) => {
      e.stopPropagation()
      setOpenTabs((prev) => {
        const newTabs = prev.filter((t) => t !== filePath)
        // If closing the active tab, select another one
        if (filePath === selectedFile && newTabs.length > 0) {
          const closedIndex = prev.indexOf(filePath)
          const newIndex = Math.min(closedIndex, newTabs.length - 1)
          onFileSelect(newTabs[newIndex])
        } else if (newTabs.length === 0) {
          onFileSelect('')
        }
        return newTabs
      })
    },
    [selectedFile, onFileSelect]
  )

  const isUnsaved = currentDocument?.filePath ? unsavedFiles.has(currentDocument.filePath) : false

  // Generate breadcrumb from file path
  const breadcrumbParts = currentDocument?.filePath?.split('/') || []

  // Show loading skeleton while files are syncing (progressive loading)
  if (isLoading) {
    return (
      <div className="editor-panel">
        <PanelGroup orientation="horizontal" style={{ height: '100%' }}>
          {/* File Tree Skeleton */}
          <Panel id="file-tree" defaultSize="25%" minSize="150px" maxSize="40%">
            <div className="editor-loading-skeleton">
              <div className="editor-loading-header">
                <div className="editor-loading-shimmer" style={{ width: '60%', height: '14px' }} />
              </div>
              <div className="editor-loading-tree">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="editor-loading-item" style={{ paddingLeft: `${(i % 3) * 12 + 8}px` }}>
                    <div className="editor-loading-shimmer" style={{ width: `${60 + Math.random() * 30}%`, height: '12px' }} />
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="editor-resize-handle" />

          {/* Editor Skeleton */}
          <Panel id="code-editor" minSize="50%">
            <div className="editor-main">
              <div className="editor-loading-content">
                <div className="editor-loading-spinner" />
                <span className="editor-loading-text">Loading files...</span>
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    )
  }

  return (
    <div className="editor-panel">
      <PanelGroup orientation="horizontal" style={{ height: '100%' }}>
        {/* File Tree */}
        <Panel id="file-tree" defaultSize="25%" minSize="150px" maxSize="40%">
          <FileTree
            files={files}
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
            unsavedFiles={unsavedFiles}
            projectName={projectName}
          />
        </Panel>

        <PanelResizeHandle className="editor-resize-handle" />

        {/* Editor */}
        <Panel id="code-editor" minSize="50%">
          <div className="editor-main">
            {/* Open File Tabs */}
            {openTabs.length > 0 && (
              <div className="editor-tabs">
                {openTabs.map((filePath) => {
                  const fileName = filePath.split('/').pop() || ''
                  const isActive = filePath === selectedFile
                  const tabUnsaved = unsavedFiles.has(filePath)
                  return (
                    <button
                      key={filePath}
                      className={`editor-tab ${isActive ? 'active' : ''}`}
                      onClick={() => onFileSelect(filePath)}
                    >
                      <FileIcon fileName={fileName} size={14} />
                      <span className="editor-tab-name">{fileName}</span>
                      {tabUnsaved && <span className="editor-tab-unsaved" />}
                      <span
                        className="editor-tab-close"
                        onClick={(e) => handleCloseTab(filePath, e)}
                      >
                        <X size={12} />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {currentDocument ? (
              <>
                {/* Breadcrumb Navigation */}
                <div className="editor-breadcrumb">
                  {breadcrumbParts.map((part, index) => (
                    <span key={index} className="editor-breadcrumb-segment">
                      {index > 0 && (
                        <ChevronRight size={12} className="editor-breadcrumb-separator" />
                      )}
                      <span className="editor-breadcrumb-item">
                        {index === breadcrumbParts.length - 1 ? (
                          <span className="editor-breadcrumb-file">
                            <FileIcon fileName={part} size={12} />
                            {part}
                          </span>
                        ) : (
                          part
                        )}
                      </span>
                    </span>
                  ))}
                  {/* Action buttons on the right */}
                  <div className="editor-breadcrumb-actions">
                    {isUnsaved && (
                      <>
                        <button
                          className="editor-action-btn"
                          onClick={onFileReset}
                          title="Discard changes"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          className="editor-action-btn save"
                          onClick={onFileSave}
                          title="Save (⌘S)"
                        >
                          <Save size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Editor Content */}
                <div className="editor-content">
                  {currentDocument.isBinary ? (
                    isImageFile(currentDocument.filePath) ? (
                      <div className="image-viewer">
                        <div className="image-viewer-toolbar">
                          <button
                            className="image-viewer-btn"
                            onClick={() => setImageZoom((z) => Math.max(0.1, z - 0.25))}
                            title="Zoom out"
                          >
                            <ZoomOut size={14} />
                          </button>
                          <span className="image-viewer-zoom">{Math.round(imageZoom * 100)}%</span>
                          <button
                            className="image-viewer-btn"
                            onClick={() => setImageZoom((z) => Math.min(5, z + 0.25))}
                            title="Zoom in"
                          >
                            <ZoomIn size={14} />
                          </button>
                          <div className="image-viewer-separator" />
                          <button
                            className="image-viewer-btn"
                            onClick={() => setImageRotation((r) => (r + 90) % 360)}
                            title="Rotate"
                          >
                            <RotateCw size={14} />
                          </button>
                          <button
                            className="image-viewer-btn"
                            onClick={() => {
                              setImageZoom(1)
                              setImageRotation(0)
                            }}
                            title="Reset"
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                        <div className="image-viewer-container">
                          <img
                            src={`data:${getImageMimeType(currentDocument.filePath)};base64,${currentDocument.value}`}
                            alt={currentDocument.filePath.split('/').pop()}
                            className="image-viewer-img"
                            style={{
                              transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const { type, icon } = getBinaryFileDescription(currentDocument.filePath)
                        const fileName = currentDocument.filePath.split('/').pop() || 'file'
                        return (
                          <div className="editor-binary-notice">
                            <span className="editor-binary-icon">{icon}</span>
                            <p className="editor-binary-type">{type}</p>
                            <p className="editor-binary-name">{fileName}</p>
                            <p className="editor-binary-hint">This file cannot be previewed in the editor.</p>
                          </div>
                        )
                      })()
                    )
                  ) : (
                    <CodeEditor
                      value={currentDocument.value}
                      language={currentDocument.language}
                      onChange={handleEditorChange}
                      onSave={onFileSave}
                      readOnly={true}
                      autoSave={autoSave}
                      formatOnSave={formatOnSave}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="editor-empty">
                <span className="editor-empty-text">Loading editor...</span>
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
