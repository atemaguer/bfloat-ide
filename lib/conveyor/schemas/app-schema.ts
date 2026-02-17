import { z } from 'zod'

export const appIpcSchema = {
  version: {
    args: z.tuple([]),
    return: z.string(),
  },
  login: {
    args: z.tuple([]),
    return: z.void(),
  },
  'app:open-external': {
    args: z.tuple([z.string()]),
    return: z.void(),
  },
}
