import { createStore } from 'zustand/vanilla'
import { window as sidecarWindow } from '@/app/api/sidecar'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type AccentColor = 'purple' | 'blue' | 'green' | 'orange' | 'pink'

type AccentPalette = {
  primary: string
  primaryForeground: string
  primarySoft: string
  support: string
  supportForeground: string
  supportSoft: string
  ring: string
}

const THEME_STORAGE_KEY = 'app_theme'
const ACCENT_STORAGE_KEY = 'app_accent_color'

const accentPalettes: Record<AccentColor, Record<ResolvedTheme, AccentPalette>> = {
  purple: {
    light: {
      primary: '270 95% 62%',
      primaryForeground: '0 0% 100%',
      primarySoft: '270 95% 62% / 0.14',
      support: '214 100% 60%',
      supportForeground: '0 0% 100%',
      supportSoft: '214 100% 60% / 0.14',
      ring: '270 95% 62%',
    },
    dark: {
      primary: '258 90% 76%',
      primaryForeground: '222 47% 11%',
      primarySoft: '258 90% 76% / 0.18',
      support: '207 100% 65%',
      supportForeground: '222 47% 11%',
      supportSoft: '207 100% 65% / 0.18',
      ring: '258 90% 76%',
    },
  },
  blue: {
    light: {
      primary: '214 100% 60%',
      primaryForeground: '0 0% 100%',
      primarySoft: '214 100% 60% / 0.14',
      support: '270 95% 62%',
      supportForeground: '0 0% 100%',
      supportSoft: '270 95% 62% / 0.14',
      ring: '214 100% 60%',
    },
    dark: {
      primary: '207 100% 65%',
      primaryForeground: '222 47% 11%',
      primarySoft: '207 100% 65% / 0.18',
      support: '258 90% 76%',
      supportForeground: '222 47% 11%',
      supportSoft: '258 90% 76% / 0.18',
      ring: '207 100% 65%',
    },
  },
  green: {
    light: {
      primary: '160 84% 39%',
      primaryForeground: '0 0% 100%',
      primarySoft: '160 84% 39% / 0.14',
      support: '173 80% 36%',
      supportForeground: '0 0% 100%',
      supportSoft: '173 80% 36% / 0.14',
      ring: '160 84% 39%',
    },
    dark: {
      primary: '151 72% 48%',
      primaryForeground: '155 42% 10%',
      primarySoft: '151 72% 48% / 0.18',
      support: '168 76% 42%',
      supportForeground: '170 56% 10%',
      supportSoft: '168 76% 42% / 0.18',
      ring: '151 72% 48%',
    },
  },
  orange: {
    light: {
      primary: '28 96% 56%',
      primaryForeground: '0 0% 100%',
      primarySoft: '28 96% 56% / 0.16',
      support: '38 92% 50%',
      supportForeground: '0 0% 100%',
      supportSoft: '38 92% 50% / 0.14',
      ring: '28 96% 56%',
    },
    dark: {
      primary: '31 100% 62%',
      primaryForeground: '24 80% 11%',
      primarySoft: '31 100% 62% / 0.2',
      support: '40 100% 58%',
      supportForeground: '30 80% 11%',
      supportSoft: '40 100% 58% / 0.18',
      ring: '31 100% 62%',
    },
  },
  pink: {
    light: {
      primary: '330 81% 60%',
      primaryForeground: '0 0% 100%',
      primarySoft: '330 81% 60% / 0.14',
      support: '344 82% 62%',
      supportForeground: '0 0% 100%',
      supportSoft: '344 82% 62% / 0.14',
      ring: '330 81% 60%',
    },
    dark: {
      primary: '330 86% 69%',
      primaryForeground: '336 56% 12%',
      primarySoft: '330 86% 69% / 0.18',
      support: '344 86% 67%',
      supportForeground: '342 56% 12%',
      supportSoft: '344 86% 67% / 0.18',
      ring: '330 86% 69%',
    },
  },
}

function getStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return 'dark'
}

function getStoredAccentColor(): AccentColor {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor | null
    if (stored === 'purple' || stored === 'blue' || stored === 'green' || stored === 'orange' || stored === 'pink') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return 'purple'
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

  const bgColor = resolved === 'dark' ? '#1a1a1a' : '#fefefe'
  try {
    sidecarWindow.windowSetBackgroundColor(bgColor)
  } catch {
    // sidecar may not be available yet during initial load
  }
}

function getAccentPalette(color: AccentColor, resolved: ResolvedTheme): AccentPalette {
  return accentPalettes[color][resolved]
}

function applyAccentToDocument(color: AccentColor, resolved: ResolvedTheme) {
  const palette = getAccentPalette(color, resolved)
  const root = document.documentElement

  root.style.setProperty('--primary', palette.primary)
  root.style.setProperty('--primary-foreground', palette.primaryForeground)
  root.style.setProperty('--primary-soft', palette.primarySoft)
  root.style.setProperty('--support', palette.support)
  root.style.setProperty('--support-foreground', palette.supportForeground)
  root.style.setProperty('--support-soft', palette.supportSoft)
  root.style.setProperty('--ring', palette.ring)
}

class ThemeStore {
  theme = createStore<ThemePreference>(() => getStoredTheme())
  resolvedTheme = createStore<ResolvedTheme>(() => resolveTheme(getStoredTheme()))
  accentColor = createStore<AccentColor>(() => getStoredAccentColor())

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  constructor() {
    this.applyToDocument()

    this.theme.subscribe((preference) => {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, preference)
      } catch {
        // localStorage unavailable
      }

      const resolved = resolveTheme(preference)
      this.resolvedTheme.setState(resolved, true)
      this.applyToDocument()
    })

    this.accentColor.subscribe((accentColor) => {
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, accentColor)
      } catch {
        // localStorage unavailable
      }

      this.applyToDocument()
    })

    this.mediaQuery.addEventListener('change', () => {
      if (this.theme.getState() === 'system') {
        this.resolvedTheme.setState(resolveTheme('system'), true)
        this.applyToDocument()
      }
    })
  }

  setTheme = (preference: ThemePreference) => {
    this.theme.setState(preference, true)
  }

  setAccentColor = (accentColor: AccentColor) => {
    this.accentColor.setState(accentColor, true)
  }

  private applyToDocument() {
    const resolved = this.resolvedTheme.getState()
    applyThemeToDocument(resolved)
    applyAccentToDocument(this.accentColor.getState(), resolved)
  }
}

export const themeStore = new ThemeStore()
