import { z } from 'zod'

// Schema for file node (tree entry)
const fileNodeSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().optional(),
  modifiedAt: z.number().optional(),
})

// Schema for file content
const fileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  isBinary: z.boolean(),
})

// Schema for project state
const projectStateSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  status: z.enum(['idle', 'cloning', 'ready', 'error']),
  error: z.string().optional(),
  fileTree: z.array(fileNodeSchema),
})

export const projectFilesApiSchema = {
  // Open a project (clone/pull + start watching)
  'project:open': {
    args: z.tuple([z.string(), z.string(), z.string().optional()]), // projectId, remoteUrl, appType
    return: projectStateSchema,
  },

  // Close current project (stop watching)
  'project:close': {
    args: z.tuple([]),
    return: z.void(),
  },

  // Get current project state
  'project:getState': {
    args: z.tuple([]),
    return: projectStateSchema.nullable(),
  },

  // Read file content (lazy load)
  'project:readFile': {
    args: z.tuple([z.string()]), // relativePath
    return: fileContentSchema,
  },

  // Write file content
  'project:writeFile': {
    args: z.tuple([z.string(), z.string()]), // relativePath, content
    return: z.void(),
  },

  // Delete file
  'project:deleteFile': {
    args: z.tuple([z.string()]), // relativePath
    return: z.void(),
  },

  // Create directory
  'project:createDirectory': {
    args: z.tuple([z.string()]), // relativePath
    return: z.void(),
  },

  // Rename/move file or directory
  'project:rename': {
    args: z.tuple([z.string(), z.string()]), // oldPath, newPath
    return: z.void(),
  },

  // Git: commit and push
  'project:commitAndPush': {
    args: z.tuple([z.string()]), // message
    return: z.void(),
  },

  // Git: sync to remote with fresh authenticated URL
  'project:syncToRemote': {
    args: z.tuple([z.string()]), // authenticatedUrl
    return: z.void(),
  },

  // Git: pull latest
  'project:pull': {
    args: z.tuple([]),
    return: z.void(),
  },

  // Git: check for changes
  'project:hasChanges': {
    args: z.tuple([]),
    return: z.boolean(),
  },

  // Get current project path
  'project:getPath': {
    args: z.tuple([]),
    return: z.string().nullable(),
  },

  // Check if project is ready
  'project:isReady': {
    args: z.tuple([]),
    return: z.boolean(),
  },

  // Rescan file tree
  'project:rescanTree': {
    args: z.tuple([]),
    return: z.array(fileNodeSchema),
  },

  // Check if a project exists locally (already cloned)
  'project:existsLocally': {
    args: z.tuple([z.string()]), // projectId
    return: z.boolean(),
  },

  // Save image attachment and return file path
  'project:saveAttachment': {
    args: z.tuple([z.string(), z.string()]), // filename, base64Data
    return: z.string(), // filePath
  },
}
