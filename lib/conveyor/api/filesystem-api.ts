import { ConveyorApi } from '@/lib/preload/shared'

export interface FileEntry {
  path: string
  content: string
}

export class FilesystemApi extends ConveyorApi {
  /**
   * Create a temporary directory for a project
   * @param projectId Unique project identifier
   * @returns Object with success status and path to created directory
   */
  createTempDir = (projectId: string) => this.invoke('filesystem-create-temp-dir', projectId)

  /**
   * Write multiple files to a base directory
   * @param basePath Base directory path
   * @param files Array of file entries with path and content
   */
  writeFiles = (basePath: string, files: FileEntry[]) => this.invoke('filesystem-write-files', basePath, files)

  /**
   * Get the temporary path for a project
   * @param projectId Unique project identifier
   */
  getTempPath = (projectId: string) => this.invoke('filesystem-get-temp-path', projectId)

  /**
   * Clean up a temporary directory
   * @param dirPath Path to directory to clean up
   */
  cleanupTempDir = (dirPath: string) => this.invoke('filesystem-cleanup-temp-dir', dirPath)

  /**
   * Get the local network IP address
   * @returns The local network IP address or null if not found
   */
  getNetworkIP = () => this.invoke('filesystem-get-network-ip')

  /**
   * Read a single file
   * @param path Absolute path to the file
   * @returns Object with success status and file content
   */
  readFile = (path: string) => this.invoke('filesystem-read-file', path)

  /**
   * Write a single file
   * @param path Absolute path to the file
   * @param content Content to write
   * @returns Object with success status
   */
  writeFile = (path: string, content: string) => this.invoke('filesystem-write-file', path, content)
}

