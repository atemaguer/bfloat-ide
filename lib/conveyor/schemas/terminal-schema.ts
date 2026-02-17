import { z } from 'zod'

export const terminalIpcSchema = {
  'terminal-create': {
    args: z.tuple([z.string(), z.string().optional()]), // terminalId, cwd (optional)
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'terminal-write': {
    args: z.tuple([z.string(), z.string()]), // terminalId, data
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'terminal-resize': {
    args: z.tuple([z.string(), z.number(), z.number()]), // terminalId, cols, rows
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'terminal-kill': {
    args: z.tuple([z.string()]), // terminalId
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'terminal-get-cwd': {
    args: z.tuple([]),
    return: z.string(),
  },
  'terminal-check-port': {
    args: z.tuple([z.number()]), // port
    return: z.object({
      available: z.boolean(),
      port: z.number(),
    }),
  },
  'terminal-find-port': {
    args: z.tuple([z.number(), z.number().optional()]), // startPort, endPort (optional)
    return: z.object({
      success: z.boolean(),
      port: z.number().optional(),
      error: z.string().optional(),
    }),
  },
}
