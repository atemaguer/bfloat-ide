import type { Project } from '@/app/types/project'
import StripeLogo from '@/app/components/ui/icons/stripe-logo'
import RevenueCatLogo from '@/app/components/ui/icons/revenuecat-logo'
import { workbenchStore, type PendingIntegrationId } from '@/app/stores/workbench'
import { CheckCircle2 } from 'lucide-react'

interface PaymentsOverviewProps {
  project: Project
  isConnected: boolean
}

export function PaymentsOverview({ project, isConnected }: PaymentsOverviewProps) {
  const isWeb = project.appType === 'nextjs' || project.appType === 'vite' || project.appType === 'web'
  const integrationId: PendingIntegrationId = isWeb ? 'stripe' : 'revenuecat'
  const title = isWeb ? 'Connect Stripe' : 'Connect RevenueCat'
  const description = isConnected
    ? isWeb
      ? 'Stripe credentials are configured for this project.'
      : 'RevenueCat credentials are configured for this project.'
    : isWeb
      ? 'Connect your Stripe account to accept payments and manage transactions for your web app.'
      : 'Connect your RevenueCat account to manage in-app purchases and subscriptions for your mobile app.'
  const learnMoreHref = isWeb ? 'https://stripe.com/docs' : 'https://www.revenuecat.com/docs'

  const handleConnect = () => {
    workbenchStore.setActiveTab('settings')
    workbenchStore.setPendingIntegrationConnect({
      integrationId,
      source: 'workbench',
    })
  }

  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="w-full max-w-[560px]">
        <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full bg-[#0055ff1f] dark:bg-[#0055ff24]">
          {isWeb ? (
            <StripeLogo width="34" height="34" />
          ) : (
            <RevenueCatLogo width="34" height="34" />
          )}
        </div>
        <h2 className="mb-3 text-[43px] font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mx-auto mb-8 max-w-[640px] text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {isConnected ? (
          <div className="mx-auto mb-6 flex h-10 w-full items-center justify-center gap-3 rounded-lg bg-emerald-100 px-4 text-sm font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 size={18} />
            <span>{`${isWeb ? 'Stripe' : 'RevenueCat'} Connected`}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            className="mx-auto mb-6 flex h-10 w-full items-center justify-center gap-3 rounded-lg bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            {isWeb ? (
              <StripeLogo width="18" height="18" />
            ) : (
              <RevenueCatLogo width="18" height="18" />
            )}
            <span>{title}</span>
          </button>
        )}
        <a
          href={learnMoreHref}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 transition hover:text-foreground"
        >
          Learn more about {isWeb ? 'Stripe' : 'RevenueCat'}
        </a>
      </div>
    </div>
  )
}
