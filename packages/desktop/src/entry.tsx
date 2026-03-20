/**
 * entry.tsx — Tauri desktop renderer entry point
 *
 * This file is the equivalent of the Electron renderer.tsx.  It:
 *   1. Waits for the Bfloat sidecar to signal that it is ready via the
 *      `await_initialization` Tauri command.
 *   2. Sets up the deep-link listener so that OAuth callbacks and custom
 *      URL scheme redirects are routed into the React app.
 *   3. Initialises the Platform singleton so that the rest of the app can
 *      call `getPlatform()` synchronously after the first render.
 *   4. Renders the real Bfloat IDE application inside a BrowserRouter.
 */

import React, { useEffect, useState } from "react"
import ReactDOM from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { invoke, Channel } from "@tauri-apps/api/core"
import { onOpenUrl } from "@tauri-apps/plugin-deep-link"
import "./styles.css"
import { getPlatform } from "./platform"
import { initialiseSidecarApi } from "./api"
import { initConveyorBridge } from "./conveyor-bridge"
import { installFrontendLogBridge } from "./frontend-log-bridge"
import { deployStore } from "@/app/stores/deploy"

// Import the real Bfloat IDE app component and its styles
import App from "@/app/app"
import { ErrorBoundary } from "@/app/components/ErrorBoundary"
import { WindowContextProvider, menuItems } from "@/app/components/window"
import appIcon from "@/resources/build/icon.png"

// ---------------------------------------------------------------------------
// Deep link listener
// ---------------------------------------------------------------------------

installFrontendLogBridge()

/**
 * Register the deep-link handler as early as possible so we do not miss any
 * URL that triggered the initial launch of the app.
 *
 * The handler fires both for:
 *  - URLs received while the app is already open (macOS, Windows, Linux)
 *  - The URL that caused a cold launch of the app (macOS/Linux, not Windows)
 *
 * For now we store the latest URL in a module-level variable and expose it
 * via the `getInitialDeepLink` helper.  Once the full routing layer is wired
 * up, route handlers can subscribe via `onOpenUrl` directly.
 */
let _initialDeepLink: string | null = null
const _deepLinkListeners: Array<(url: string) => void> = []

onOpenUrl((urls) => {
  for (const url of urls) {
    _initialDeepLink = url

    // Dispatch CustomEvents for OAuth callbacks so that components
    // using window.addEventListener('oauth-success'/'oauth-error') receive them.
    try {
      const lower = url.toLowerCase()
      if (lower.includes("oauth-success") || lower.includes("oauth-callback")) {
        window.dispatchEvent(
          new CustomEvent("oauth-success", {
            detail: { message: "Connected successfully", url },
          }),
        )
      } else if (lower.includes("oauth-error")) {
        window.dispatchEvent(
          new CustomEvent("oauth-error", {
            detail: { message: "Connection failed", url },
          }),
        )
      }
    } catch {
      // Ignore dispatch errors
    }

    for (const listener of _deepLinkListeners) {
      try {
        listener(url)
      } catch (err) {
        console.error("[deep-link] listener error:", err)
      }
    }
  }
}).catch((err) => {
  console.warn("[deep-link] failed to register handler:", err)
})

/** Returns the URL that caused the initial launch, if any. */
export function getInitialDeepLink(): string | null {
  return _initialDeepLink
}

/** Subscribe to deep-link events. Returns an unsubscribe function. */
export function addDeepLinkListener(
  listener: (url: string) => void,
): () => void {
  _deepLinkListeners.push(listener)
  return () => {
    const idx = _deepLinkListeners.indexOf(listener)
    if (idx !== -1) _deepLinkListeners.splice(idx, 1)
  }
}

// ---------------------------------------------------------------------------
// Initialisation gate
// ---------------------------------------------------------------------------

type InitState =
  | { status: "waiting" }
  | { status: "ready" }
  | { status: "error"; message: string }

/**
 * ServerGate waits for the Bfloat sidecar to become ready before rendering
 * children.  It calls the `await_initialization` Tauri command, which blocks
 * until the sidecar is healthy and accepting connections.
 *
 * While waiting it shows a minimal loading screen so the window is not blank.
 */
function ServerGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InitState>({ status: "waiting" })

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        // Warm up the platform singleton in parallel with the sidecar check
        // so that getPlatformSync() is safe to call after the gate opens.
        const channel = new Channel()
        channel.onmessage = (_msg: unknown) => {
          // InitStep events from the Rust backend (e.g. ServerWaiting, Done)
          // Could drive a progress indicator in the future.
        }
        const [serverReady] = await Promise.all([
          invoke<{ url: string; password: string | null }>(
            "await_initialization",
            { events: channel },
          ),
          getPlatform(),
        ])

        // Initialise the HTTP/WebSocket sidecar API client so that the rest of
        // the renderer can call getSidecarApiSync() without waiting.
        initialiseSidecarApi(serverReady.url, serverReady.password)

        // Install the window.conveyor compatibility bridge so that existing
        // React code that calls window.conveyor.* continues to work unchanged
        // while the migration from Electron to Tauri is in progress.
        initConveyorBridge()

        // One-time migration of deployments from localStorage → projects.json
        deployStore.migrate().catch((err) =>
          console.warn("[entry] deployment migration failed:", err)
        )

        if (!cancelled) {
          setState({ status: "ready" })
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "The Bfloat sidecar failed to start."
          console.error("[ServerGate] initialisation failed:", err)
          setState({ status: "error", message })
        }
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === "waiting") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0f1a",
          color: "#a0a0c0",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: "14px",
          gap: "12px",
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.6 }}
        >
          <circle cx="20" cy="20" r="18" stroke="#6366f1" strokeWidth="2" />
          <path
            d="M20 8 L20 20 L28 28"
            stroke="#6366f1"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span>Starting Bfloat IDE…</span>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0f1a",
          color: "#f87171",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: "14px",
          gap: "12px",
          padding: "32px",
          textAlign: "center",
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="20" cy="20" r="18" stroke="#f87171" strokeWidth="2" />
          <path
            d="M20 12 L20 22"
            stroke="#f87171"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="20" cy="28" r="1.5" fill="#f87171" />
        </svg>
        <span style={{ fontWeight: 600 }}>Failed to start</span>
        <span style={{ color: "#a0a0c0", maxWidth: 360 }}>{state.message}</span>
        <button
          onClick={() => {
            setState({ status: "waiting" })
            // Trigger a full reload so Tauri re-attempts initialisation
            window.location.reload()
          }}
          style={{
            marginTop: "8px",
            padding: "8px 20px",
            background: "#6366f1",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Root render
// ---------------------------------------------------------------------------

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error(
    'Could not find #root element. Check that index.html contains <div id="root">.',
  )
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/*
      ServerGate waits for the sidecar before mounting the app tree.
      Once ready, it renders children without unmounting them again.
    */}
    <ServerGate>
      {/*
        Match the shared desktop/web renderer bootstrap: keep routing state
        in-memory and surface renderer crashes instead of a blank window.
      */}
      <ErrorBoundary>
        <MemoryRouter>
          <WindowContextProvider titlebar={{ icon: appIcon, menuItems }}>
            <App />
          </WindowContextProvider>
        </MemoryRouter>
      </ErrorBoundary>
    </ServerGate>
  </React.StrictMode>,
)
