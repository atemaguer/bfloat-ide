import { useRef, useCallback, useLayoutEffect, useEffect, KeyboardEvent, useState } from 'react'
import { Square, Plus, Bot, Cpu, Mic, ArrowUp, ChevronDown, ChevronRight, Check, Smartphone, Globe, Puzzle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FileUIPart } from 'ai'
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  type AttachmentData,
} from '@/app/components/ai-elements/attachments'

// Re-export AttachmentData as ImageAttachment for backwards compatibility
export type ImageAttachment = AttachmentData

// Model option for sub-menu when a provider has multiple models
export interface ModelOption {
  id: string
  label: string
  description?: string
}

interface ProviderOption {
  id: string
  label: string
  isAuthenticated?: boolean
  /** Optional sub-models for this provider */
  models?: ModelOption[]
}

interface ProviderSelectorProps {
  provider: string
  onProviderChange: (provider: string) => void
  options: ProviderOption[]
  isAuthenticated?: boolean
  disabled?: boolean
  /** Currently selected model (for providers with sub-models) */
  selectedModel?: string
  /** Callback when model is selected (for providers with sub-models) */
  onModelChange?: (modelId: string) => void
}

type AppType = 'mobile' | 'web'

interface AppTypeSelectorProps {
  appType: AppType
  onAppTypeChange: (appType: AppType) => void
}

interface IntegrationItem {
  id: string
  name: string
  icon: React.ReactNode
  isConnected: boolean
}

interface IntegrationsMenuProps {
  integrations: IntegrationItem[]
  onConnect: (id: string) => void
  onUse: (id: string) => void
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string, attachments: ImageAttachment[]) => void
  onStop?: () => void
  isStreaming?: boolean
  isDisabled?: boolean
  isProvisioning?: boolean
  placeholder?: string
  showAttachment?: boolean
  showGlobe?: boolean
  showMic?: boolean
  showHint?: boolean
  providerSelector?: ProviderSelectorProps
  appTypeSelector?: AppTypeSelectorProps
  integrationsMenu?: IntegrationsMenuProps
  /** Externally injected attachment (e.g. preview screenshot) */
  pendingAttachment?: AttachmentData | null
  /** Called after the pending attachment has been added to the internal state */
  onPendingAttachmentConsumed?: () => void
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  isDisabled,
  isProvisioning,
  placeholder = 'Assign a task or ask anything',
  showAttachment = true,
  showGlobe = false,
  showMic = true,
  showHint = false,
  providerSelector,
  appTypeSelector,
  integrationsMenu,
  pendingAttachment,
  onPendingAttachmentConsumed,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Animated gradient border for provisioning state
  useEffect(() => {
    if (!isProvisioning || !containerRef.current) return
    let angle = 0
    let animationId: number
    const animate = () => {
      angle = (angle + 1.5) % 360
      containerRef.current?.style.setProperty('--border-angle', `${angle}deg`)
      animationId = requestAnimationFrame(animate)
    }
    animationId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationId)
  }, [isProvisioning])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isAppTypeDropdownOpen, setIsAppTypeDropdownOpen] = useState(false)
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false)
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [attachments, setAttachments] = useState<AttachmentData[]>([])

  // Consume externally-injected attachment (e.g. preview screenshot).
  // Uses a ref to track the last consumed attachment ID so that
  // React StrictMode's double-mount doesn't lose the attachment
  // (first mount consumes+clears it, second mount sees null).
  const lastConsumedAttachmentRef = useRef<string | null>(null)
  useEffect(() => {
    if (pendingAttachment && pendingAttachment.id !== lastConsumedAttachmentRef.current) {
      lastConsumedAttachmentRef.current = pendingAttachment.id
      setAttachments((prev) => [...prev, pendingAttachment])
      // Defer clearing so the attachment persists across StrictMode remounts
      setTimeout(() => onPendingAttachmentConsumed?.(), 0)
    }
  }, [pendingAttachment, onPendingAttachmentConsumed])

  const [isDragging, setIsDragging] = useState(false)

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const newAttachments: AttachmentData[] = []

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })

        const id = Math.random().toString(36).substring(2, 9)
        newAttachments.push({
          type: 'file' as const,
          id,
          mediaType: file.type,
          filename: file.name,
          url: dataUrl,
        })
      } catch (err) {
        console.error('[ChatInput] Failed to read file:', file.name, err)
      }
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments])
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set false if leaving the container (not entering a child)
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }, [processFiles])

  const handleSubmit = useCallback(() => {
    console.log('[ChatInput] handleSubmit called, attachments:', attachments.length, 'value:', value.substring(0, 50))
    const canSubmitWithAttachments = value.trim() || attachments.length > 0
    if (canSubmitWithAttachments && !isStreaming && !isDisabled) {
      console.log('[ChatInput] Calling onSubmit with', attachments.length, 'attachments')
      onSubmit(value.trim(), attachments)
      // Clear attachments after submit (data URLs don't need cleanup like blob URLs)
      setAttachments([])
    }
  }, [value, attachments, isStreaming, isDisabled, onSubmit])

  const handleAttachmentClick = useCallback(() => {
    console.log('[ChatInput] Attachment button clicked, fileInputRef:', !!fileInputRef.current)
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    await processFiles(files)
    e.target.value = ''
  }, [processFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        e.preventDefault()
        processFiles(imageFiles)
      }
    }
  }, [processFiles])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const maxTextareaHeight = 200 // ~7 visible lines at 24px line-height + padding

  // Auto-grow textarea after React commits the new value to the DOM
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    // Reset to auto so scrollHeight reflects actual content size
    textarea.style.height = 'auto'
    const scrollH = textarea.scrollHeight
    textarea.style.height = `${Math.min(scrollH, maxTextareaHeight)}px`
    textarea.style.overflowY = scrollH > maxTextareaHeight ? 'auto' : 'hidden'
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
    },
    [onChange]
  )

  const handleProviderSelect = useCallback((providerId: string) => {
    providerSelector?.onProviderChange(providerId)
    setIsDropdownOpen(false)
    setHoveredProvider(null)
  }, [providerSelector])

  const handleModelSelect = useCallback((modelId: string, providerId: string) => {
    providerSelector?.onProviderChange(providerId)
    providerSelector?.onModelChange?.(modelId)
    setIsDropdownOpen(false)
    setHoveredProvider(null)
  }, [providerSelector])

  const hasValue = value.trim().length > 0 || attachments.length > 0
  const canSubmit = hasValue && !isStreaming && !isDisabled

  // Check if provider is authenticated
  const isProviderAuth = providerSelector?.isAuthenticated ??
    providerSelector?.options.find(o => o.id === providerSelector?.provider)?.isAuthenticated

  const selectedOption = providerSelector?.options.find(o => o.id === providerSelector?.provider)
  const SelectedIcon = selectedOption?.id === 'claude' ? Bot : Cpu

  // Get the selected model label (for display when a model is selected)
  const selectedModel = providerSelector?.selectedModel
  const selectedModelOption = selectedOption?.models?.find(m => m.id === selectedModel)

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        position: 'relative',
        padding: isProvisioning ? '2px' : undefined,
        background: isProvisioning
          ? `conic-gradient(from var(--border-angle, 0deg), #3b82f6, #8b5cf6, #3b82f6) border-box`
          : undefined,
        ['--border-angle' as string]: '0deg',
        border: isDragging ? '2px dashed hsl(var(--primary))' : '2px dashed transparent',
        transition: 'border-color 150ms ease',
      }}
    >
      {/* Inner container to mask the gradient border */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: isProvisioning ? '14px' : '16px',
          backgroundColor: 'hsl(var(--muted))',
          position: 'relative',
        }}
      >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Image Previews using AI Elements Attachments component */}
      {attachments.length > 0 && (
        <div className="p-3 border-b border-border">
          <Attachments variant="grid">
            {attachments.map((attachment) => (
              <Attachment
                key={attachment.id}
                data={attachment}
                onRemove={() => handleRemoveAttachment(attachment.id)}
              >
                <AttachmentPreview />
                <AttachmentRemove />
              </Attachment>
            ))}
          </Attachments>
        </div>
      )}

      {/* Textarea area with agent indicator */}
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          disabled={isStreaming || isDisabled}
          style={{
            width: '100%',
            padding: '16px 48px 8px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: '15px',
            lineHeight: '24px',
            color: 'hsl(var(--foreground))',
            fontFamily: 'inherit',
            minHeight: '48px',
          }}
        />

        {/* Agent indicator - top right (small icon) */}
        {providerSelector && (
          <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: isProviderAuth ? 'rgba(34, 197, 94, 0.2)' : 'hsl(var(--border))',
                color: isProviderAuth ? '#22c55e' : 'hsl(var(--muted-foreground))',
              }}
              title={isProviderAuth ? 'Connected' : 'Not connected'}
            >
              <SelectedIcon size={14} />
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px 12px 12px',
        }}
      >
        {/* Left toolbar items */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {showAttachment && (
            <button
              type="button"
              onClick={handleAttachmentClick}
              disabled={isStreaming}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: '1px solid hsl(var(--border))',
                backgroundColor: 'transparent',
                color: attachments.length > 0 ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                cursor: isStreaming ? 'not-allowed' : 'pointer',
                transition: 'all 150ms ease',
                opacity: isStreaming ? 0.5 : 1,
              }}
              title="Add attachment"
            >
              <Plus size={15} strokeWidth={1.5} />
            </button>
          )}

          {/* Integrations Menu - next to attachment */}
          {integrationsMenu && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setIsIntegrationsOpen(!isIntegrationsOpen)}
                disabled={isStreaming}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: isIntegrationsOpen ? 'hsl(var(--card))' : 'transparent',
                  color: isIntegrationsOpen ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                  cursor: isStreaming ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease',
                  opacity: isStreaming ? 0.5 : 1,
                }}
                title="Integrations"
              >
                <Puzzle size={15} strokeWidth={1.5} />
              </button>

              {/* Integrations Dropdown */}
              <AnimatePresence>
                {isIntegrationsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: '6px',
                      minWidth: '220px',
                      padding: '4px',
                      borderRadius: '8px',
                      border: '1px solid hsl(var(--border))',
                      backgroundColor: 'hsl(var(--card))',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                      zIndex: 50,
                    }}
                  >
                    {integrationsMenu.integrations.map((integration) => (
                      <button
                        key={integration.id}
                        type="button"
                        onClick={() => {
                          if (integration.isConnected) {
                            integrationsMenu.onUse(integration.id)
                          } else if (
                            integration.id === 'firebase' ||
                            integration.id === 'convex' ||
                            integration.id === 'stripe' ||
                            integration.id === 'revenuecat'
                          ) {
                            integrationsMenu.onConnect(integration.id)
                          } else {
                            integrationsMenu.onUse(integration.id)
                          }
                          setIsIntegrationsOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: '5px',
                          border: 'none',
                          backgroundColor: 'transparent',
                          color: 'hsl(var(--foreground))',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 150ms ease',
                          textAlign: 'left',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'hsl(var(--muted))'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          {integration.icon}
                        </span>
                        <span style={{ flex: 1 }}>{integration.name}</span>
                        {integration.isConnected ? (
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              color: '#22c55e',
                            }}
                          >
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                backgroundColor: '#22c55e',
                              }}
                            />
                            Connected
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'hsl(var(--muted-foreground))',
                            }}
                          >
                            {integration.id === 'firebase' ||
                            integration.id === 'convex' ||
                            integration.id === 'stripe' ||
                            integration.id === 'revenuecat'
                              ? 'Connect'
                              : 'Set up'}
                          </span>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Click outside to close */}
              {isIntegrationsOpen && (
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 40,
                  }}
                  onClick={() => setIsIntegrationsOpen(false)}
                />
              )}
            </div>
          )}

          {/* Provider Dropdown Selector */}
          {providerSelector && (
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <button
                type="button"
                onClick={() => !providerSelector.disabled && setIsDropdownOpen(!isDropdownOpen)}
                disabled={isStreaming || providerSelector.disabled}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--card))',
                  color: 'hsl(var(--foreground))',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: isStreaming || providerSelector.disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease',
                  opacity: isStreaming || providerSelector.disabled ? 0.5 : 1,
                }}
              >
                <SelectedIcon size={12} />
                {selectedModelOption?.label || selectedOption?.label || 'Select'}
                {!providerSelector.disabled && <ChevronDown size={12} style={{ opacity: 0.6 }} />}
              </button>

              {/* Dropdown Menu */}
              <AnimatePresence>
                {isDropdownOpen && !providerSelector.disabled && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '6px',
                      minWidth: '140px',
                      padding: '4px',
                      borderRadius: '8px',
                      border: '1px solid hsl(var(--border))',
                      backgroundColor: 'hsl(var(--card))',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                      zIndex: 50,
                    }}
                  >
                    {providerSelector.options.map((option) => {
                      const isSelected = providerSelector.provider === option.id
                      const Icon = option.id === 'claude' ? Bot : Cpu
                      const optionAuth = option.isAuthenticated ?? providerSelector.isAuthenticated
                      const hasModels = option.models && option.models.length > 0
                      const isHovered = hoveredProvider === option.id

                      return (
                        <div
                          key={option.id}
                          style={{ position: 'relative' }}
                          onMouseEnter={() => hasModels && setHoveredProvider(option.id)}
                          onMouseLeave={() => setHoveredProvider(null)}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (!hasModels) {
                                handleProviderSelect(option.id)
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: '5px',
                              border: 'none',
                              backgroundColor: isSelected || isHovered ? 'hsl(var(--muted))' : 'transparent',
                              color: 'hsl(var(--foreground))',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              transition: 'all 150ms ease',
                              textAlign: 'left',
                            }}
                          >
                            <Icon size={14} />
                            <span style={{ flex: 1 }}>{option.label}</span>
                            {optionAuth && (
                              <span
                                style={{
                                  width: '5px',
                                  height: '5px',
                                  borderRadius: '50%',
                                  backgroundColor: '#22c55e',
                                }}
                              />
                            )}
                            {hasModels ? (
                              <ChevronRight size={12} style={{ opacity: 0.6 }} />
                            ) : isSelected ? (
                              <Check size={12} style={{ opacity: 0.6 }} />
                            ) : null}
                          </button>

                          {/* Model Sub-menu */}
                          <AnimatePresence>
                            {hasModels && isHovered && (
                              <motion.div
                                initial={{ opacity: 0, x: -8, scale: 0.95 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                exit={{ opacity: 0, x: -8, scale: 0.95 }}
                                transition={{ duration: 0.12 }}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: '100%',
                                  marginLeft: '4px',
                                  minWidth: '160px',
                                  padding: '4px',
                                  borderRadius: '8px',
                                  border: '1px solid hsl(var(--border))',
                                  backgroundColor: 'hsl(var(--card))',
                                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                                  zIndex: 51,
                                }}
                              >
                                {option.models!.map((model) => {
                                  const isModelSelected = providerSelector.provider === option.id &&
                                    providerSelector.selectedModel === model.id
                                  return (
                                    <button
                                      key={model.id}
                                      type="button"
                                      onClick={() => handleModelSelect(model.id, option.id)}
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-start',
                                        gap: '2px',
                                        width: '100%',
                                        padding: '8px 10px',
                                        borderRadius: '5px',
                                        border: 'none',
                                        backgroundColor: isModelSelected ? 'hsl(var(--muted))' : 'transparent',
                                        color: 'hsl(var(--foreground))',
                                        fontSize: '12px',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        transition: 'all 150ms ease',
                                        textAlign: 'left',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'hsl(var(--muted))'
                                      }}
                                      onMouseLeave={(e) => {
                                        if (!isModelSelected) {
                                          e.currentTarget.style.backgroundColor = 'transparent'
                                        }
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                                        <span style={{ flex: 1 }}>{model.label}</span>
                                        {isModelSelected && <Check size={12} style={{ opacity: 0.6 }} />}
                                      </div>
                                      {model.description && (
                                        <span style={{ fontSize: '10px', color: 'hsl(var(--muted-foreground))', fontWeight: 400 }}>
                                          {model.description}
                                        </span>
                                      )}
                                    </button>
                                  )
                                })}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Click outside to close */}
              {isDropdownOpen && !providerSelector.disabled && (
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 40,
                  }}
                  onClick={() => {
                    setIsDropdownOpen(false)
                    setHoveredProvider(null)
                  }}
                />
              )}
            </div>
          )}

          {/* App Type Selector */}
          {appTypeSelector && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setIsAppTypeDropdownOpen(!isAppTypeDropdownOpen)}
                disabled={isStreaming}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--card))',
                  color: 'hsl(var(--foreground))',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: isStreaming ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease',
                  opacity: isStreaming ? 0.5 : 1,
                }}
              >
                {appTypeSelector.appType === 'mobile' ? (
                  <Smartphone size={12} />
                ) : (
                  <Globe size={12} />
                )}
                {appTypeSelector.appType === 'mobile' ? 'Mobile' : 'Web'}
                <ChevronDown size={12} style={{ opacity: 0.6 }} />
              </button>

              {/* App Type Dropdown Menu */}
              <AnimatePresence>
                {isAppTypeDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '6px',
                      minWidth: '120px',
                      padding: '4px',
                      borderRadius: '8px',
                      border: '1px solid hsl(var(--border))',
                      backgroundColor: 'hsl(var(--card))',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                      zIndex: 50,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        appTypeSelector.onAppTypeChange('mobile')
                        setIsAppTypeDropdownOpen(false)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '5px',
                        border: 'none',
                        backgroundColor: appTypeSelector.appType === 'mobile' ? 'hsl(var(--muted))' : 'transparent',
                        color: 'hsl(var(--foreground))',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        textAlign: 'left',
                      }}
                    >
                      <Smartphone size={14} />
                      <span style={{ flex: 1 }}>Mobile</span>
                      {appTypeSelector.appType === 'mobile' && <Check size={12} style={{ opacity: 0.6 }} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        appTypeSelector.onAppTypeChange('web')
                        setIsAppTypeDropdownOpen(false)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '5px',
                        border: 'none',
                        backgroundColor: appTypeSelector.appType === 'web' ? 'hsl(var(--muted))' : 'transparent',
                        color: 'hsl(var(--foreground))',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        textAlign: 'left',
                      }}
                    >
                      <Globe size={14} />
                      <span style={{ flex: 1 }}>Web</span>
                      {appTypeSelector.appType === 'web' && <Check size={12} style={{ opacity: 0.6 }} />}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Click outside to close */}
              {isAppTypeDropdownOpen && (
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 40,
                  }}
                  onClick={() => setIsAppTypeDropdownOpen(false)}
                />
              )}
            </div>
          )}
        </div>

        {/* Right toolbar items */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {showMic && (
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
              title="Voice input"
            >
              <Mic size={16} strokeWidth={1.5} />
            </button>
          )}

          <AnimatePresence mode="wait">
            {isStreaming ? (
              <motion.button
                key="stop"
                type="button"
                onClick={onStop}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.95 }}
                title="Stop generating"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
              >
                <Square size={12} fill="currentColor" />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.95 }}
                title="Send message"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: canSubmit ? 'hsl(var(--foreground))' : 'hsl(var(--border))',
                  color: canSubmit ? 'hsl(var(--background))' : 'hsl(var(--muted-foreground))',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  transition: 'all 150ms ease',
                }}
              >
                <ArrowUp size={15} strokeWidth={2} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      </div>
    </div>
  )
}
