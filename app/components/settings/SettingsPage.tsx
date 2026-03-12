import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Settings,
  Palette,
  Link2,
  Bell,
  Shield,
  Keyboard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PreferencesSection } from './sections/PreferencesSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { ConnectedAccountsSection } from './sections/ConnectedAccountsSection'

type SettingsSection = 'preferences' | 'appearance' | 'connected-accounts' | 'notifications' | 'security' | 'shortcuts'

interface NavItem {
  id: SettingsSection
  label: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'connected-accounts', label: 'Connected accounts', icon: Link2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security & access', icon: Shield },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
]

function ComingSoonSection({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold text-foreground">{title}</h1>
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card p-12">
        <span className="text-lg text-muted-foreground">Coming soon</span>
        <span className="text-sm text-muted-foreground/70">
          This section is under development
        </span>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SettingsSection>('preferences')
  const [appVersion, setAppVersion] = useState<string>('')

  // TODO: Update namespace doesn't exist in the new API - need to implement version fetching
  // Fetch app version on mount
  useEffect(() => {
    // Placeholder - update API not yet available in new sidecar
    // Will implement when update namespace is added
  }, [])

  const handleBackToApp = () => {
    navigate('/')
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleBackToApp()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const renderSection = () => {
    switch (activeSection) {
      case 'preferences':
        return <PreferencesSection />
      case 'appearance':
        return <AppearanceSection />
      case 'connected-accounts':
        return <ConnectedAccountsSection />
      case 'notifications':
        return <ComingSoonSection title="Notifications" />
      case 'security':
        return <ComingSoonSection title="Security & Access" />
      case 'shortcuts':
        return <ComingSoonSection title="Keyboard Shortcuts" />
      default:
        return <PreferencesSection />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar */}
      <aside className="flex h-screen w-56 min-w-56 flex-col gap-6 border-r border-border bg-background px-2 py-4 overflow-hidden">
        <button
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={handleBackToApp}
        >
          <ArrowLeft size={16} />
          <span className="text-sm">Back</span>
        </button>

        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={cn(
                'flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm',
                activeSection === item.id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
              onClick={() => setActiveSection(item.id)}
            >
              <item.icon size={16} className="opacity-70" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Version display at bottom */}
        <div className="mt-auto pt-4 border-t border-border">
          <span className="px-3 text-xs text-muted-foreground/60">
            {appVersion ? `Bfloat v${appVersion}` : 'Bfloat'}
          </span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-12">
        <div className="mx-auto max-w-[640px]">
          {renderSection()}
        </div>
      </main>
    </div>
  )
}
