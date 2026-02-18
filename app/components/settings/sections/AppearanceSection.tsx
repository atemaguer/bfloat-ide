import { useState } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { Switch } from '@/app/components/ui/Switch'
import { SettingsCard, SettingsRow, SettingsSelect } from '../components'
import { themeStore } from '@/app/stores/theme'
import type { ThemePreference } from '@/app/stores/theme'

export function AppearanceSection() {
  const theme = useStore(themeStore.theme)
  const [accentColor, setAccentColor] = useState('purple')
  const [compactMode, setCompactMode] = useState(false)
  const [showAnimations, setShowAnimations] = useState(true)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold text-foreground">Appearance</h1>

      {/* Theme */}
      <SettingsCard title="Theme">
        <SettingsRow
          title="Color scheme"
          description="Choose your preferred color scheme"
          isLast
        >
          <SettingsSelect
            value={theme}
            onChange={(v: string) => themeStore.setTheme(v as ThemePreference)}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </SettingsRow>
      </SettingsCard>

      {/* Accent Color */}
      <SettingsCard title="Accent color">
        <SettingsRow
          title="Primary color"
          description="Choose your accent color for buttons and highlights"
          isLast
        >
          <SettingsSelect
            value={accentColor}
            onChange={setAccentColor}
            options={[
              { value: 'purple', label: 'Purple' },
              { value: 'blue', label: 'Blue' },
              { value: 'green', label: 'Green' },
              { value: 'orange', label: 'Orange' },
              { value: 'pink', label: 'Pink' },
            ]}
          />
        </SettingsRow>
      </SettingsCard>

      {/* Display */}
      <SettingsCard title="Display">
        <SettingsRow
          title="Compact mode"
          description="Reduce spacing and padding throughout the interface"
        >
          <Switch checked={compactMode} onCheckedChange={setCompactMode} />
        </SettingsRow>
        <SettingsRow
          title="Show animations"
          description="Enable animations and transitions"
          isLast
        >
          <Switch checked={showAnimations} onCheckedChange={setShowAnimations} />
        </SettingsRow>
      </SettingsCard>
    </div>
  )
}
