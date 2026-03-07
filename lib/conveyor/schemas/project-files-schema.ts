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

  // Git: start interactive remote connect flow
  'project:startGitConnect': {
    args: z.tuple([z.string(), z.string(), z.string()]), // projectId, remoteUrl, remoteBranch
    return: z.object({
      success: z.boolean(),
      sessionId: z.string().optional(),
      remoteBranch: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Git: submit interactive auth input
  'project:submitGitConnectInput': {
    args: z.tuple([z.string(), z.string()]), // sessionId, input
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Git: run preflight diagnostics for remote connectivity/auth
  'project:runGitConnectDiagnostics': {
    args: z.tuple([z.string(), z.string()]), // projectId, remoteUrl
    return: z.object({
      success: z.boolean(),
      remoteUrl: z.string().optional(),
      remoteType: z.enum(['ssh', 'https', 'other']).optional(),
      sshAgentHasIdentities: z.boolean().nullable().optional(),
      remoteReachable: z.boolean().nullable().optional(),
      probeError: z.string().optional(),
      suggestedHttpsUrl: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Git: cancel interactive connect flow
  'project:cancelGitConnect': {
    args: z.tuple([z.string()]), // sessionId
    return: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Git: check for changes
  'project:hasChanges': {
    args: z.tuple([]),
    return: z.boolean(),
  },

  // Git: compare local and remote branch heads
  'project:getGitSyncStatus': {
    args: z.tuple([]),
    return: z.object({
      isGitRepo: z.boolean().optional(),
      branch: z.string().optional(),
      localHead: z.string().optional(),
      remoteHead: z.string().optional(),
      ahead: z.number().optional(),
      behind: z.number().optional(),
      diverged: z.boolean().optional(),
      inSync: z.boolean().optional(),
      success: z.boolean().optional(),
      error: z.string().optional(),
    }),
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
