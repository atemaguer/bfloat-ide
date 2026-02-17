// Apply theme immediately to prevent FOUC (flash of unstyled content)
// This runs before React mounts, synchronously setting the dark/light class
;(function () {
  var theme = localStorage.getItem('app_theme') || 'dark'
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
})()
