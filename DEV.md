# Development Guide

## Quick Start

```bash
# 1. Install dependencies
pnpm install
cd packages/sidecar && bun install && cd ../..
cd packages/desktop && bun install && cd ../..

# 2. Start the sidecar in dev mode (auto-reloads on changes)
cd packages/sidecar && bun run dev

# 3. In a separate terminal, start the Tauri desktop app (hot-reload)
cd packages/desktop && bunx tauri dev
```

## Testing Changes

### Frontend only (React/UI)

Tauri dev mode hot-reloads automatically — just save the file.

### Sidecar changes

The sidecar runs as a compiled binary inside the Tauri app. In dev mode (`bun run dev`), the sidecar runs directly from source with `--watch`, so changes auto-reload. But if you need to test with the **compiled binary** (closer to production):

```bash
# 1. Build the sidecar for mac ARM
cd packages/sidecar
bun run build:mac-arm64

# 2. Copy the binary to Tauri's sidecars directory
cp dist/bfloat-sidecar-aarch64-apple-darwin ../desktop/src-tauri/sidecars/

# 3. Restart the Tauri app
cd ../desktop && bunx tauri dev
```

### Sidecar build targets

| Script            | Target                | Output                                              |
| ----------------- | --------------------- | --------------------------------------------------- |
| `build`           | Current platform      | `dist/bfloat-sidecar`                               |
| `build:mac-arm64` | macOS ARM64 (M-series)| `dist/bfloat-sidecar-aarch64-apple-darwin`           |
| `build:mac-x64`   | macOS Intel           | `dist/bfloat-sidecar-x86_64-apple-darwin`            |
| `build:linux-x64`  | Linux x64             | `dist/bfloat-sidecar-x86_64-unknown-linux-gnu`       |
| `build:win-x64`    | Windows x64           | `dist/bfloat-sidecar-x86_64-pc-windows-msvc.exe`     |

All scripts run from `packages/sidecar/`.

### Running sidecar tests

```bash
cd packages/sidecar && bun test
```

## Frontend Console Logs (WebView)

Frontend `console.log/info/warn/error/debug` logs are persisted in debug builds to:

`<AppLocalData>/logs/frontend-console.log`

The file is size-rotated automatically:
- `frontend-console.log` (active)
- `frontend-console.log.1`
- `frontend-console.log.2`
- `frontend-console.log.3`

### Stream logs live

macOS (dev identifier):

```bash
tail -F "$HOME/Library/Application Support/com.bfloat.ide.dev/logs/frontend-console.log"
```

Pretty-print with `pino-pretty` (logs are NDJSON, no repo dependency needed):

```bash
tail -F "$HOME/Library/Application Support/com.bfloat.ide.dev/logs/frontend-console.log" | pnpm dlx pino-pretty --colorize
```

### Determine the actual log location

The base path is Tauri `BaseDirectory::AppLocalData`, which depends on OS + app identifier.

1. Check identifier:
   - Dev: `packages/desktop/src-tauri/tauri.conf.json` → `com.bfloat.ide.dev`
   - Prod: `packages/desktop/src-tauri/tauri.prod.conf.json` → `com.bfloat.ide`
2. Build path by OS:
   - macOS: `~/Library/Application Support/<identifier>/logs/frontend-console.log`
   - Linux: `~/.local/share/<identifier>/logs/frontend-console.log`
   - Windows: `%APPDATA%\\<identifier>\\logs\\frontend-console.log`

Example (macOS, dev):

```bash
open "$HOME/Library/Application Support/com.bfloat.ide.dev/logs"
```

## Production Build (macOS ARM)

```bash
# Build sidecar
cd packages/sidecar
bun run build:mac-arm64
cp dist/bfloat-sidecar-aarch64-apple-darwin ../desktop/src-tauri/sidecars/

# Build Tauri app
cd ../desktop
bunx tauri build
```

Output: `packages/desktop/src-tauri/target/release/bundle/` (contains `.dmg` and `.app`).

## Local Storage

There is no central hosted database. The IDE is local-first.

Key local storage locations:

- Projects metadata: `~/.bfloat-ide/projects.json`
- Project workspaces: `~/.bfloat-ide/projects/<projectId>/`
- Provider/config settings: `~/.bfloat-ide/config/settings.json`

Opening a project creates or reuses a local workspace directory. Chat/session state, secrets, and project metadata are all managed on the local machine.

### Database integrations for the apps you build

When people say "database" in this codebase, it usually means database/backends for the app being built, not for the IDE itself. The current built-in project setup model supports Convex and Firebase, configured per project through Project Settings and project secrets.

## Project Layout

```
packages/
├── desktop/              # Tauri desktop shell (Rust + React/Vite frontend)
│   ├── src/              # Frontend entry, platform bridge
│   └── src-tauri/
│       ├── sidecars/     # Compiled sidecar binaries go here
│       └── tauri.conf.json
└── sidecar/              # Bun HTTP server (Hono)
    ├── src/
    │   ├── server.ts     # Entry point
    │   ├── routes/       # API routes
    │   └── services/     # Agent sessions, workspace profiling
    └── dist/             # Build output

app/                      # React UI components, hooks, stores
lib/                      # Shared: agents, MCP servers, platform abstraction
resources/
├── skills/               # AI agent skill prompts
└── templates/            # Project scaffolding templates (Expo, Next.js)
```
