import { z } from 'zod'

// Schema for file changes
const fileChangeSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
  type: z.enum(['write', 'delete']),
})

// Schema for project files
const projectFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  isBinary: z.boolean(),
})

// Schema for file change events (from chokidar)
const fileChangeEventSchema = z.object({
  type: z.enum(['add', 'change', 'unlink', 'addDir', 'unlinkDir']),
  path: z.string(),
  relativePath: z.string(),
})

export const agentApiSchema = {
  // Start agent for a project
  'agent-start': {
    args: z.tuple([
      z.object({
        projectId: z.string(),
        remoteUrl: z.string(),
      }),
    ]),
    return: z.object({
      success: z.boolean(),
      projectPath: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Stop agent for a project
  'agent-stop': {
    args: z.tuple([z.string()]), // projectId
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Execute file changes from AI (auto-commits to git)
  'agent-execute': {
    args: z.tuple([z.string(), z.array(fileChangeSchema), z.string().optional()]), // projectId, changes, commitMessage?
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Commit and push changes
  'agent-commit': {
    args: z.tuple([
      z.string(), // projectId
      z.object({
        message: z.string(),
        messageId: z.string().optional(),
      }),
    ]),
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Get all files for a project
  'agent-get-files': {
    args: z.tuple([z.string()]), // projectId
    return: z.object({
      success: z.boolean(),
      files: z.array(projectFileSchema).optional(),
      error: z.string().optional(),
    }),
  },

  // Read a single file
  'agent-read-file': {
    args: z.tuple([z.string(), z.string()]), // projectId, filePath
    return: z.object({
      success: z.boolean(),
      content: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Pull latest changes
  'agent-pull': {
    args: z.tuple([z.string()]), // projectId
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Check if agent is running for a project
  'agent-status': {
    args: z.tuple([z.string()]), // projectId
    return: z.object({
      isRunning: z.boolean(),
      projectPath: z.string().optional(),
      hasUncommittedChanges: z.boolean().optional(),
    }),
  },

  // Get the project path for a running agent
  'agent-get-project-path': {
    args: z.tuple([z.string()]), // projectId
    return: z.string().nullable(),
  },
}

// Export types for use in renderer
export type FileChange = z.infer<typeof fileChangeSchema>
export type ProjectFile = z.infer<typeof projectFileSchema>
export type FileChangeEvent = z.infer<typeof fileChangeEventSchema>
