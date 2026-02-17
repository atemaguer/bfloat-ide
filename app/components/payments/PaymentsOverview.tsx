import type { Project } from '@/app/types/project'

interface PaymentsOverviewProps {
  project: Project
}

export function PaymentsOverview({ project }: PaymentsOverviewProps) {
  const isWeb = project.appType === 'nextjs' || project.appType === 'vite' || project.appType === 'web'

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="text-muted-foreground space-y-4">
        <h3 className="text-lg font-medium text-foreground">
          {isWeb ? 'Stripe Payments' : 'RevenueCat In-App Purchases'}
        </h3>
        <p className="text-sm max-w-md">
          {isWeb
            ? 'Configure your Stripe credentials in Project Settings to enable payments.'
            : 'Configure your RevenueCat credentials in Project Settings to enable in-app purchases.'
          }
        </p>
        <p className="text-xs text-muted-foreground/70">
          Use the chat to ask the AI to help set up {isWeb ? 'Stripe' : 'RevenueCat'} integration.
        </p>
      </div>
    </div>
  )
}
