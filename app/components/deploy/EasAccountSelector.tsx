/**
 * EAS Account Selector
 *
 * Dropdown component for selecting which Expo/EAS account to use for builds.
 * Shows personal and organization accounts parsed from `eas whoami`.
 */

import { useStore } from '@/app/hooks/useStore'
import { ChevronDown, User, Building2 } from 'lucide-react'
import { deployStore } from '@/app/stores/deploy'
import type { EasAccount } from '@/app/utils/eas-accounts'

interface EasAccountSelectorProps {
  disabled?: boolean
}

export function EasAccountSelector({ disabled = false }: EasAccountSelectorProps) {
  const accounts = useStore(deployStore.easAccounts)
  const selectedAccount = useStore(deployStore.selectedEasAccount)

  // Get current account details
  const currentAccount = accounts.find((a) => a.name === selectedAccount)

  if (accounts.length === 0) {
    return null
  }

  // If only one account, just show it (no dropdown needed)
  if (accounts.length === 1) {
    const account = accounts[0]
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AccountIcon account={account} />
        <span>{account.name}</span>
        <RoleBadge role={account.role} />
      </div>
    )
  }

  return (
    <div className="relative group">
      <button
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-2 text-sm border-0 rounded-lg bg-background hover:bg-[oklch(0.29_0_0)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed w-full"
      >
        {currentAccount ? (
          <>
            <AccountIcon account={currentAccount} />
            <span className="flex-1 text-left">{currentAccount.name}</span>
            <RoleBadge role={currentAccount.role} />
          </>
        ) : (
          <span className="text-muted-foreground flex-1 text-left">Select account</span>
        )}
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>

      {/* Dropdown menu */}
      {!disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[oklch(0.227_0_0)] border-0 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
          {accounts.map((account) => {
            const isSelected = account.name === selectedAccount

            return (
              <button
                key={account.name}
                onClick={() => deployStore.selectEasAccount(account.name)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[oklch(0.31_0_0)] transition-colors cursor-pointer first:rounded-t-lg last:rounded-b-lg ${
                  isSelected ? 'bg-[oklch(0.29_0_0)]' : ''
                }`}
              >
                <AccountIcon account={account} />
                <span className="flex-1 text-left">{account.name}</span>
                <RoleBadge role={account.role} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AccountIcon({ account }: { account: EasAccount }) {
  // Personal account = role is "owner", org account = any other role
  if (account.role === 'owner') {
    return <User size={14} className="text-muted-foreground flex-shrink-0" />
  }
  return <Building2 size={14} className="text-muted-foreground flex-shrink-0" />
}

function RoleBadge({ role }: { role: EasAccount['role'] }) {
  const roleLabels: Record<EasAccount['role'], string> = {
    owner: 'Personal',
    admin: 'Admin',
    developer: 'Developer',
    viewer: 'Viewer',
  }

  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
      {roleLabels[role] || role}
    </span>
  )
}
