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
  ChevronDown,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import bfloatIcon from '@/app/assets/plain-icon-dark.png'
import { IPhoneFrame } from './IPhoneFrame'
import { Button } from '../ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip'
import type { AppType } from '@/app/types/project'
import { WebPreview, WebPreviewNavigation, WebPreviewNavigationButton } from '../ai-elements/web-preview'
import { screenshot, getPreviewProxyUrl } from '@/app/api/sidecar'
import { workbenchStore } from '@/app/stores/workbench'

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

/**
 * On Tauri, wrap the preview URL through the sidecar reverse proxy so that
 * an error-catching script is injected into the HTML.  On Electron this is a
 * no-op — error capture uses the webview's native `console-message` event.
 */
function proxyUrl(url: string): string {
  if (!isTauri || !url) return url
  try {
    return getPreviewProxyUrl(url)
  } catch {
    // SidecarApi not initialised yet — fall back to raw URL
    return url
  }
}

interface PreviewProps {
  previewUrl: string
  serverStatus: 'starting' | 'running' | 'error'
  isTerminalOpen: boolean
  terminalHeight: number
  onRefresh: () => void
  onRestartServer?: () => void
  expoUrl?: string
  appType?: AppType
  projectTitle?: string
  onError?: (error: string) => void
  onLaunchIOSSimulator?: () => void
  onLaunchAndroidEmulator?: () => void
  onScreenshot?: (dataUrl: string) => void
  refreshKey?: number
}

// Compact mode should only activate on genuinely small preview panes.
const COMPACT_PANE_PX = 520
const TIGHT_PANE_PX = 420
const MOBILE_PREVIEW_STYLE_ID = 'bfloat-mobile-preview-guard'
const MOBILE_PREVIEW_FIT_ROOT_ATTR = 'data-bfloat-fit-root'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isSameOriginWithHost(url?: string): boolean {
  if (!url || typeof window === 'undefined') return false
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

export function Preview(props: PreviewProps) {
  const webviewRef = useRef<WebviewElement | null>(null)
  const webIframeRef = useRef<HTMLIFrameElement | null>(null) // For Tauri web preview (replaces webview)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const mobileLayoutRef = useRef<HTMLDivElement | null>(null)
  const mobilePreviewGuardCleanupRef = useRef<(() => void) | null>(null)
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
  const [mobileLayoutWidth, setMobileLayoutWidth] = useState(0)
  const [mobileLayoutHeight, setMobileLayoutHeight] = useState(0)
  const [expandedSection, setExpandedSection] = useState<'simulator' | 'qr' | null>(null)
  const isWebApp = useIsWebApp()

  // Update URL when auto-detected from terminal or set programmatically
  // Only depends on props.previewUrl to avoid missing updates
  useEffect(() => {
    if (props.previewUrl) {
      // Only update if the base URL actually changed (different port/host)
      if (!currentUrl || props.previewUrl !== currentUrl) {
        console.log('[Preview] Setting preview URL:', props.previewUrl)
        setCurrentUrl(props.previewUrl)
        setUrlInput(props.previewUrl)

        // Register the preview URL with the sidecar for screenshot capture
        const cwd = workbenchStore.projectPath.getState() || ''
        if (cwd) {
          screenshot.registerPreviewUrl?.(cwd, props.previewUrl)?.catch(() => {
            // Non-critical — screenshot registration failure shouldn't block preview
          })
        }
      }
    } else if (currentUrl) {
      // Reset when previewUrl becomes empty (e.g., project switch)
      console.log('[Preview] Clearing preview URL (project switch)')
      setCurrentUrl('')
      setUrlInput('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.previewUrl]) // Only react to prop changes, not currentUrl changes


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

  // Listen for postMessage errors from the injected error-capture script (Tauri only).
  // On Electron, errors are captured via the webview's `console-message` event above.
  useEffect(() => {
    if (!isTauri) return
    const handler = (event: MessageEvent) => {
      const expectedSource = isWebApp ? webIframeRef.current?.contentWindow : iframeRef.current?.contentWindow
      if (!expectedSource || event.source !== expectedSource) return

      const iframeSrc = isWebApp ? webIframeRef.current?.src : iframeRef.current?.src
      if (!iframeSrc) return

      let expectedOrigin: string
      try {
        expectedOrigin = new URL(iframeSrc, window.location.href).origin
      } catch {
        return
      }

      if (event.origin !== expectedOrigin) return

      if (event.data?.type === 'bfloat-preview-route') {
        if (!isWebApp) return
        const nextPath = typeof event.data?.path === 'string' ? event.data.path : ''
        if (!nextPath) return

        try {
          const base = new URL(currentUrl || props.previewUrl || window.location.href)
          const normalizedPath = nextPath.startsWith('/') ? nextPath : `/${nextPath}`
          setUrlInput(`${base.origin}${normalizedPath}`)
        } catch {
          // Ignore malformed route payloads
        }
        return
      }

      if (event.data?.type === 'bfloat-preview-error' && props.onError) {
        const { message, stack } = event.data
        const errorText = stack ? `${message}\n${stack}` : message
        props.onError(errorText)
        return
      }

      if (event.data?.type === 'bfloat-preview-open-external') {
        const url = typeof event.data?.url === 'string' ? event.data.url.trim() : ''
        if (!url) return
        if (!/^https?:\/\//i.test(url)) return

        const bridgeOpen = (window as any).conveyor?.window?.webOpenUrl as ((target: string) => Promise<void>) | undefined
        if (bridgeOpen) {
          bridgeOpen(url).catch((err: unknown) => {
            console.warn('[Preview] Failed to open external URL via bridge:', err)
            window.open(url, '_blank', 'noopener,noreferrer')
          })
          return
        }

        window.open(url, '_blank', 'noopener,noreferrer')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isWebApp, currentUrl, props.previewUrl, props.onError])

  const handleWebIframeLoad = useCallback(() => {
    setIsLoading(false)

    if (!isTauri) return
    try {
      const location = webIframeRef.current?.contentWindow?.location
      const iframePath = location
        ? `${location.pathname}${location.search}${location.hash}`
        : ''

      if (!iframePath) return

      const base = new URL(currentUrl || props.previewUrl || window.location.href)
      setUrlInput(`${base.origin}${iframePath.startsWith('/') ? iframePath : `/${iframePath}`}`)
    } catch {
      // Ignore cross-origin or malformed URL failures
    }
  }, [currentUrl, props.previewUrl])

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
      if (!isSameOriginWithHost(currentUrl || webIframeRef.current?.src)) return
      try { webIframeRef.current?.contentWindow?.history.back() } catch { /* cross-origin */ }
    } else {
      webviewRef.current?.goBack()
    }
  }, [currentUrl])

  const handleGoForward = useCallback(() => {
    if (isTauri) {
      if (!isSameOriginWithHost(currentUrl || webIframeRef.current?.src)) return
      try { webIframeRef.current?.contentWindow?.history.forward() } catch { /* cross-origin */ }
    } else {
      webviewRef.current?.goForward()
    }
  }, [currentUrl])

  const handleRefresh = useCallback(() => {
    if (isTauri) {
      // Best-effort same-origin reload; cross-origin fallback handled by
      // refreshKey remount triggered via onRefresh -> parent state update
      if (isSameOriginWithHost(currentUrl || webIframeRef.current?.src)) {
        try {
          webIframeRef.current?.contentWindow?.location.reload()
        } catch {
          // Cross-origin — the refreshKey remount will handle it
        }
      }
    } else if (webviewRef.current) {
      webviewRef.current.reload()
    }
    props.onRefresh()
  }, [currentUrl, props])

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

  // Adapt mobile preview layout to container dimensions (not viewport size).
  useEffect(() => {
    if (isWebApp) return
    const el = mobileLayoutRef.current
    if (!el) return

    const updateSize = () => {
      setMobileLayoutWidth(el.clientWidth)
      setMobileLayoutHeight(el.clientHeight)
    }
    updateSize()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setMobileLayoutWidth(entry.contentRect.width)
      setMobileLayoutHeight(entry.contentRect.height)
    })
    observer.observe(el)

    return () => observer.disconnect()
  }, [isWebApp])

  const handleOpenExternal = useCallback(() => {
    if (currentUrl) {
      window.open(currentUrl, '_blank')
    }
  }, [currentUrl])

  // Iframe handlers for mobile preview
  const cleanupMobilePreviewGuard = useCallback(() => {
    mobilePreviewGuardCleanupRef.current?.()
    mobilePreviewGuardCleanupRef.current = null
  }, [])

  const applyMobileViewportGuards = useCallback((iframe: HTMLIFrameElement | null) => {
    cleanupMobilePreviewGuard()
    if (!iframe) return
    if (!isSameOriginWithHost(iframe.src)) return

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) return

      const viewportContent = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      let viewportMeta = doc.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
      if (!viewportMeta) {
        viewportMeta = doc.createElement('meta')
        viewportMeta.setAttribute('name', 'viewport')
        ;(doc.head || doc.documentElement).appendChild(viewportMeta)
      }
      viewportMeta.setAttribute('content', viewportContent)

      let styleEl = doc.getElementById(MOBILE_PREVIEW_STYLE_ID) as HTMLStyleElement | null
      if (!styleEl) {
        styleEl = doc.createElement('style')
        styleEl.id = MOBILE_PREVIEW_STYLE_ID
        ;(doc.head || doc.documentElement).appendChild(styleEl)
      }
      styleEl.textContent = `
        html, body, #root, #__next, [data-expo-root] {
          width: 100% !important;
          max-width: 100% !important;
          height: 100% !important;
          min-height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        *, *::before, *::after { box-sizing: border-box !important; }
        img, video, canvas, svg { max-width: 100% !important; }
      `

      const getFitRoot = () => {
        return (
          doc.querySelector('[data-expo-root]') ||
          doc.getElementById('root') ||
          doc.getElementById('__next') ||
          doc.body?.firstElementChild ||
          doc.body
        ) as HTMLElement | null
      }

      const clearFitScale = (el: HTMLElement | null) => {
        if (!el) return
        el.removeAttribute(MOBILE_PREVIEW_FIT_ROOT_ATTR)
        el.style.removeProperty('transform')
        el.style.removeProperty('transform-origin')
        el.style.removeProperty('width')
        el.style.removeProperty('height')
      }

      let activeRoot: HTMLElement | null = null
      let rafId: number | null = null
      const timers = new Set<number>()

      const applyFitScale = () => {
        const root = getFitRoot()
        if (!root) return

        if (activeRoot !== root) {
          clearFitScale(activeRoot)
          activeRoot = root
          activeRoot.setAttribute(MOBILE_PREVIEW_FIT_ROOT_ATTR, 'true')
        }

        const viewportWidth = Math.max(1, iframe.clientWidth || doc.documentElement.clientWidth || 1)
        const viewportHeight = Math.max(1, iframe.clientHeight || doc.documentElement.clientHeight || 1)
        const rootRect = root.getBoundingClientRect()
        const contentWidth = Math.max(root.scrollWidth, rootRect.width)
        const contentHeight = Math.max(root.scrollHeight, rootRect.height)
        const scale = Math.min(1, viewportWidth / Math.max(contentWidth, 1), viewportHeight / Math.max(contentHeight, 1))
        const roundedScale = Math.max(0.5, Math.round(scale * 1000) / 1000)

        if (roundedScale >= 0.999) {
          clearFitScale(activeRoot)
          return
        }

        root.style.setProperty('transform-origin', 'top center', 'important')
        root.style.setProperty('transform', `scale(${roundedScale})`, 'important')
        root.style.setProperty('width', `${100 / roundedScale}%`, 'important')
        root.style.setProperty('height', `${100 / roundedScale}%`, 'important')
      }

      const scheduleFit = () => {
        if (rafId !== null) return
        rafId = window.requestAnimationFrame(() => {
          rafId = null
          applyFitScale()
        })
      }

      const resizeObserver = new ResizeObserver(() => scheduleFit())
      resizeObserver.observe(doc.documentElement)
      if (doc.body) resizeObserver.observe(doc.body)

      const mutationObserver = new MutationObserver(() => scheduleFit())
      if (doc.body) {
        mutationObserver.observe(doc.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style'],
        })
      }

      const contentWindow = iframe.contentWindow
      const onInnerResize = () => scheduleFit()
      contentWindow?.addEventListener('resize', onInnerResize)

      const registerTimer = (delayMs: number) => {
        const id = window.setTimeout(() => {
          timers.delete(id)
          scheduleFit()
        }, delayMs)
        timers.add(id)
      }

      scheduleFit()
      registerTimer(120)
      registerTimer(320)

      mobilePreviewGuardCleanupRef.current = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId)
          rafId = null
        }
        timers.forEach((id) => window.clearTimeout(id))
        timers.clear()
        resizeObserver.disconnect()
        mutationObserver.disconnect()
        contentWindow?.removeEventListener('resize', onInnerResize)
        clearFitScale(activeRoot)
      }
    } catch {
      // Cross-origin or sandbox restrictions can block iframe document access.
      // In that case we silently keep the preview running.
    }
  }, [cleanupMobilePreviewGuard])

  useEffect(() => {
    return () => cleanupMobilePreviewGuard()
  }, [cleanupMobilePreviewGuard])

  const handleIframeLoad = useCallback(() => {
    applyMobileViewportGuards(iframeRef.current)
    setIsLoading(false)
  }, [applyMobileViewportGuards])

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

  // Mobile app preview sizing (calculated on all renders so hooks remain unconditional).
  const isCompactMobilePreview = mobileLayoutWidth > 0 && mobileLayoutWidth < COMPACT_PANE_PX
  const isTightMobilePreview = mobileLayoutWidth > 0 && mobileLayoutWidth < TIGHT_PANE_PX
  const qrSize = isTightMobilePreview ? 128 : isCompactMobilePreview ? 152 : 180
  const hasSimulatorControls = !!(props.onLaunchIOSSimulator || props.onLaunchAndroidEmulator)
  const hasQrPanel = !!props.expoUrl
  const paneWidth = mobileLayoutWidth || 1200
  const paneHeight = mobileLayoutHeight || 900
  const compactHeightBucket = !isCompactMobilePreview ? 'roomy' : paneHeight < 640 ? 'tight' : paneHeight < 780 ? 'medium' : 'roomy'
  const aspect = 163.4 / 78
  const targetPhoneWidth = isCompactMobilePreview
    ? Math.round(paneWidth * 0.66)
    : Math.round(paneWidth * 0.42)
  const compactAvailablePhoneWidth = Math.max(220, Math.min(520, paneWidth - 32))
  const nonCompactRightPanelWidth = Math.min(320, Math.round(paneWidth * 0.36))
  const nonCompactAvailablePhoneWidth = Math.max(220, paneWidth - 32 - nonCompactRightPanelWidth - 32)
  const availablePhoneWidth = isCompactMobilePreview ? compactAvailablePhoneWidth : nonCompactAvailablePhoneWidth
  const widthConstrained = Math.min(clamp(targetPhoneWidth, 220, 340), availablePhoneWidth)
  const widthDerivedHeight = Math.round(widthConstrained * aspect)
  const compactMinPhoneHeight = props.isTerminalOpen ? 360 : 380
  const compactMaxPhoneHeight = 520
  const compactVerticalPadding = 52
  const collapsedCardsCount = (hasSimulatorControls ? 1 : 0) + (hasQrPanel ? 1 : 0)
  const reservedCollapsedCards = collapsedCardsCount === 2 ? 164 : collapsedCardsCount === 1 ? 92 : 24
  const compactHeightBudget = paneHeight - compactVerticalPadding - reservedCollapsedCards
  const compactBudgetClamped = Math.min(
    compactMaxPhoneHeight,
    Math.max(compactMinPhoneHeight, compactHeightBudget)
  )
  const rawPhoneHeight = isCompactMobilePreview
    ? Math.min(
        compactMaxPhoneHeight,
        Math.max(compactMinPhoneHeight, Math.min(widthDerivedHeight, compactBudgetClamped))
      )
    : Math.min(Math.max(widthDerivedHeight, 420), 620)
  const phoneWidth = Math.min(Math.round(rawPhoneHeight / aspect), availablePhoneWidth)
  const phoneHeight = Math.round(phoneWidth * aspect)
  const isSimulatorExpanded = !isCompactMobilePreview || expandedSection === 'simulator'
  const isQrExpanded = !isCompactMobilePreview || expandedSection === 'qr'

  const handleScreenshot = useCallback(async () => {
    const url = currentUrl || props.previewUrl
    if (!url || isCapturing || !props.onScreenshot) return

    const mobileCapture = !isWebApp
    const width = mobileCapture ? Math.max(1, Math.round(phoneWidth || 390)) : 1280
    const height = mobileCapture ? Math.max(1, Math.round(phoneHeight || 844)) : 800

    setIsCapturing(true)
    try {
      const result = await screenshot.capture({
        url,
        width,
        height,
        mobile: mobileCapture,
        deviceScaleFactor: mobileCapture ? 2 : 1,
      })
      if (result.success && result.dataUrl) {
        props.onScreenshot(result.dataUrl)
      } else {
        console.error('[Preview] Screenshot failed:', result.error)
      }
    } catch (err) {
      console.error('[Preview] Screenshot error:', err)
    } finally {
      setIsCapturing(false)
    }
  }, [currentUrl, props, isCapturing, isWebApp, phoneWidth, phoneHeight])

  useEffect(() => {
    if (!isCompactMobilePreview) {
      setExpandedSection(null)
      return
    }

    // Compact mode defaults to collapsed controls while terminal is open or on very tight heights.
    if (props.isTerminalOpen || compactHeightBucket === 'tight') {
      setExpandedSection(null)
    }
  }, [isCompactMobilePreview, compactHeightBucket, props.isTerminalOpen, props.terminalHeight])

  const toggleSection = (section: 'simulator' | 'qr') => {
    setExpandedSection((current) => (current === section ? null : section))
  }

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
                  key={props.refreshKey}
                  ref={webIframeRef}
                  src={proxyUrl(currentUrl)}
                  className="w-full h-full border-0 bg-white"
                  allow="geolocation; camera; microphone; screen-wake-lock; clipboard-read; clipboard-write; accelerometer; gyroscope"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-top-navigation"
                  loading="eager"
                  title="Web Preview"
                  onLoad={handleWebIframeLoad}
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

  return (
    <div className="w-full h-full flex flex-col overflow-x-hidden">
      <div
        ref={mobileLayoutRef}
        className={`flex-1 min-h-0 p-4 ${
          isCompactMobilePreview
            ? 'flex flex-col items-center gap-4 overflow-x-hidden overflow-y-auto'
            : 'flex items-center justify-center gap-8 overflow-hidden'
        }`}
      >
        {/* iPhone Preview */}
        <div
          className={`flex flex-col items-center min-h-0 ${
            isCompactMobilePreview ? 'w-full max-w-[520px] pb-2 shrink-0' : 'h-full max-h-full flex-1'
          }`}
        >
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

          <div className={`w-full flex justify-center ${isCompactMobilePreview ? 'shrink-0' : 'min-h-0 flex-1 items-center'}`}>
            <div
              style={{
                width: `${phoneWidth}px`,
                height: `${phoneHeight}px`,
                maxWidth: '100%',
              }}
            >
              <IPhoneFrame showStatusBar={false} showHomeIndicator={false} className="w-full h-full">
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
                    key={props.refreshKey}
                    className="w-full h-full border-0 bg-white"
                    ref={iframeRef}
                    src={proxyUrl(props.previewUrl)}
                    allow="geolocation; camera; microphone; screen-wake-lock; clipboard-read; clipboard-write; accelerometer; gyroscope"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-top-navigation"
                    loading="eager"
                    scrolling="no"
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
          </div>
        </div>

        {isCompactMobilePreview && <div className="w-full max-w-[520px] border-t border-border/60" />}

        {/* Right Panel - Simulators and QR Code */}
        <div
          className={`flex gap-4 ${
            isCompactMobilePreview ? 'w-full max-w-[520px] flex-col self-center shrink-0' : 'w-[min(320px,36%)] flex-col flex-shrink-0'
          }`}
        >
          {/* Simulator Launch Buttons */}
          {hasSimulatorControls && (
            <div className="w-full bg-background border border-border rounded-2xl overflow-hidden">
              {isCompactMobilePreview && (
                <button
                  onClick={() => toggleSection('simulator')}
                  className="w-full flex items-center justify-between px-4 py-3 border-b border-border/70 text-foreground/90"
                >
                  <span className="flex items-center gap-2">
                    <Play className="h-4 w-4" />
                    <span className="text-sm font-medium">Run on Simulator</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isSimulatorExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
              )}

              {isSimulatorExpanded && (
                <div className={`${isCompactMobilePreview ? 'px-4 py-4' : 'p-5'} flex flex-col items-center gap-3`}>
                  {!isCompactMobilePreview && (
                    <div className="flex items-center gap-2 text-foreground/90">
                      <Play className="h-5 w-5" />
                      <span className="font-medium">Run on Simulator</span>
                    </div>
                  )}

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
            </div>
          )}

          {/* QR Code Panel - Only show when expoUrl is available */}
          {props.expoUrl && (
            <div className="w-full bg-background border border-border rounded-2xl overflow-hidden">
              {isCompactMobilePreview && (
                <button
                  onClick={() => toggleSection('qr')}
                  className="w-full flex items-center justify-between px-4 py-3 border-b border-border/70 text-foreground/90"
                >
                  <span className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    <span className="text-sm font-medium">Preview on your phone</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isQrExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}

              {isQrExpanded && (
                <div className={`${isCompactMobilePreview ? 'px-4 py-4' : 'p-6'} flex flex-col items-center gap-4`}>
                  {!isCompactMobilePreview && (
                    <div className="flex items-center gap-2 text-foreground/90">
                      <Smartphone className="h-5 w-5" />
                      <span className="font-medium">Preview on your phone</span>
                    </div>
                  )}

                  {/* QR Code */}
                  <div className={`${isTightMobilePreview ? 'p-2' : 'p-4'} bg-white rounded-xl relative`}>
                    <QRCodeSVG
                      value={props.expoUrl}
                      size={qrSize}
                      level="H"
                      includeMargin={false}
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      <div
                        className="bg-black rounded-md flex items-center justify-center"
                        style={{
                          width: Math.round(qrSize * 0.17),
                          height: Math.round(qrSize * 0.17),
                          padding: Math.round(qrSize * 0.025),
                        }}
                      >
                        <img src={bfloatIcon} alt="bfloat" className="w-full h-full" />
                      </div>
                    </div>
                  </div>

                  {/* URL with copy button */}
                  <div className="w-full flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border">
                    <span className={`${isTightMobilePreview ? 'text-xs' : 'text-sm'} flex-1 text-muted-foreground truncate font-mono`}>
                      {props.expoUrl}
                    </span>
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
                  <p className={`${isTightMobilePreview ? 'text-[11px]' : 'text-xs'} text-muted-foreground text-center leading-relaxed`}>
                    Scan with the <span className="text-foreground/70 font-medium">Expo Go</span> app on your iOS or Android
                    device to preview natively.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
