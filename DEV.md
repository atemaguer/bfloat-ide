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
