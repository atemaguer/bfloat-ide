# Bfloat IDE

A local-first, open-source AI-powered IDE for building software with integrated AI agents.

<br />

![Tauri](https://img.shields.io/badge/Tauri-2-blue)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![Bun](https://img.shields.io/badge/Bun-1.1-blue)
![License](https://img.shields.io/badge/License-MIT-green)

<br />

## Features

- **AI Agent Integration** - Built-in support for Claude and OpenAI Codex agents
- **Multi-Session Support** - Manage multiple chat sessions per project with local persistence
- **Local-First Architecture** - All data stored locally in `~/.bfloat-ide/projects.json`
- **Project Templates** - Start new projects with Expo or Next.js templates
- **Real-Time Preview** - Live preview for mobile and web applications
- **Integrated Terminal** - Full terminal access within the IDE
- **File Explorer** - Browse and edit project files with syntax highlighting
- **Dark/Light Mode** - Built-in theme switching

<br />

## Tech Stack

- **[Tauri](https://tauri.app)** - Lightweight cross-platform desktop shell (Rust)
- **[Bun](https://bun.sh)** - Sidecar HTTP API server (replaces Electron main process)
- **[Hono](https://hono.dev)** - Fast web framework for the sidecar API
- **[React](https://react.dev)** - UI framework
- **[TypeScript](https://www.typescriptlang.org)** - Type-safe JavaScript
- **[Zustand](https://zustand-demo.pmnd.rs)** - State management
- **[Shadcn UI](https://ui.shadcn.com)** - Component library
- **[TailwindCSS](https://tailwindcss.com)** - Utility-first CSS framework
- **[Vite](https://vite.dev)** - Fast build tool with HMR
- **[Claude SDK](https://docs.anthropic.com)** - Anthropic's Claude AI integration
- **[Codex SDK](https://openai.com)** - OpenAI's Codex integration

<br />

## Installation

### Prerequisites

- [Rust](https://rustup.rs) (for Tauri)
- [Bun](https://bun.sh) (for the sidecar and package management)
- [Node.js](https://nodejs.org) 20+ (for some tooling)

```bash
# Clone the repository
git clone https://github.com/atemaguer/bfloat-ide.git

# Change directory
cd bfloat-ide

# Install root dependencies
pnpm install

# Install sidecar dependencies
cd packages/sidecar && bun install && cd ../..

# Install desktop dependencies
cd packages/desktop && bun install && cd ../..
```

<br />

## Development

Start the development server:

```bash
# Build and run the sidecar
cd packages/sidecar && bun run build && cd ../..

# Start the Tauri dev environment (launches the desktop app with hot-reload)
cd packages/desktop && bunx tauri dev
```

<br />

## Configuration

### AI Provider Setup

Bfloat IDE supports multiple AI providers. Configure them in the app settings:

1. **Claude** - Requires Anthropic API key or Claude Max subscription
2. **Codex** - Requires OpenAI API key

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

<br />

## Project Structure

```
bfloat-ide/
├── app/                    # Frontend (React UI)
│   ├── api/                # Sidecar API client imports
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── stores/             # Zustand state management
│   └── styles/             # Global styles
├── lib/
│   ├── agents/             # AI agent providers (Claude, Codex)
│   ├── conveyor/schemas/   # Shared TypeScript types/schemas
│   ├── launch/             # System prompt and launch config
│   ├── mcp/                # MCP server integrations
│   └── platform/           # Platform utilities
├── packages/
│   ├── desktop/            # Tauri desktop shell
│   │   ├── src/            # Conveyor bridge, entry point, platform layer
│   │   └── src-tauri/      # Rust Tauri application
│   └── sidecar/            # Bun HTTP API server (Hono)
│       └── src/
│           ├── routes/     # API route handlers
│           └── services/   # Agent session management
└── resources/
    ├── skills/             # AI agent skills
    └── templates/          # Project templates
```

<br />

## Building for Production

```bash
# Build the sidecar binary for the current platform
cd packages/sidecar
bun build --compile src/server.ts --outfile dist/bfloat-sidecar

# Copy the sidecar binary to the Tauri sidecars directory
cp dist/bfloat-sidecar ../desktop/src-tauri/sidecars/

# Build the Tauri app
cd ../desktop
bunx tauri build
```

Distribution files will be in `packages/desktop/src-tauri/target/release/bundle/`.

<br />

## Local Data Storage

All project data is stored locally:

- **Projects**: `~/.bfloat-ide/projects.json`
- **Sessions**: Stored within each project's data
- **Settings**: `~/.bfloat-ide/settings.json`

<br />

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

<br />

## License

MIT License - see [LICENSE](LICENSE) for details.
