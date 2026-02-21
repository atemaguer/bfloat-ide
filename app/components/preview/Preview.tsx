import { useRef, useEffect, useState, useCallback } from 'react'
import { useIsWebApp } from '@/app/hooks/useAppType'
import {
  ArrowLeft,
  ArrowRight,
  RefreshCcw,
  Loader2,
  AlertCircle,
  ExternalLink,
  Bug,
  Maximize2,
  Copy,
  Check,
  Smartphone,
  Tablet,
  Play,
  RotateCw,
  Camera,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { IPhoneFrame } from './IPhoneFrame'
import { Button } from '../ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import type { AppType } from '@/app/types/project'
import { WebPreview, WebPreviewNavigation, WebPreviewNavigationButton } from '../ai-elements/web-preview'
import { screenshot } from '@/app/api/sidecar'

// Electron webview element type
interface WebviewElement extends HTMLElement {
  src: string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
  getURL: () => string
  getWebContentsId: () => number
  addEventListener: (event: string, callback: (e: unknown) => void) => void
  removeEventListener: (event: string, callback: (e: unknown) => void) => void
}

/** True when running inside a Tauri webview (no Electron webview tag support). */
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface PreviewProps {
  previewUrl: string
  serverStatus: 'starting' | 'running' | 'error'
  onRefresh: () => void
  onRestartServer?: () => void
  expoUrl?: string
  appType?: AppType
  projectTitle?: string
  onError?: (error: string) => void
  onLaunchIOSSimulator?: () => void
  onLaunchAndroidEmulator?: () => void
  onScreenshot?: (dataUrl: string) => void
}

export function Preview(props: PreviewProps) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const webIframeRef = useRef<HTMLIFrameElement | null>(null) // For Tauri web preview (replaces webview)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const [isCapturing, setIsCapturing] = useState(false)

  // Browser-like URL state - can be set by user input OR auto-detection
  const [currentUrl, setCurrentUrl] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // Update URL when auto-detected from terminal or set programmatically
  // Only depends on props.previewUrl to avoid missing updates
  useEffect(() => {
    if (props.previewUrl) {
      // Strip query params to compare base URLs (ignore refresh timestamps)
      const basePropsUrl = props.previewUrl.split('?')[0]
      const baseCurrentUrl = currentUrl.split('?')[0]

      // Always update if base URL changes, or if currentUrl is empty
      if (!currentUrl || basePropsUrl !== baseCurrentUrl) {
        console.log('[Preview] Setting preview URL:', props.previewUrl)
        setCurrentUrl(props.previewUrl)
        setUrlInput(basePropsUrl) // Show clean URL without timestamp in input
      }
    } else if (currentUrl) {
      // Reset when previewUrl becomes empty (e.g., project switch)
      console.log('[Preview] Clearing preview URL (project switch)')
      setCurrentUrl('')
      setUrlInput('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.previewUrl]) // Only react to prop changes, not currentUrl changes

  // Track the webview's webContentsId for screenshot capture
  const [webContentsId, setWebContentsId] = useState<number | null>(null)

  // Setup webview event listeners (Electron only — Tauri uses iframe events)
  useEffect(() => {
    if (isTauri) return // Tauri uses onLoad/onError on the iframe directly

    const webview = webviewRef.current
    if (!webview) return

    const handleDidStartLoading = () => {
      setIsLoading(true)
    }

    const handleDidStopLoading = () => {
      setIsLoading(false)
      // Update navigation state
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const handleDidNavigate = (e: { url: string }) => {
      console.log('[Preview] Navigated to:', e.url)
      setUrlInput(e.url)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const handleDidFailLoad = (e: { errorCode: number; errorDescription: string }) => {
      console.error('[Preview] Failed to load:', e.errorDescription)
      setIsLoading(false)
    }

    const handleConsoleMessage = (e: { level: number; message: string }) => {
      // Level 2 = error, 1 = warning
      if (e.level >= 1 && props.onError) {
        if (e.message.toLowerCase().includes('error')) {
          props.onError(e.message)
        }
      }
    }

    const handleDomReady = () => {
      try {
        const id = webview.getWebContentsId()
        setWebContentsId(id)
        ;(window as any).__bfloatPreviewWebContentsId = id
      } catch {
        // webview may not support getWebContentsId in all contexts
      }
    }

    webview.addEventListener('did-start-loading', handleDidStartLoading as (e: unknown) => void)
    webview.addEventListener('did-stop-loading', handleDidStopLoading as (e: unknown) => void)
    webview.addEventListener('did-navigate', handleDidNavigate as (e: unknown) => void)
    webview.addEventListener('did-navigate-in-page', handleDidNavigate as (e: unknown) => void)
    webview.addEventListener('did-fail-load', handleDidFailLoad as (e: unknown) => void)
    webview.addEventListener('console-message', handleConsoleMessage as (e: unknown) => void)
    webview.addEventListener('dom-ready', handleDomReady as (e: unknown) => void)

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading as (e: unknown) => void)
      webview.removeEventListener('did-stop-loading', handleDidStopLoading as (e: unknown) => void)
      webview.removeEventListener('did-navigate', handleDidNavigate as (e: unknown) => void)
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate as (e: unknown) => void)
      webview.removeEventListener('did-fail-load', handleDidFailLoad as (e: unknown) => void)
      webview.removeEventListener('console-message', handleConsoleMessage as (e: unknown) => void)
      webview.removeEventListener('dom-ready', handleDomReady as (e: unknown) => void)
      ;(window as any).__bfloatPreviewWebContentsId = 0
    }
  }, [currentUrl, props])

  // Navigate to a URL (normalize it first)
  const navigateToUrl = useCallback((url: string) => {
    let normalizedUrl = url.trim()
    if (!normalizedUrl) return

    // Add protocol if missing
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      // For localhost, use http
      if (normalizedUrl.startsWith('localhost') || normalizedUrl.match(/^127\.\d+\.\d+\.\d+/)) {
        normalizedUrl = 'http://' + normalizedUrl
      } else {
        normalizedUrl = 'https://' + normalizedUrl
      }
    }

    console.log('[Preview] Navigating to:', normalizedUrl)
    setIsLoading(true)
    setCurrentUrl(normalizedUrl)
    setUrlInput(normalizedUrl)
  }, [])

  // Handle URL input submission
  const handleUrlSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        navigateToUrl(urlInput)
      }
    },
    [urlInput, navigateToUrl]
  )

  // Navigation handlers — work with both Electron webview and Tauri iframe
  const handleGoBack = useCallback(() => {
    if (isTauri) {
      try { webIframeRef.current?.contentWindow?.history.back() } catch { /* cross-origin */ }
    } else {
      webviewRef.current?.goBack()
    }
  }, [])

  const handleGoForward = useCallback(() => {
    if (isTauri) {
      try { webIframeRef.current?.contentWindow?.history.forward() } catch { /* cross-origin */ }
    } else {
      webviewRef.current?.goForward()
    }
  }, [])

  const handleRefresh = useCallback(() => {
    if (isTauri) {
      const iframe = webIframeRef.current
      if (iframe) {
        // Force reload by re-assigning the src
        const src = iframe.src
        iframe.src = ''
        iframe.src = src
      }
    } else if (webviewRef.current) {
      webviewRef.current.reload()
    }
    props.onRefresh()
  }, [props])

  const handleToggleDevTools = useCallback(() => {
    if (isTauri) return // DevTools not available for iframes in Tauri

    const webview = webviewRef.current
    if (!webview) return

    if (webview.isDevToolsOpened()) {
      webview.closeDevTools()
      setIsDevToolsOpen(false)
    } else {
      webview.openDevTools()
      setIsDevToolsOpen(true)
    }
  }, [])

  // Determine if this is a web app or mobile app using the context hook
  const isWebApp = useIsWebApp()

  const handleOpenExternal = useCallback(() => {
    if (currentUrl) {
      window.open(currentUrl, '_blank')
    }
  }, [currentUrl])

  // Iframe handlers for mobile preview
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false)
  }, [])

  const handleIframeError = useCallback(() => {
    setIsLoading(false)
    if (props.onError) {
      props.onError('Failed to load preview')
    }
  }, [props])

  // Copy expo URL to clipboard
  const handleCopyExpoUrl = useCallback(() => {
    if (props.expoUrl) {
      navigator.clipboard.writeText(props.expoUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [props.expoUrl])

  /**
   * Crop a full-window screenshot to match a DOM element's bounding rect.
   * Returns a PNG data URL of the cropped region.
   */
  const cropToElement = useCallback(
    (fullDataUrl: string, element: HTMLElement): Promise<string> => {
      return new Promise((resolve, reject) => {
        const rect = element.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(rect.width * dpr)
          canvas.height = Math.round(rect.height * dpr)
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Failed to get canvas 2d context'))
            return
          }
          ctx.drawImage(
            img,
            Math.round(rect.x * dpr),
            Math.round(rect.y * dpr),
            Math.round(rect.width * dpr),
            Math.round(rect.height * dpr),
            0,
            0,
            canvas.width,
            canvas.height
          )
          resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('Failed to load screenshot image for cropping'))
        img.src = fullDataUrl
      })
    },
    []
  )

  const handleScreenshot = useCallback(async () => {
    const url = currentUrl || props.previewUrl
    if (!url || isCapturing || !props.onScreenshot) return

    setIsCapturing(true)
    try {
      // Path 1: Electron <webview> — capture directly from its webContents
      if (webContentsId && webContentsId > 0) {
        const result = await screenshot.capture(webContentsId)
        if (result.success && result.dataUrl) {
          props.onScreenshot(result.dataUrl)
          return
        }
        console.warn('[Preview] webContents capture failed, trying window capture')
      }

      // Path 2: Full window capture → crop to the preview element
      const result = await screenshot.capture()
      if (!result.success || !result.dataUrl) {
        console.error('[Preview] Screenshot failed:', result.error)
        return
      }

      // Find the preview element to crop to
      const previewEl =
        (webviewRef.current as HTMLElement | null) ||
        webIframeRef.current ||
        iframeRef.current

      if (previewEl) {
        try {
          const cropped = await cropToElement(result.dataUrl, previewEl)
          props.onScreenshot(cropped)
        } catch {
          // Crop failed — send the full window capture anyway
          props.onScreenshot(result.dataUrl)
        }
      } else {
        // No preview element ref — send the full window capture
        props.onScreenshot(result.dataUrl)
      }
    } catch (err) {
      console.error('[Preview] Screenshot error:', err)
    } finally {
      setIsCapturing(false)
    }
  }, [currentUrl, props, isCapturing, webContentsId, cropToElement])

  console.log(
    '[Preview] Current URL:',
    currentUrl,
    'Status:',
    props.serverStatus,
    'AppType:',
    props.appType,
    'ExpoUrl:',
    props.expoUrl
  )

  // Web app preview - Browser-like experience using Electron webview
  if (isWebApp) {
    return (
      <div className={`w-full h-full flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : ''}`}>
        <WebPreview defaultUrl={currentUrl} className={`flex-1 rounded-none border-0`}>
          <WebPreviewNavigation>
            <WebPreviewNavigationButton tooltip="Go back" onClick={handleGoBack} disabled={!canGoBack}>
              <ArrowLeft className="size-5" />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton tooltip="Go forward" onClick={handleGoForward} disabled={!canGoForward}>
              <ArrowRight className="size-5" />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton tooltip="Reload" onClick={handleRefresh}>
              <RefreshCcw className={`size-5 ${isLoading ? 'animate-spin' : ''}`} />
            </WebPreviewNavigationButton>

            {/* Functional URL bar */}
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleUrlSubmit}
              placeholder="Enter URL (e.g., localhost:9000)"
              className="h-8 flex-1 text-sm bg-background border border-border/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 rounded-lg px-3"
            />

            {!isTauri && (
              <WebPreviewNavigationButton
                tooltip="DevTools"
                onClick={handleToggleDevTools}
                className={isDevToolsOpen ? 'bg-foreground/10' : ''}
              >
                <Bug className="size-5" />
              </WebPreviewNavigationButton>
            )}
            <WebPreviewNavigationButton tooltip="Open in browser" onClick={handleOpenExternal} disabled={!currentUrl}>
              <ExternalLink className="size-5" />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton
              tooltip={isFullscreen ? 'Exit fullscreen' : 'Maximize'}
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              <Maximize2 className="size-5" />
            </WebPreviewNavigationButton>
            {props.onRestartServer && (
              <WebPreviewNavigationButton
                tooltip="Restart dev server"
                onClick={props.onRestartServer}
              >
                <RotateCw className="size-5" />
              </WebPreviewNavigationButton>
            )}
            {props.onScreenshot && (
              <WebPreviewNavigationButton
                tooltip="Screenshot to chat"
                onClick={handleScreenshot}
                disabled={!currentUrl || isCapturing}
              >
                <Camera className={`size-5 ${isCapturing ? 'animate-pulse' : ''}`} />
              </WebPreviewNavigationButton>
            )}
          </WebPreviewNavigation>

          {props.serverStatus === 'error' ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-background p-4">
              <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
              <p className="text-sm text-center text-foreground">Dev server failed to start</p>
              <p className="text-xs text-muted-foreground text-center mt-2">Check terminal for details</p>
              {props.onRestartServer && (
                <button
                  onClick={props.onRestartServer}
                  className="mt-4 flex items-center gap-2 px-4 py-2 text-sm bg-foreground/10 hover:bg-foreground/15 rounded-lg text-foreground transition-colors"
                >
                  <RotateCw className="h-4 w-4" />
                  Restart server
                </button>
              )}
            </div>
          ) : currentUrl ? (
            <div className="flex-1 relative bg-white">
              {isTauri ? (
                <iframe
                  ref={webIframeRef}
                  src={currentUrl}
                  className="w-full h-full border-0 bg-white"
                  allow="geolocation; camera; microphone; screen-wake-lock; clipboard-read; clipboard-write; accelerometer; gyroscope"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation allow-top-navigation"
                  loading="eager"
                  title="Web Preview"
                  onLoad={() => setIsLoading(false)}
                  onError={() => {
                    setIsLoading(false)
                    if (props.onError) props.onError('Failed to load preview')
                  }}
                />
              ) : (
                // @ts-expect-error - webview is an Electron-specific element
                <webview ref={webviewRef} src={currentUrl} style={{ width: '100%', height: '100%' }} allowpopups="true" />
              )}
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Loader2 className="animate-spin h-8 w-8 text-white" />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-background p-6">
              <p className="text-sm text-muted-foreground mb-2">Enter a URL above to preview</p>
              <p className="text-xs text-muted-foreground/70 text-center">
                Type a localhost URL (e.g., localhost:9000) or any web URL and press Enter
              </p>
            </div>
          )}
        </WebPreview>
      </div>
    )
  }

  // Mobile app preview (Expo) - iPhone frame with QR code
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 min-h-0 flex items-center justify-center gap-8 p-4">
        {/* iPhone Preview */}
        <div className="flex flex-col items-center h-full max-h-full min-h-0">
          <div className="flex items-center gap-1 mb-2 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={props.onRefresh}>
                  <RefreshCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Reload preview</p>
              </TooltipContent>
            </Tooltip>
            {props.onRestartServer && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={props.onRestartServer}>
                    <RotateCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Restart dev server</p>
                </TooltipContent>
              </Tooltip>
            )}
            {props.onScreenshot && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={handleScreenshot} disabled={!(currentUrl || props.previewUrl) || isCapturing}>
                    <Camera className={`h-4 w-4 ${isCapturing ? 'animate-pulse' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Screenshot to chat</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <IPhoneFrame showStatusBar={false} showHomeIndicator={false} className="flex-1 min-h-0">
            {props.serverStatus === 'error' ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black p-4 text-white">
                <AlertCircle className="h-8 w-8 text-red-500 mb-2" />
                <p className="text-sm text-center">Dev server failed to start</p>
                <p className="text-xs text-white/50 text-center mt-2">Check terminal for details</p>
                {props.onRestartServer && (
                  <button
                    onClick={props.onRestartServer}
                    className="mt-4 flex items-center gap-2 px-4 py-2 text-sm bg-white/10 hover:bg-white/15 rounded-lg text-white transition-colors"
                  >
                    <RotateCw className="h-4 w-4" />
                    Restart server
                  </button>
                )}
              </div>
            ) : props.previewUrl ? (
              <iframe
                className="w-full h-full border-0 bg-white"
                ref={iframeRef}
                src={props.previewUrl}
                allow="geolocation; camera; microphone; screen-wake-lock; clipboard-read; clipboard-write; accelerometer; gyroscope"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation allow-top-navigation"
                loading="eager"
                style={{ display: 'block', overflow: 'hidden' }}
                name="app-preview"
                id="app-preview"
                title="App Preview"
                onLoad={handleIframeLoad}
                onError={handleIframeError}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white">
                <Loader2 className="animate-spin h-8 w-8 mb-2" />
                <p className="text-sm">Starting dev server...</p>
              </div>
            )}
          </IPhoneFrame>
        </div>

        {/* Right Panel - Simulators and QR Code */}
        <div className="flex flex-col gap-4">
          {/* Simulator Launch Buttons */}
          {props.serverStatus === 'running' && (props.onLaunchIOSSimulator || props.onLaunchAndroidEmulator) && (
            <div className="flex flex-col items-center gap-3 p-5 bg-background border border-border rounded-2xl">
              <div className="flex items-center gap-2 text-foreground/90">
                <Play className="h-5 w-5" />
                <span className="font-medium">Run on Simulator</span>
              </div>

              <div className="flex gap-3 w-full">
                {props.onLaunchIOSSimulator && (
                  <button
                    onClick={props.onLaunchIOSSimulator}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-b from-foreground/10 to-foreground/5 hover:from-foreground/15 hover:to-foreground/10 border border-border rounded-xl text-foreground/90 font-medium transition-all"
                  >
                    <Smartphone className="h-5 w-5" />
                    <span>iOS</span>
                  </button>
                )}
                {props.onLaunchAndroidEmulator && (
                  <button
                    onClick={props.onLaunchAndroidEmulator}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-b from-foreground/10 to-foreground/5 hover:from-foreground/15 hover:to-foreground/10 border border-border rounded-xl text-foreground/90 font-medium transition-all"
                  >
                    <Tablet className="h-5 w-5" />
                    <span>Android</span>
                  </button>
                )}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Requires Xcode (iOS) or Android Studio (Android)
              </p>
            </div>
          )}

          {/* QR Code Panel - Only show when expoUrl is available */}
          {props.expoUrl && (
            <div className="flex flex-col items-center gap-4 p-6 bg-background border border-border rounded-2xl max-w-[280px]">
              <div className="flex items-center gap-2 text-foreground/90">
                <Smartphone className="h-5 w-5" />
                <span className="font-medium">Preview on your phone</span>
              </div>

              {/* QR Code */}
              <div className="p-4 bg-white rounded-xl">
                <QRCodeSVG
                  value={props.expoUrl}
                  size={180}
                  level="M"
                  includeMargin={false}
                  imageSettings={{
                    src: 'https://expo.dev/static/brand/expo-go-app-icon.png',
                    height: 36,
                    width: 36,
                    excavate: true,
                  }}
                />
              </div>

              {/* URL with copy button */}
              <div className="w-full flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border">
                <span className="flex-1 text-sm text-muted-foreground truncate font-mono">{props.expoUrl}</span>
                <button
                  onClick={handleCopyExpoUrl}
                  className="p-1.5 hover:bg-foreground/10 rounded transition-colors"
                  title="Copy URL"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>

              {/* Instructions */}
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                Scan with the <span className="text-foreground/70 font-medium">Expo Go</span> app on your iOS or Android
                device to preview natively.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
