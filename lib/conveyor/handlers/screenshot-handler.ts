/**
 * Screenshot Handler
 *
 * IPC handler for capturing preview screenshots from the renderer process.
 */

import { handle } from '@/lib/main/shared'
import { capturePreviewScreenshot } from '@/lib/screenshot/capture'

export function registerScreenshotHandlers() {
  handle('screenshot:capture', async (url: string, webContentsId?: number) => {
    return capturePreviewScreenshot({ url, webContentsId })
  })
}
