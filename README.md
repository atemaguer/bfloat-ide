# Bfloat IDE

A local-first desktop IDE for building web and mobile apps with AI agents. Built-in terminal, live preview, code editor, and project-scoped integration setup — all running on your machine.

![Tauri](https://img.shields.io/badge/Tauri-2-blue)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![Bun](https://img.shields.io/badge/Bun-1.1-blue)
![License](https://img.shields.io/badge/License-Apache%202.0-green)
[![Discord](https://img.shields.io/discord/A2SUyzb3qM?label=Discord&logo=discord&logoColor=white)](https://discord.gg/A2SUyzb3qM)

## Why Bfloat IDE

Cloud AI builders like Lovable, Bolt, Base44, and v0 charge per-message or per-project fees, lock your code into proprietary hosting, and run thin prompt wrappers behind the scenes. When you outgrow their sandbox, you're stuck migrating off a platform that was never designed to let you leave.

Bfloat IDE is different:

### No lock-in

Your projects are standard Next.js and Expo repos stored on your local disk. There is no proprietary file system, no platform-specific hosting requirement, no export step. Open your project in VS Code, push it to any git host, deploy it anywhere. If you stop using Bfloat IDE tomorrow, nothing changes about your code.

### No platform tax

Bfloat IDE is free and open source. You use your own Claude Code and Codex subscriptions directly — the same ones you already pay for. There is no per-message markup, no credit system, no usage tier that gates features. Your AI costs are between you and Anthropic/OpenAI, with zero middleman.

### Better agents

Under the hood, Bfloat IDE runs [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/introducing-codex/) as full local agent processes. These are the best coding agents available today — they have terminal access, file system awareness, multi-step reasoning, and tool use. Other AI builders run lightweight prompt-and-paste wrappers that can't install dependencies, run tests, debug errors, or iterate on their own output. Claude Code and Codex can, and Bfloat IDE gives them a full local environment to do it in.

### Deploy anywhere in one click

Ship to the App Store through integrated Expo/EAS builds, or deploy your web app to Vercel, Render, Railway, or any platform that supports git-based deploys — directly from the IDE. No proprietary hosting to buy into. You pick the platform, Bfloat handles the push.

## Status

Bfloat IDE is in active early development. Core editing, preview, terminal, and AI agent workflows are functional. iOS deployment via Expo/EAS is the most mature deploy path. Expect rough edges and breaking changes between releases.

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

```bash
pnpm dev
```

This starts the Tauri development flow with hot-reload. See [`DEV.md`](DEV.md) for alternative workflows (sidecar-only, two-terminal setup) and useful commands.

## Building

```bash
pnpm build:sidecar
pnpm build
```

Build output ends up under `packages/desktop/src-tauri/target/release/bundle/`. See [`DEV.md`](DEV.md) for platform-specific sidecar builds and production build steps.

## Integrations

The IDE has project-scoped setup flows for Firebase, Convex, Stripe, and RevenueCat. Each is configured through Project Settings and stored as project secrets on your local machine. See [`DEV.md`](DEV.md) for the full list of expected environment variables per integration.

## Deployment

iOS apps deploy through integrated Expo/EAS builds with App Store Connect API key support. Web apps deploy via git push to any platform that supports it — Vercel, Render, Railway, etc.

## Contributing

Contributions are welcome.

When making changes:

- keep the local-first architecture intact
- prefer repo-accurate docs over aspirational docs
- verify commands against actual package scripts

## Getting Help

- [GitHub Issues](https://github.com/bfloat-inc/bfloat-ide/issues) — bug reports and feature requests
- [Discord](https://discord.gg/A2SUyzb3qM) — questions, discussion, and community

## License

Apache-2.0. See [`LICENSE`](LICENSE).
