# Bfloat IDE

A local-first, open-source AI-powered IDE for building software with integrated AI agents.

<br />

![Electron](https://img.shields.io/badge/Electron-47.3.1-blue)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
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

- **[Electron](https://www.electronjs.org)** - Cross-platform desktop application framework
- **[React](https://react.dev)** - UI framework
- **[TypeScript](https://www.typescriptlang.org)** - Type-safe JavaScript
- **[Shadcn UI](https://ui.shadcn.com)** - Component library
- **[TailwindCSS](https://tailwindcss.com)** - Utility-first CSS framework
- **[Electron Vite](https://electron-vite.org)** - Fast build tool with HMR
- **[Claude SDK](https://docs.anthropic.com)** - Anthropic's Claude AI integration
- **[Codex SDK](https://openai.com)** - OpenAI's Codex integration

<br />

## Installation

```bash
# Clone the repository
git clone https://github.com/atemaguer/bfloat-ide.git

# Change directory
cd bfloat-ide

# Install dependencies
pnpm install
```

<br />

## Development

Start the development server:

```bash
pnpm dev
```

This launches Electron with hot-reload enabled.

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
├── app/                    # Renderer process (React UI)
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── stores/             # State management
│   └── styles/             # Global styles
├── lib/
│   ├── agents/             # AI agent providers (Claude, Codex)
│   ├── conveyor/           # Type-safe IPC system
│   ├── main/               # Electron main process
│   ├── mcp/                # MCP server integrations
│   └── preload/            # Preload scripts
└── resources/
    ├── skills/             # AI agent skills
    └── templates/          # Project templates
```

<br />

## Building for Production

```bash
# For macOS
pnpm build:mac:prod

# For Windows
pnpm build:win:prod

# For Linux
pnpm build:linux:prod
```

Distribution files will be in the `dist` directory.

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
