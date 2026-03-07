/**
 * filesystem.ts — Filesystem API client for the Bfloat sidecar.
 *
 * Mirrors the existing Electron FilesystemApi and ProjectFilesApi surfaces so
 * that renderer code can be migrated with minimal changes.
 *
 * HTTP routes expected on the sidecar:
 *   GET    /api/fs/read                — read a file
 *   POST   /api/fs/write               — write a file
 *   POST   /api/fs/write-files         — write multiple files
 *   GET    /api/fs/exists              — check existence
 *   POST   /api/fs/mkdir               — create directory
 *   GET    /api/fs/readdir             — list directory
 *   DELETE /api/fs/delete              — delete file or directory
 *   POST   /api/fs/move                — move / rename
 *   GET    /api/fs/stat                — get file info
 *   POST   /api/fs/create-temp-dir     — create a temp directory for a project
 *   GET    /api/fs/get-temp-path       — get the temp path for a project
 *   DELETE /api/fs/cleanup-temp-dir    — clean up a temp directory
 *   GET    /api/fs/network-ip          — get local network IP
 */

import type { HttpClient } from "./client"
import { SidecarError } from "./client"

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

  private errorMessage(error: unknown): string {
    if (error instanceof SidecarError) return error.message
    if (error instanceof Error) return error.message
    return String(error)
  }

  // --------------------------------------------------------------------------
  // Core file operations
  // --------------------------------------------------------------------------

  /**
   * Read the UTF-8 contents of a file.
   *
   * @param path  Absolute path to the file.
   */
  async read(path: string): Promise<ReadResult> {
    try {
      const result = await this.http.get<{ content: string }>(
        `/api/fs/read?path=${encodeURIComponent(path)}`,
      )
      return { success: true, content: result.content }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * Write UTF-8 content to a file, creating it (and any parent directories)
   * if it does not exist.
   *
   * @param path     Absolute path to the file.
   * @param content  UTF-8 content to write.
   */
  async write(path: string, content: string): Promise<OperationResult> {
    try {
      const result = await this.http.post<{ ok?: boolean }>("/api/fs/write", {
        path,
        content,
      })
      return { success: result.ok !== false }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
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
    try {
      for (const file of files) {
        const isAbsolute = file.path.startsWith("/")
        const targetPath = isAbsolute
          ? file.path
          : `${basePath.replace(/\/+$/, "")}/${file.path.replace(/^\/+/, "")}`
        const writeResult = await this.write(targetPath, file.content)
        if (!writeResult.success) {
          return {
            success: false,
            error: writeResult.error ?? `Failed to write ${targetPath}`,
          }
        }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * Check whether a file or directory exists at the given path.
   *
   * @param path  Absolute path.
   */
  async exists(path: string): Promise<ExistsResult> {
    return this.http.get<ExistsResult>(
      `/api/fs/exists?path=${encodeURIComponent(path)}`,
    )
  }

  /**
   * Create a directory (and all intermediate parent directories).
   *
   * @param path  Absolute path of the directory to create.
   */
  async mkdir(path: string): Promise<OperationResult> {
    try {
      const result = await this.http.post<{ ok?: boolean }>("/api/fs/mkdir", {
        path,
      })
      return { success: result.ok !== false }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * List the contents of a directory.
   *
   * @param path  Absolute path to the directory.
   */
  async readdir(path: string): Promise<ReaddirResult> {
    try {
      const result = await this.http.get<{ entries: DirEntry[] }>(
        `/api/fs/readdir?path=${encodeURIComponent(path)}`,
      )
      return { success: true, entries: result.entries ?? [] }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * Delete a file or directory.  Directories are deleted recursively.
   *
   * @param path  Absolute path to the file or directory.
   */
  async delete(path: string): Promise<OperationResult> {
    try {
      const result = await this.http.delete<{ ok?: boolean }>(
        `/api/fs/delete?path=${encodeURIComponent(path)}`,
      )
      return { success: result.ok !== false }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * Move or rename a file or directory.
   *
   * @param from  Source path.
   * @param to    Destination path.
   */
  async move(from: string, to: string): Promise<OperationResult> {
    try {
      const result = await this.http.post<{ ok?: boolean }>("/api/fs/move", {
        src: from,
        dest: to,
      })
      return { success: result.ok !== false }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * Get metadata about a file or directory.
   *
   * @param path  Absolute path.
   */
  async stat(path: string): Promise<StatResult> {
    try {
      const result = await this.http.get<FileStat>(
        `/api/fs/stat?path=${encodeURIComponent(path)}`,
      )
      return { success: true, stat: result }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
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
    try {
      const result = await this.http.post<{ path?: string; ok?: boolean }>(
        "/api/fs/create-temp-dir",
        {
          projectId,
        },
      )
      return { success: result.ok !== false, path: result.path }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  /**
   * Get the path to a project's temporary directory without creating it.
   *
   * @param projectId  Unique project identifier.
   */
  async getTempPath(projectId: string): Promise<string> {
    const result = await this.http.get<{ path: string }>(
      `/api/fs/get-temp-path?projectId=${encodeURIComponent(projectId)}`,
    )
    return result.path
  }

  /**
   * Clean up (recursively delete) a temporary directory.
   *
   * @param dirPath  Path to the temporary directory.
   */
  async cleanupTempDir(dirPath: string): Promise<OperationResult> {
    try {
      const result = await this.http.delete<{ ok?: boolean }>(
        `/api/fs/cleanup-temp-dir?path=${encodeURIComponent(dirPath)}`,
      )
      return { success: result.ok !== false }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
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
      "/api/fs/network-ip",
    )
    return result.ip
  }
}
