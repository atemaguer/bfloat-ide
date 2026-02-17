import type { ITheme } from '@xterm/xterm'

export const darkTerminalTheme: ITheme = {
  background: '#0c0c0c',
  foreground: '#b8b8b8',
  cursor: '#e0e0e0',
  cursorAccent: '#0c0c0c',
  selectionBackground: 'rgba(255, 255, 255, 0.12)',
  selectionForeground: undefined,
  black: '#1a1a1a',
  red: '#e06c75',
  green: '#7ec699',
  yellow: '#e5c07b',
  blue: '#7ab3ef',
  magenta: '#c099e0',
  cyan: '#56d4dd',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#f2a6a6',
  brightGreen: '#a8d9a8',
  brightYellow: '#f2d99c',
  brightBlue: '#a6c9ed',
  brightMagenta: '#d4b3e6',
  brightCyan: '#8ae6ed',
  brightWhite: '#e6e6e6',
}

export const lightTerminalTheme: ITheme = {
  background: '#fafafa',
  foreground: '#383a42',
  cursor: '#526eff',
  cursorAccent: '#fafafa',
  selectionBackground: 'rgba(0, 0, 0, 0.08)',
  selectionForeground: undefined,
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#696c77',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#1e1e1e',
}

export const darkDeployTerminalTheme: ITheme = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#6366f1',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(99, 102, 241, 0.3)',
  selectionForeground: '#ffffff',
  black: '#27272a',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
}

export const lightDeployTerminalTheme: ITheme = {
  background: '#fafafa',
  foreground: '#18181b',
  cursor: '#6366f1',
  cursorAccent: '#fafafa',
  selectionBackground: 'rgba(99, 102, 241, 0.2)',
  selectionForeground: '#18181b',
  black: '#27272a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#09090b',
}

export const darkLogTerminalTheme: ITheme = {
  ...darkDeployTerminalTheme,
  foreground: '#a1a1aa',
  cursor: '#09090b',
  cursorAccent: '#09090b',
}

export const lightLogTerminalTheme: ITheme = {
  ...lightDeployTerminalTheme,
  foreground: '#71717a',
  cursor: '#fafafa',
  cursorAccent: '#fafafa',
}

export function getTerminalTheme(resolvedTheme: 'light' | 'dark'): ITheme {
  return resolvedTheme === 'dark' ? darkTerminalTheme : lightTerminalTheme
}

export function getDeployTerminalTheme(resolvedTheme: 'light' | 'dark'): ITheme {
  return resolvedTheme === 'dark' ? darkDeployTerminalTheme : lightDeployTerminalTheme
}

export function getLogTerminalTheme(resolvedTheme: 'light' | 'dark'): ITheme {
  return resolvedTheme === 'dark' ? darkLogTerminalTheme : lightLogTerminalTheme
}
