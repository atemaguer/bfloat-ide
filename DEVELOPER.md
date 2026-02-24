# Developer Guide

## Prerequisites

- Node.js 20+ (project currently works with newer Node versions too)
- `pnpm` 10+
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Bun (used by Tauri `BeforeDevCommand`)

## First-Time Setup

```bash
pnpm install
```

This repo uses a pnpm workspace. The workspace config is in `pnpm-workspace.yaml`, and `packages/desktop` must be installed so local binaries like `tauri` are available.

## Run In Development

```bash
pnpm dev
```

This runs:

- frontend dev server on `http://localhost:1420`
- Tauri app from `packages/desktop/src-tauri`

## Rust Toolchain Notes

Some current dependencies require newer Rust compilers (at least `1.88.0`).

Recommended local setup:

```bash
rustup update stable
rustup override set stable
rustc --version
```

If `rustc` is below `1.88.0`, update and retry.

## Common Errors

### `sh: tauri: command not found`

Cause: `packages/desktop` dependencies were not installed.

Fix:

```bash
pnpm install
pnpm --filter @bfloat/desktop exec tauri --version
```

### `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`

Happens in non-interactive environments. Use:

```bash
CI=true pnpm install
```

### `ENOTFOUND registry.npmjs.org`

Cause: DNS/network issue to npm registry.

Fix: restore connectivity and rerun install.
