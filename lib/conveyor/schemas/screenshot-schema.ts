import { z } from 'zod'

export const screenshotIpcSchema = {
  'screenshot:capture': {
    args: z.tuple([z.string(), z.number().optional()]), // url, webContentsId
    return: z.object({
      success: z.boolean(),
      dataUrl: z.string().optional(),
      error: z.string().optional(),
    }),
  },
}
