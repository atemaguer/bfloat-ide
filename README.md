# Bfloat IDE

Bfloat IDE is a local-first desktop IDE for building web and mobile apps with integrated AI agents, local project storage, a built-in terminal, live preview, and project-scoped setup flows for common integrations.

This README is the primary documentation for the repo. It covers how the codebase is structured, how to run it locally, how local storage works, how integrations are configured, and what deployment/build flows exist today.

![Tauri](https://img.shields.io/badge/Tauri-2-blue)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![Bun](https://img.shields.io/badge/Bun-1.1-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## What It Is

- Local-first desktop app built with Tauri.
- Bun sidecar process that exposes local HTTP and WebSocket APIs.
- React renderer that drives the editor, preview, chat, settings, deploy flows, and project setup.
- AI-assisted workflow built around locally installed Claude Code and Codex CLIs.
- Project templates for mobile and web apps.

## What It Is Not

- Not a hosted SaaS backend.
- Not a central cloud database that stores your IDE state.
- Not dependent on OpenAI API keys for normal Codex usage inside the IDE.
- Not dependent on Anthropic API keys for normal Claude usage inside the IDE.

For normal IDE use, Claude and Codex are expected to come from your local installed/authenticated CLIs.

## Architecture

The repo has three main layers:

- `packages/desktop`
  Tauri desktop shell plus the renderer bootstrap.
- `packages/sidecar`
  Bun sidecar server with routes for files, terminal, agents, deploy, secrets, templates, and preview.
- `app` and `lib`
  Shared React UI, stores, hooks, schemas, and agent/provider logic used by the desktop app.

Runtime model:

1. The desktop app launches the bundled sidecar.
2. The renderer waits for the sidecar to become ready.
3. The renderer talks to the sidecar over local HTTP and WebSocket APIs.
4. Projects, sessions, settings, and secrets are stored locally on the machine.

## Repo Layout

```text
bfloat-ide/
├── app/                        # Shared React UI, hooks, stores, API access
├── lib/                        # Shared schemas, agents, launch logic, MCP integration
├── packages/
│   ├── desktop/                # Tauri shell and renderer entry
│   │   └── src-tauri/          # Rust app + bundled sidecars/resources
│   └── sidecar/                # Bun sidecar server
├── resources/
│   ├── skills/                 # Bundled agent skills
│   └── templates/              # Starter project templates
├── DEV.md                      # Supplemental dev notes
├── DEVELOPER.md                # Supplemental troubleshooting notes
└── RELEASE.md                  # Supplemental release notes
```

## Prerequisites

You need all of the following installed locally:

- Node.js 20+
- `pnpm`
- Bun
- Rust toolchain via `rustup`
- Tauri system dependencies for your OS

Recommended checks:

```bash
node --version
pnpm --version
bun --version
rustc --version
cargo --version
```

The project currently expects a modern Rust toolchain. If your Rust install is stale, update it:

```bash
rustup update stable
rustup override set stable
```

## First-Time Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/bfloat-inc/bfloat-ide.git
cd bfloat-ide

pnpm install
cd packages/sidecar && bun install && cd ../..
cd packages/desktop && bun install && cd ../..
```

Why both `pnpm` and `bun install`:

- `pnpm install` installs the workspace dependencies.
- `packages/sidecar` uses Bun directly for its runtime/build/test workflows.
- `packages/desktop` uses the Tauri/Vite toolchain from its own package.

## Running Locally

### Recommended dev workflow

From the repo root:

```bash
pnpm dev
```

That starts the Tauri development flow for the desktop app.

### Sidecar-only development

If you want to run the sidecar directly:

```bash
pnpm dev:sidecar
```

Or:

```bash
cd packages/sidecar
bun run dev
```

### Two-terminal workflow

If you want the sidecar and desktop app in separate terminals:

```bash
# Terminal 1
cd packages/sidecar
bun run dev

# Terminal 2
cd packages/desktop
bunx tauri dev
```

### Useful commands

```bash
pnpm lint
pnpm format
pnpm check:templates

cd packages/sidecar && bun test
pnpm -s exec tsc --noEmit --pretty false
```

## Building

### Build the sidecar

```bash
pnpm build:sidecar
```

Or directly:

```bash
cd packages/sidecar
bun run build
```

Platform-specific sidecar builds:

```bash
cd packages/sidecar
bun run build:mac-arm64
bun run build:mac-x64
bun run build:linux-x64
bun run build:win-x64
```

### Build the desktop app

```bash
pnpm build
```

Or:

```bash
cd packages/desktop
bunx tauri build
```

Build output ends up under:

```text
packages/desktop/src-tauri/target/release/bundle/
```

## AI Providers

### Claude and Codex

The IDE is designed around locally installed/authenticated CLIs:

- Claude Code for Claude sessions
- Codex for Codex/OpenAI sessions

The important operational point:

- You do not need to configure an OpenAI API key in the IDE to use Codex normally.
- You do not need to configure an Anthropic API key in the IDE to use Claude normally.

Instead, the IDE checks and uses the local CLI auth state on your machine.

### Connected Accounts

Today, the app-level Connected Accounts section is intentionally narrow:

- Claude: local CLI auth status
- Codex: local CLI auth status
- Expo: app-level Expo token storage for deployment workflows

Project-specific secrets such as Stripe, Convex, RevenueCat, and Firebase keys do not belong in global connected accounts. They belong in project settings.

## Local Storage and "Database"

There is no central hosted Bfloat IDE database required to run the app.

The IDE is local-first.

Key local storage locations:

- Projects metadata:
  `~/.bfloat-ide/projects.json`
- Project workspaces:
  `~/.bfloat-ide/projects/<projectId>/`
- Provider/config settings:
  `~/.bfloat-ide/config/settings.json`

This means:

- opening a project creates or reuses a local workspace directory
- chat/session state is stored locally
- secrets and project metadata are managed on the local machine

### Database integrations for the apps you build

When people say "database" in this codebase, it usually means database/backends for the app being built, not for the IDE itself.

The current built-in project setup model supports:

- Convex
- Firebase

These are configured per project through Project Settings and project secrets.

## Integrations

The IDE has project-scoped integration flows for:

- Firebase
- Convex
- Stripe
- RevenueCat

These are configured in Project Settings and stored as project secrets, not as global app settings.

### Firebase

Firebase setup is local-first and credentials-based. The IDE does not provision a Firebase project for you.

Expected project secrets:

- Web:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `NEXT_PUBLIC_FIREBASE_APP_ID`
- Mobile:
  - `EXPO_PUBLIC_FIREBASE_API_KEY`
  - `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
  - `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `EXPO_PUBLIC_FIREBASE_APP_ID`

### Convex

Convex is configured from project secrets. The IDE can then use those values to drive setup flows.

Expected project secrets:

- Web:
  - `NEXT_PUBLIC_CONVEX_URL`
  - `NEXT_PUBLIC_CONVEX_SITE_URL` (optional)
  - `CONVEX_DEPLOY_KEY`
- Mobile:
  - `EXPO_PUBLIC_CONVEX_URL`
  - `EXPO_PUBLIC_CONVEX_SITE_URL` (optional)
  - `CONVEX_DEPLOY_KEY`

### Stripe

Stripe is project-scoped.

Expected project secrets:

- Web:
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_SECRET_KEY`
- Mobile:
  - `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_SECRET_KEY`

### RevenueCat

RevenueCat is also project-scoped.

Expected project secret:

- `REVENUECAT_API_KEY`

For mobile runtime usage, projects may also need:

- `EXPO_PUBLIC_REVENUECAT_API_KEY`

## Payments

Payments support today is integration-driven rather than platform-hosted.

What exists:

- Stripe project setup via secrets
- RevenueCat project setup via secrets

What that means in practice:

- Bfloat IDE does not run your payments backend for you.
- You add the necessary project secrets in Project Settings.
- The app uses those secrets to run the corresponding setup flows and agent-assisted implementation work.

Use Stripe when you need:

- direct payments
- billing
- subscriptions on web/mobile with your own app logic

Use RevenueCat when you need:

- in-app purchases
- subscription management for mobile apps

## Deployment

Deployment support is not symmetrical across targets.

### iOS

iOS deployment is the most developed built-in deployment path today.

It uses:

- Expo / EAS
- App Store Connect credentials
- App Store Connect API key support for non-interactive flows

Relevant capabilities in the sidecar include:

- saving App Store Connect API keys
- checking ASC key configuration
- running interactive and non-interactive iOS build flows
- streaming deployment logs and status

### Expo

The IDE can store an app-level `EXPO_TOKEN` in Connected Accounts for Expo/EAS workflows.

### Web

Web deployment is currently not a hosted Bfloat deployment product.

The practical workflow is:

1. connect a git remote
2. commit and push from the IDE
3. let your hosting platform deploy from that repository

The repo also contains an explicit local-first note in the web deploy UI that backend web deployment is not supported in local-first mode.

### Android

Android publishing is not documented as a first-class completed path in the current codebase. Do not present it as equivalent to the iOS flow.

## Project Settings vs App Settings

This distinction matters:

### App Settings

Use app settings for:

- local Claude auth status
- local Codex auth status
- global Expo token
- IDE preferences

### Project Settings

Use project settings for:

- project secrets
- Firebase configuration
- Convex configuration
- Stripe keys
- RevenueCat keys
- git remote configuration
- app bundle/package identifiers
- app icons and project metadata

## Logging and Debugging

Frontend console logs are persisted in debug builds under the app-local data directory.

Example on macOS dev builds:

```bash
tail -F "$HOME/Library/Application Support/com.bfloat.ide.dev/logs/frontend-console.log"
```

Pretty-print:

```bash
tail -F "$HOME/Library/Application Support/com.bfloat.ide.dev/logs/frontend-console.log" | pnpm dlx pino-pretty --colorize
```

## Supplemental Docs

This README is the primary doc, but these files still exist for deeper reference:

- [`DEV.md`](DEV.md)
- [`DEVELOPER.md`](DEVELOPER.md)
- [`RELEASE.md`](RELEASE.md)

## Contributing

Contributions are welcome.

When making changes:

- keep the local-first architecture intact
- prefer repo-accurate docs over aspirational docs
- verify commands against actual package scripts

## License

MIT. See [`LICENSE`](LICENSE).
