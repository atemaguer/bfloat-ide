import { z } from 'zod'

const secretSchema = z.object({
  key: z.string(),
  value: z.string(),
})

const secretsReadResultSchema = z.object({
  secrets: z.array(secretSchema),
  error: z.string().optional(),
})

const secretOperationResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
})

export const secretsApiSchema = {
  'secrets:read': {
    args: z.tuple([z.object({ projectId: z.string() })]),
    return: secretsReadResultSchema,
  },
  'secrets:set': {
    args: z.tuple([z.object({
      projectId: z.string(),
      key: z.string(),
      value: z.string(),
    })]),
    return: secretOperationResultSchema,
  },
  'secrets:delete': {
    args: z.tuple([z.object({
      projectId: z.string(),
      key: z.string(),
    })]),
    return: secretOperationResultSchema,
  },
}
