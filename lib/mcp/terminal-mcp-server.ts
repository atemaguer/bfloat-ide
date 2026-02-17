/**
 * Terminal MCP Server
 *
 * SDK MCP server for managing background terminal sessions for agents.
 * Enables creating PTY-backed terminals, sending input, reading output,
 * and terminating sessions (useful for running webhook listeners).
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { BrowserWindow } from 'electron'
import { createPtyTerminal, killTerminal, readTerminalOutput, writeToTerminal } from '@/lib/conveyor/handlers/terminal-handler'

const LOG_PREFIX = '[Terminal MCP]'

export interface TerminalMcpOptions {
  cwd: string
  env?: Record<string, string>
}

const generateTerminalId = () => `agent-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Creates a Terminal MCP server instance with tools for spawning PTY sessions.
 */
export function createTerminalMcpServer(options: TerminalMcpOptions) {
  console.log(`${LOG_PREFIX} Creating terminal MCP server for cwd: ${options.cwd}`)

  const server = createSdkMcpServer({
    name: 'terminal',
    version: '1.0.0',
    tools: [
      tool(
        'create_terminal_session',
        'Create a new terminal session (PTY). Optionally run a command immediately.',
        {
          terminalId: z.string().optional().describe('Optional custom terminal ID'),
          cwd: z.string().optional().describe('Working directory for the terminal (defaults to session cwd)'),
          command: z.string().optional().describe('Command to run after the terminal is created'),
          env: z.record(z.string(), z.string()).optional().describe('Environment variable overrides for the terminal'),
        },
        async (args) => {
          const terminalId = args.terminalId || generateTerminalId()
          const result = createPtyTerminal(terminalId, args.cwd || options.cwd, args.env || options.env)

          // Notify all renderer windows so the Workbench can create a terminal tab
          if (result.success) {
            const windows = BrowserWindow.getAllWindows()
            windows.forEach((win) => {
              if (!win.isDestroyed()) {
                win.webContents.send('agent-terminal-created', terminalId)
              }
            })
          }

          if (result.success && args.command) {
            writeToTerminal(terminalId, `${args.command}\r`)
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: result.success,
                    terminalId,
                    error: result.error,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: !result.success,
          }
        }
      ),
      tool(
        'write_terminal',
        'Send input to an existing terminal session.',
        {
          terminalId: z.string().describe('Terminal session ID'),
          input: z.string().describe('Input to send to the terminal'),
        },
        async (args) => {
          const result = writeToTerminal(args.terminalId, args.input)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: !result.success,
          }
        }
      ),
      tool(
        'read_terminal_output',
        'Read and clear buffered output from a terminal session.',
        {
          terminalId: z.string().describe('Terminal session ID'),
          maxChars: z.number().optional().describe('Maximum number of characters to return'),
        },
        async (args) => {
          const result = readTerminalOutput(args.terminalId, args.maxChars)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: !result.success,
          }
        }
      ),
      tool(
        'kill_terminal',
        'Terminate a terminal session.',
        {
          terminalId: z.string().describe('Terminal session ID'),
        },
        async (args) => {
          const result = killTerminal(args.terminalId)

          // Notify all renderer windows so the Workbench can remove the terminal tab
          if (result.success) {
            const windows = BrowserWindow.getAllWindows()
            windows.forEach((win) => {
              if (!win.isDestroyed()) {
                win.webContents.send('agent-terminal-closed', args.terminalId)
              }
            })
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: !result.success,
          }
        }
      ),
      tool(
        'restart_dev_server',
        'Restart the dev server that is already running in the IDE. The IDE automatically starts a dev server when a project is opened — use this tool to restart it after installing new dependencies or making config changes. Do NOT start your own dev server manually.',
        {},
        async () => {
          const windows = BrowserWindow.getAllWindows()
          let sent = false
          windows.forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send('restart-dev-server')
              sent = true
            }
          })

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: sent,
                    message: sent
                      ? 'Dev server restart initiated. The server will stop, reinstall dependencies, and restart automatically.'
                      : 'No active window found to restart the dev server.',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: !sent,
          }
        }
      ),
    ],
  })

  return server
}
