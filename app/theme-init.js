// Apply theme and accent immediately to prevent a flash of the wrong palette
;(function () {
  var palettes = {
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

  var accent = localStorage.getItem('app_accent_color') || 'purple'
  if (!palettes[accent]) {
    accent = 'purple'
  }

  var theme = localStorage.getItem('app_theme') || 'dark'
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }

  var palette = palettes[accent][theme]
  document.documentElement.style.setProperty('--primary', palette.primary)
  document.documentElement.style.setProperty('--primary-foreground', palette.primaryForeground)
  document.documentElement.style.setProperty('--primary-soft', palette.primarySoft)
  document.documentElement.style.setProperty('--support', palette.support)
  document.documentElement.style.setProperty('--support-foreground', palette.supportForeground)
  document.documentElement.style.setProperty('--support-soft', palette.supportSoft)
  document.documentElement.style.setProperty('--ring', palette.ring)
})()
