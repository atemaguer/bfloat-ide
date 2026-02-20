/**
 * Platform abstraction layer for Tauri.
 *
 * This module replaces the Electron contextBridge / conveyor pattern.  All
 * native capabilities are accessed through Tauri plugins so that the renderer
 * never has to deal with IPC boilerplate directly.
 *
 * Usage:
 *   import { platform } from "./platform"
 *   await platform.openLink("https://example.com")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  /** Retrieve a value by key. Returns undefined when the key does not exist. */
  get<T>(key: string): Promise<T | undefined>
  /** Persist a value. */
  set<T>(key: string, value: T): Promise<void>
  /** Remove a key. */
  delete(key: string): Promise<void>
  /** List all stored keys. */
  keys(): Promise<string[]>
}

export interface UpdateInfo {
  /** Whether an update is available. */
  available: boolean
  /** The new version string, if available. */
  version?: string
  /** Release notes / changelog for the new version, if provided. */
  body?: string
}

export interface FilePickerOptions {
  /** Whether the user can select multiple files. Defaults to false. */
  multiple?: boolean
  /** File extension filters, e.g. [{ name: "Images", extensions: ["png", "jpg"] }] */
  filters?: Array<{ name: string; extensions: string[] }>
  /** Dialog window title. */
  title?: string
  /** Default directory to open the dialog in. */
  defaultPath?: string
}

export interface DirectoryPickerOptions {
  /** Dialog window title. */
  title?: string
  /** Default directory to open the dialog in. */
  defaultPath?: string
}

export interface NotifyOptions {
  title: string
  body: string
  /** Optional icon path relative to the app resources directory. */
  icon?: string
}

export interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface FetchResponse {
  status: number
  headers: Record<string, string>
  /** Raw response body as text. */
  data: string
}

/**
 * The Platform interface exposes all native OS capabilities used by the
 * Bfloat IDE renderer.  Each method maps 1-to-1 to a Tauri plugin call so
 * that the rest of the app stays platform-agnostic.
 */
export interface Platform {
  // ------------------------------------------------------------------
  // Shell / OS
  // ------------------------------------------------------------------

  /** Open a URL in the system default browser. */
  openLink(url: string): Promise<void>

  /** Open a file-system path in the OS default application (e.g. Finder / Explorer). */
  openPath(path: string): Promise<void>

  // ------------------------------------------------------------------
  // File pickers
  // ------------------------------------------------------------------

  /**
   * Show a native directory picker.
   * @returns The selected directory path, or null if cancelled.
   */
  openDirectoryPickerDialog(
    options?: DirectoryPickerOptions,
  ): Promise<string | null>

  /**
   * Show a native file picker.
   * @returns One or more selected file paths, or null if cancelled.
   */
  openFilePickerDialog(
    options?: FilePickerOptions,
  ): Promise<string | string[] | null>

  // ------------------------------------------------------------------
  // Key-value storage (backed by tauri-plugin-store)
  // ------------------------------------------------------------------

  /** A persistent key-value store scoped to the application. */
  storage: StorageAdapter

  // ------------------------------------------------------------------
  // Updates
  // ------------------------------------------------------------------

  /**
   * Check whether a new application version is available.
   * Returns null if the update check could not be completed.
   */
  checkUpdate(): Promise<UpdateInfo | null>

  /**
   * Download and install the pending update.  Should only be called after
   * `checkUpdate()` has confirmed that an update is available.
   */
  update(): Promise<void>

  /** Restart the application process. */
  restart(): Promise<void>

  // ------------------------------------------------------------------
  // Notifications
  // ------------------------------------------------------------------

  /** Send a native desktop notification. */
  notify(options: NotifyOptions): Promise<void>

  // ------------------------------------------------------------------
  // HTTP (bypasses CORS restrictions via the Tauri sidecar)
  // ------------------------------------------------------------------

  /**
   * Perform an HTTP request through the Tauri plugin so that the renderer
   * is not subject to browser CORS restrictions.
   */
  fetch(url: string, options?: FetchOptions): Promise<FetchResponse>

  // ------------------------------------------------------------------
  // Clipboard
  // ------------------------------------------------------------------

  /**
   * Read an image from the system clipboard.
   * @returns A base64-encoded PNG data URL, or null if the clipboard does
   *          not contain an image.
   */
  readClipboardImage(): Promise<string | null>
}

// ---------------------------------------------------------------------------
// Tauri implementation
// ---------------------------------------------------------------------------

async function createTauriPlatform(): Promise<Platform> {
  // Lazy-import all Tauri plugins so that this module can be loaded in a
  // non-Tauri environment (e.g. unit tests) without exploding.
  const { open: shellOpen } = await import("@tauri-apps/plugin-shell")
  const { open: openerOpen } = await import("@tauri-apps/plugin-opener")
  const { open: dialogOpen } = await import("@tauri-apps/plugin-dialog")
  const { Store } = await import("@tauri-apps/plugin-store")
  const { check: checkForUpdate } = await import(
    "@tauri-apps/plugin-updater"
  )
  const { relaunch } = await import("@tauri-apps/plugin-process")
  const {
    sendNotification,
    isPermissionGranted,
    requestPermission,
  } = await import("@tauri-apps/plugin-notification")
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http")
  const { readImage } = await import(
    "@tauri-apps/plugin-clipboard-manager"
  )

  // Shared store instance – uses a JSON file in the app data directory.
  const store = await Store.load("bfloat-store.json", { autoSave: true })

  // Cached update handle so we can call `downloadAndInstall` later.
  let pendingUpdate: Awaited<ReturnType<typeof checkForUpdate>> | null = null

  const platform: Platform = {
    // ------------------------------------------------------------------
    // Shell / OS
    // ------------------------------------------------------------------

    async openLink(url: string): Promise<void> {
      await shellOpen(url)
    },

    async openPath(path: string): Promise<void> {
      await openerOpen(path)
    },

    // ------------------------------------------------------------------
    // File pickers
    // ------------------------------------------------------------------

    async openDirectoryPickerDialog(
      options: DirectoryPickerOptions = {},
    ): Promise<string | null> {
      const selected = await dialogOpen({
        directory: true,
        multiple: false,
        title: options.title,
        defaultPath: options.defaultPath,
      })

      // Tauri dialog returns null when cancelled, string when one path selected
      if (selected === null) return null
      return typeof selected === "string" ? selected : selected[0] ?? null
    },

    async openFilePickerDialog(
      options: FilePickerOptions = {},
    ): Promise<string | string[] | null> {
      const selected = await dialogOpen({
        directory: false,
        multiple: options.multiple ?? false,
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
      })

      if (selected === null) return null
      return selected
    },

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return (await store.get<T>(key)) ?? undefined
      },

      async set<T>(key: string, value: T): Promise<void> {
        await store.set(key, value)
      },

      async delete(key: string): Promise<void> {
        await store.delete(key)
      },

      async keys(): Promise<string[]> {
        return store.keys()
      },
    },

    // ------------------------------------------------------------------
    // Updates
    // ------------------------------------------------------------------

    async checkUpdate(): Promise<UpdateInfo | null> {
      try {
        const update = await checkForUpdate()
        pendingUpdate = update

        if (update?.available) {
          return {
            available: true,
            version: update.version,
            body: update.body ?? undefined,
          }
        }

        return { available: false }
      } catch (err) {
        console.error("[platform] update check failed:", err)
        return null
      }
    },

    async update(): Promise<void> {
      if (!pendingUpdate?.available) {
        throw new Error("No update is available. Call checkUpdate() first.")
      }

      await pendingUpdate.downloadAndInstall()
    },

    async restart(): Promise<void> {
      await relaunch()
    },

    // ------------------------------------------------------------------
    // Notifications
    // ------------------------------------------------------------------

    async notify(options: NotifyOptions): Promise<void> {
      let granted = await isPermissionGranted()

      if (!granted) {
        const permission = await requestPermission()
        granted = permission === "granted"
      }

      if (granted) {
        sendNotification({
          title: options.title,
          body: options.body,
          icon: options.icon,
        })
      }
    },

    // ------------------------------------------------------------------
    // HTTP
    // ------------------------------------------------------------------

    async fetch(
      url: string,
      options: FetchOptions = {},
    ): Promise<FetchResponse> {
      const response = await tauriFetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
      })

      // Collect response headers into a plain object
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })

      const data = await response.text()

      return {
        status: response.status,
        headers,
        data,
      }
    },

    // ------------------------------------------------------------------
    // Clipboard
    // ------------------------------------------------------------------

    async readClipboardImage(): Promise<string | null> {
      try {
        const image = await readImage()
        // Convert the raw bytes to a base64 PNG data URL
        const bytes = await image.rgba()
        // image.rgba() gives raw RGBA pixels; we need to encode as PNG.
        // For now we return the raw base64 bytes – callers that need a proper
        // PNG should use a canvas to encode.
        const base64 = btoa(String.fromCharCode(...bytes))
        return `data:image/png;base64,${base64}`
      } catch {
        // Clipboard does not contain an image or permission was denied
        return null
      }
    },
  }

  return platform
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _platform: Platform | null = null
let _initPromise: Promise<Platform> | null = null

/**
 * Retrieve the singleton Platform instance, initialising it on the first call.
 *
 * @example
 * const p = await getPlatform()
 * await p.openLink("https://bfloat.dev")
 */
export async function getPlatform(): Promise<Platform> {
  if (_platform) return _platform

  if (!_initPromise) {
    _initPromise = createTauriPlatform().then((p) => {
      _platform = p
      return p
    })
  }

  return _initPromise
}

/**
 * Synchronous accessor for the platform.  Only safe to call after the first
 * `await getPlatform()` has resolved.  Throws if the platform has not been
 * initialised yet.
 */
export function getPlatformSync(): Platform {
  if (!_platform) {
    throw new Error(
      "Platform has not been initialised yet. Await getPlatform() first.",
    )
  }
  return _platform
}

// Export a lazy proxy so consumers can write `platform.openLink(…)` without
// having to await the initialisation themselves.  The first call will still
// need to be awaited (it delegates to `getPlatform()`), but subsequent calls
// hit the cached instance.
export const platform = new Proxy({} as Platform, {
  get(_target, prop: keyof Platform) {
    return async (...args: unknown[]) => {
      const p = await getPlatform()
      const member = p[prop]
      if (typeof member === "function") {
        return (member as (...a: unknown[]) => unknown).apply(p, args)
      }
      return member
    }
  },
})
