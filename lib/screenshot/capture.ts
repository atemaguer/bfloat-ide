/**
 * Preview Screenshot Capture
 *
 * Captures the preview by reading directly from the webview's webContents
 * (same auth state, same page the user sees). Falls back to creating a
 * hidden offscreen BrowserWindow when no webContentsId is available.
 */

import { BrowserWindow, webContents } from 'electron'

const LOG_PREFIX = '[Screenshot]'

interface CaptureOptions {
  url: string
  webContentsId?: number
  width?: number
  height?: number
  timeout?: number
  renderDelay?: number
}

interface CaptureResult {
  success: boolean
  dataUrl?: string
  error?: string
}

export async function capturePreviewScreenshot(options: CaptureOptions): Promise<CaptureResult> {
  const {
    url,
    webContentsId,
    width = 1280,
    height = 720,
    timeout = 10000,
    renderDelay = 1500,
  } = options

  // Prefer capturing from the actual webview (preserves auth, cookies, current page)
  if (webContentsId) {
    try {
      const contents = webContents.fromId(webContentsId)
      if (contents && !contents.isDestroyed()) {
        console.log(`${LOG_PREFIX} Capturing from webContents ${webContentsId} (${contents.getURL()})`)
        const image = await contents.capturePage()
        const pngBuffer = image.toPNG()
        const base64 = pngBuffer.toString('base64')
        const dataUrl = `data:image/png;base64,${base64}`
        console.log(`${LOG_PREFIX} Screenshot captured from webview (${pngBuffer.length} bytes)`)
        return { success: true, dataUrl }
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to capture from webContents ${webContentsId}, falling back to URL:`, error)
    }
  }

  // Fallback: create a hidden window and load the URL
  console.log(`${LOG_PREFIX} Capturing screenshot of ${url} (${width}x${height}) via hidden window`)

  let win: BrowserWindow | null = null

  try {
    win = new BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Load the URL with a timeout
    await Promise.race([
      win.loadURL(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out loading ${url}`)), timeout)
      ),
    ])

    console.log(`${LOG_PREFIX} Page loaded, waiting ${renderDelay}ms for rendering...`)

    // Wait for React/framework rendering to complete
    await new Promise((resolve) => setTimeout(resolve, renderDelay))

    // Capture the page
    const image = await win.webContents.capturePage()
    const pngBuffer = image.toPNG()
    const base64 = pngBuffer.toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`

    console.log(`${LOG_PREFIX} Screenshot captured (${pngBuffer.length} bytes)`)

    return { success: true, dataUrl }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${LOG_PREFIX} Failed to capture screenshot:`, message)
    return { success: false, error: message }
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
  }
}
