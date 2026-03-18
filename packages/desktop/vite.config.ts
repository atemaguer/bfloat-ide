import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

// Repo root is two levels up from packages/desktop
const repoRoot = resolve(__dirname, "..", "..")

// https://vitejs.dev/config/
export default defineConfig(async () => {
  // TAURI_DEV_HOST is set by the Tauri CLI when using a remote development host
  // (e.g. for iOS/Android device testing over the network)
  const host = process.env.TAURI_DEV_HOST

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],

    // Path aliases matching the existing Electron app's tsconfig paths
    resolve: {
      alias: {
        "@/app": resolve(repoRoot, "app"),
        "@/lib": resolve(repoRoot, "lib"),
        "@/resources": resolve(repoRoot, "resources"),
        "@": repoRoot,
      },
      // Avoid duplicate CodeMirror module instances across workspace package
      // boundaries (which breaks instanceof checks for extensions).
      dedupe: [
        "react",
        "react-dom",
        "react-router",
        "react-router-dom",
        "codemirror",
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
        "@codemirror/commands",
        "@codemirror/lang-javascript",
        "@codemirror/lang-json",
        "@codemirror/lang-css",
      ],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,

    server: {
      // Fixed port required by Tauri – must match devUrl in tauri.conf.json
      port: 1420,
      // Fail immediately if the port is already in use instead of trying the next
      strictPort: true,
      // Allow the dev server to be accessible from the TAURI_DEV_HOST address
      // (used for real device development with iOS / Android)
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // Tell Vite not to watch the Rust source directory to avoid noise and
        // prevent accidental full-reloads when cargo rebuilds output files.
        ignored: ["**/src-tauri/**"],
      },
    },

    // Env variables starting with VITE_ are available in the renderer via import.meta.env.
    // TAURI_ENV_* variables are provided by Tauri automatically during tauri dev / tauri build.
    envPrefix: ["VITE_", "TAURI_ENV_"],

    build: {
      // Tauri supports ES2021
      target:
        process.env.TAURI_ENV_PLATFORM == "windows"
          ? "chrome105"
          : "safari13",
      // Don't minify for debug builds
      minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
      // Produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
  }
})
