import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from '@nanostores/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/app/lib/query-client'
import { isOnboardingComplete } from '@/app/stores/onboarding'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { HomePage } from '@/app/components/home'
import ProjectPage from '@/app/components/project/ProjectPage'
import { OnboardingWizard } from '@/app/components/onboarding'
import { SettingsPage } from '@/app/components/settings'
import { DeploymentNotification } from '@/app/components/ui/DeploymentNotification'
import { IOSDeployModals } from '@/app/components/deploy/IOSDeployModals'
import { CommandPalette } from '@/app/components/ui/CommandPalette'
import { Toaster } from 'react-hot-toast'
import './styles/app.css'

export default function App() {
  const onboardingComplete = useStore(isOnboardingComplete)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Load provider auth on mount to check onboarding status
  useEffect(() => {
    providerAuthStore.loadFromStorage().then(() => {
      setOnboardingChecked(true)
    })
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K - Open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
      }
      // Cmd+, / Ctrl+, - Open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        window.location.href = '/settings'
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Show loading while checking onboarding status
  if (!onboardingChecked) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="fixed inset-0 bg-background flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </QueryClientProvider>
    )
  }

  // Show onboarding wizard if onboarding not complete
  if (onboardingChecked && !onboardingComplete) {
    return (
      <QueryClientProvider client={queryClient}>
        <OnboardingWizard onComplete={() => {
          // Reload from storage to update the onboarding status
          providerAuthStore.loadFromStorage()
        }} />
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Command Palette */}
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      {/* Deployment Notification */}
      <DeploymentNotification />

      {/* iOS Deploy Modals - at app level so they survive navigation */}
      <IOSDeployModals />

      {/* Global Toast Notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--bfloat-bg-secondary, #1c1c2e)',
            color: 'var(--bfloat-text-primary, #e0e0f0)',
            border: '1px solid var(--bfloat-border, #2a2a40)',
            borderRadius: '8px',
            fontSize: '13px',
          },
          error: {
            duration: 6000,
            iconTheme: {
              primary: '#ef4444',
              secondary: 'var(--bfloat-bg-secondary, #1c1c2e)',
            },
          },
          success: {
            duration: 4000,
            iconTheme: {
              primary: '#22c55e',
              secondary: 'var(--bfloat-bg-secondary, #1c1c2e)',
            },
          },
        }}
      />
    </QueryClientProvider>
  )
}
