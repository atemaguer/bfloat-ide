import { Switch } from '@/app/components/ui/Switch'
import { useStore } from '@/app/hooks/useStore'
import { preferencesStore } from '@/app/stores/preferences'
import { providerAuthStore } from '@/app/stores/provider-auth'
import type { EditorFontSize } from '@/app/stores/preferences'
import { SettingsCard, SettingsRow, SettingsSelect } from '../components'

export function PreferencesSection() {
  const defaultView = useStore(preferencesStore.projectListView)
  const editorFontSize = useStore(preferencesStore.editorFontSize)
  const showLineNumbers = useStore(preferencesStore.showLineNumbers)
  const wordWrap = useStore(preferencesStore.wordWrap)
  const formatOnSave = useStore(preferencesStore.formatOnSave)
  const autoSave = useStore(preferencesStore.autoSave)
  const providerSettings = useStore(providerAuthStore.settings)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold text-foreground">Preferences</h1>

      {/* General */}
      <SettingsCard title="General">
        <SettingsRow
          title="Default project view"
          description="Choose how projects are displayed on the home page"
        >
          <SettingsSelect
            value={defaultView}
            onChange={preferencesStore.setProjectListView}
            options={[
              { value: 'grid', label: 'Grid view' },
              { value: 'list', label: 'List view' },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          title="Auto-save"
          description="Automatically save changes as you type"
          isLast
        >
          <Switch checked={autoSave} onCheckedChange={preferencesStore.setAutoSave} />
        </SettingsRow>
      </SettingsCard>

      {/* Editor */}
      <SettingsCard title="Editor">
        <SettingsRow
          title="Font size"
          description="Adjust the font size in the code editor"
        >
          <SettingsSelect
            value={editorFontSize}
            onChange={(value) => preferencesStore.setEditorFontSize(value as EditorFontSize)}
            options={[
              { value: '12', label: '12px' },
              { value: '13', label: '13px' },
              { value: '14', label: '14px' },
              { value: '15', label: '15px' },
              { value: '16', label: '16px' },
              { value: '18', label: '18px' },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          title="Show line numbers"
          description="Display line numbers in the editor gutter"
        >
          <Switch checked={showLineNumbers} onCheckedChange={preferencesStore.setShowLineNumbers} />
        </SettingsRow>
        <SettingsRow
          title="Word wrap"
          description="Wrap long lines to fit the editor width"
        >
          <Switch checked={wordWrap} onCheckedChange={preferencesStore.setWordWrap} />
        </SettingsRow>
        <SettingsRow
          title="Format on save"
          description="Automatically format code when saving files"
          isLast
        >
          <Switch checked={formatOnSave} onCheckedChange={preferencesStore.setFormatOnSave} />
        </SettingsRow>
      </SettingsCard>

      {/* AI Assistant */}
      <SettingsCard title="AI Assistant">
        <SettingsRow
          title="Default AI provider"
          description="Choose which AI model to use by default"
          isLast
        >
          <SettingsSelect
            value={providerSettings.defaultProvider}
            onChange={(value) => providerAuthStore.setDefaultProvider(value as 'anthropic' | 'openai')}
            options={[
              { value: 'anthropic', label: 'Claude' },
              { value: 'openai', label: 'ChatGPT' },
            ]}
          />
        </SettingsRow>
      </SettingsCard>
    </div>
  )
}
