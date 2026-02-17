# Changelog

All notable changes to Bfloat IDE are documented here.

## [0.1.0] - 2025-02-17

### Added

- **AI Agent Integration**
  - Claude (Anthropic) support with OAuth and API key authentication
  - Codex (OpenAI) support with OAuth and API key authentication
  - Multi-session chat management with local persistence

- **Project Management**
  - Local-first architecture with data stored in `~/.bfloat-ide/`
  - Project templates for Expo and Next.js
  - Session history per project

- **Editor Features**
  - Integrated code editor with syntax highlighting
  - File explorer with tree view
  - Real-time preview for mobile and web apps

- **Development Tools**
  - Integrated terminal
  - MCP server support (Stripe, RevenueCat)
  - AI skills system for guided development

- **Desktop App**
  - Cross-platform Electron app (macOS, Windows, Linux)
  - Custom titlebar with native window controls
  - Dark/light theme support
  - Auto-updates via S3

### Technical Stack

- Electron 47.3.1
- React 19
- TypeScript 5.9
- TailwindCSS 4
- Vite (via electron-vite)
