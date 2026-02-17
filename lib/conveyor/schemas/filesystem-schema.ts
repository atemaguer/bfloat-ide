import { z } from 'zod'

// Schema for file entries
const fileEntrySchema = z.object({
  path: z.string(),
  content: z.string(),
})

export const filesystemIpcSchema = {
  'filesystem-create-temp-dir': {
    args: z.tuple([z.string()]), // projectId - used to create unique folder name
    return: z.object({
      success: z.boolean(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'filesystem-write-files': {
    args: z.tuple([z.string(), z.array(fileEntrySchema)]), // basePath, files array
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'filesystem-read-file': {
    args: z.tuple([z.string()]), // path to file
    return: z.object({
      success: z.boolean(),
      content: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  'filesystem-write-file': {
    args: z.tuple([z.string(), z.string()]), // path, content
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'filesystem-get-temp-path': {
    args: z.tuple([z.string()]), // projectId
    return: z.string(),
  },
  'filesystem-cleanup-temp-dir': {
    args: z.tuple([z.string()]), // path to clean up
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  'filesystem-get-network-ip': {
    args: z.tuple([]), // no args
    return: z.string().nullable(),
  },
}

