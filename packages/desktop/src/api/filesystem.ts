/**
 * filesystem.ts — Filesystem API client for the Bfloat sidecar.
 *
 * Mirrors the existing Electron FilesystemApi and ProjectFilesApi surfaces so
 * that renderer code can be migrated with minimal changes.
 *
 * HTTP routes expected on the sidecar:
 *   GET    /filesystem/read          — read a file
 *   POST   /filesystem/write         — write a file
 *   POST   /filesystem/write-files   — write multiple files
 *   GET    /filesystem/exists        — check existence
 *   POST   /filesystem/mkdir         — create directory
 *   GET    /filesystem/readdir       — list directory
 *   DELETE /filesystem/delete        — delete file or directory
 *   POST   /filesystem/move          — move / rename
 *   GET    /filesystem/stat          — get file info
 *   POST   /filesystem/create-temp-dir  — create a temp directory for a project
 *   GET    /filesystem/get-temp-path    — get the temp path for a project
 *   DELETE /filesystem/cleanup-temp-dir — clean up a temp directory
 *   GET    /filesystem/network-ip       — get local network IP
 */

import type { HttpClient } from "./client"

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface FileEntry {
  /** Relative or absolute path to the file. */
  path: string
  /** UTF-8 file content. */
  content: string
}

export interface FileStat {
  /** Absolute path. */
  path: string
  /** Entry type. */
  type: "file" | "directory" | "symlink"
  /** Size in bytes (files only). */
  size?: number
  /** Last modified timestamp (milliseconds since epoch). */
  modifiedAt?: number
  /** Created timestamp (milliseconds since epoch). */
  createdAt?: number
}

export interface DirEntry {
  /** Entry name (not full path). */
  name: string
  /** Absolute or base-relative path. */
  path: string
  /** Entry type. */
  type: "file" | "directory" | "symlink"
}

// Operation results
export interface OperationResult {
  success: boolean
  error?: string
}

export interface ReadResult {
  success: boolean
  content?: string
  error?: string
}

export interface ExistsResult {
  exists: boolean
}

export interface ReaddirResult {
  success: boolean
  entries?: DirEntry[]
  error?: string
}

export interface StatResult {
  success: boolean
  stat?: FileStat
  error?: string
}

export interface CreateTempDirResult {
  success: boolean
  path?: string
  error?: string
}

// ---------------------------------------------------------------------------
// FilesystemApi
// ---------------------------------------------------------------------------

export class FilesystemApi {
  constructor(private readonly http: HttpClient) {}

  // --------------------------------------------------------------------------
  // Core file operations
  // --------------------------------------------------------------------------

  /**
   * Read the UTF-8 contents of a file.
   *
   * @param path  Absolute path to the file.
   */
  async read(path: string): Promise<ReadResult> {
    return this.http.get<ReadResult>(
      `/filesystem/read?path=${encodeURIComponent(path)}`,
    )
  }

  /**
   * Write UTF-8 content to a file, creating it (and any parent directories)
   * if it does not exist.
   *
   * @param path     Absolute path to the file.
   * @param content  UTF-8 content to write.
   */
  async write(path: string, content: string): Promise<OperationResult> {
    return this.http.post<OperationResult>("/filesystem/write", {
      path,
      content,
    })
  }

  /**
   * Write multiple files atomically.  The sidecar creates all parent
   * directories as needed.
   *
   * @param basePath  Base directory.  Relative paths in `files` are resolved
   *                  against this.
   * @param files     Array of { path, content } entries.
   */
  async writeFiles(
    basePath: string,
    files: FileEntry[],
  ): Promise<OperationResult> {
    return this.http.post<OperationResult>("/filesystem/write-files", {
      basePath,
      files,
    })
  }

  /**
   * Check whether a file or directory exists at the given path.
   *
   * @param path  Absolute path.
   */
  async exists(path: string): Promise<ExistsResult> {
    return this.http.get<ExistsResult>(
      `/filesystem/exists?path=${encodeURIComponent(path)}`,
    )
  }

  /**
   * Create a directory (and all intermediate parent directories).
   *
   * @param path  Absolute path of the directory to create.
   */
  async mkdir(path: string): Promise<OperationResult> {
    return this.http.post<OperationResult>("/filesystem/mkdir", { path })
  }

  /**
   * List the contents of a directory.
   *
   * @param path  Absolute path to the directory.
   */
  async readdir(path: string): Promise<ReaddirResult> {
    return this.http.get<ReaddirResult>(
      `/filesystem/readdir?path=${encodeURIComponent(path)}`,
    )
  }

  /**
   * Delete a file or directory.  Directories are deleted recursively.
   *
   * @param path  Absolute path to the file or directory.
   */
  async delete(path: string): Promise<OperationResult> {
    return this.http.delete<OperationResult>(
      `/filesystem/delete?path=${encodeURIComponent(path)}`,
    )
  }

  /**
   * Move or rename a file or directory.
   *
   * @param from  Source path.
   * @param to    Destination path.
   */
  async move(from: string, to: string): Promise<OperationResult> {
    return this.http.post<OperationResult>("/filesystem/move", { from, to })
  }

  /**
   * Get metadata about a file or directory.
   *
   * @param path  Absolute path.
   */
  async stat(path: string): Promise<StatResult> {
    return this.http.get<StatResult>(
      `/filesystem/stat?path=${encodeURIComponent(path)}`,
    )
  }

  // --------------------------------------------------------------------------
  // Convenience aliases matching the Electron FilesystemApi names
  // --------------------------------------------------------------------------

  /** @alias read */
  readFile = (path: string) => this.read(path)

  /** @alias write */
  writeFile = (path: string, content: string) => this.write(path, content)

  // --------------------------------------------------------------------------
  // Temporary directory management
  // --------------------------------------------------------------------------

  /**
   * Create a temporary directory scoped to a project.
   *
   * @param projectId  Unique project identifier used to name the folder.
   */
  async createTempDir(projectId: string): Promise<CreateTempDirResult> {
    return this.http.post<CreateTempDirResult>("/filesystem/create-temp-dir", {
      projectId,
    })
  }

  /**
   * Get the path to a project's temporary directory without creating it.
   *
   * @param projectId  Unique project identifier.
   */
  async getTempPath(projectId: string): Promise<string> {
    const result = await this.http.get<{ path: string }>(
      `/filesystem/get-temp-path?projectId=${encodeURIComponent(projectId)}`,
    )
    return result.path
  }

  /**
   * Clean up (recursively delete) a temporary directory.
   *
   * @param dirPath  Path to the temporary directory.
   */
  async cleanupTempDir(dirPath: string): Promise<OperationResult> {
    return this.http.delete<OperationResult>(
      `/filesystem/cleanup-temp-dir?path=${encodeURIComponent(dirPath)}`,
    )
  }

  // --------------------------------------------------------------------------
  // Network utilities
  // --------------------------------------------------------------------------

  /**
   * Get the machine's primary local-area-network IP address.
   * Returns null when the address cannot be determined.
   */
  async getNetworkIP(): Promise<string | null> {
    const result = await this.http.get<{ ip: string | null }>(
      "/filesystem/network-ip",
    )
    return result.ip
  }
}
