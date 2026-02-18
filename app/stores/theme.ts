import { createStore } from 'zustand/vanilla'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

function getStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem('app_theme') as ThemePreference | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return 'dark'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return preference
}

function applyThemeToDocument(resolved: ResolvedTheme) {
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }

  // Update Electron window background color
  const bgColor = resolved === 'dark' ? '#1a1a1a' : '#fefefe'
  try {
    window.conveyor?.window?.windowSetBackgroundColor?.(bgColor)
  } catch {
    // conveyor may not be available yet during initial load
  }
}

class ThemeStore {
  theme = createStore<ThemePreference>(() => getStoredTheme())
  resolvedTheme = createStore<ResolvedTheme>(() => resolveTheme(getStoredTheme()))

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  constructor() {
    // Apply theme immediately
    applyThemeToDocument(this.resolvedTheme.getState())

    // Persist and apply on change
    this.theme.subscribe((preference) => {
      try {
        localStorage.setItem('app_theme', preference)
      } catch {
        // localStorage unavailable
      }
      const resolved = resolveTheme(preference)
      this.resolvedTheme.setState(resolved, true)
      applyThemeToDocument(resolved)
    })

    // Listen for system theme changes
    this.mediaQuery.addEventListener('change', () => {
      if (this.theme.getState() === 'system') {
        const resolved = resolveTheme('system')
        this.resolvedTheme.setState(resolved, true)
        applyThemeToDocument(resolved)
      }
    })
  }

  setTheme = (preference: ThemePreference) => {
    this.theme.setState(preference, true)
  }
}

export const themeStore = new ThemeStore()
