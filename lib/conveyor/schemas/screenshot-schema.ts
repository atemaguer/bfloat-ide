import { z } from 'zod'

const captureResult = z.object({
  success: z.boolean(),
  dataUrl: z.string().optional(),
  error: z.string().optional(),
})

export const screenshotIpcSchema = {
  /**
   * Capture a screenshot.
   * If webContentsId is provided, captures from that specific webContents (webview).
   * Otherwise captures the entire main window (renderer crops to preview bounds).
   */
  'screenshot:capture': {
    args: z.tuple([z.number().optional()]), // webContentsId
    return: captureResult,
  },
}
