import { cn } from '@/lib/utils'

// Shared settings UI components

export function SettingsCard({
  title,
  children,
  danger = false,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        danger ? 'border-destructive/20 bg-destructive/5' : 'border-border'
      )}
    >
      {title && (
        <div className="border-b border-border px-5 py-4">
          {typeof title === 'string' ? (
            <h2
              className={cn(
                'text-xs font-medium uppercase tracking-wide',
                danger ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {title}
            </h2>
          ) : (
            <div
              className={cn(
                'text-xs font-medium uppercase tracking-wide',
                danger ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {title}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

export function SettingsRow({
  title,
  description,
  children,
  isLast = false,
}: {
  title: string
  description: string
  children: React.ReactNode
  isLast?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-5 py-4',
        !isLast && 'border-b border-border'
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </div>
      <div className="ml-4 flex-shrink-0">{children}</div>
    </div>
  )
}

export function SettingsFormGroup({
  label,
  hint,
  children,
  isLast = false,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  isLast?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 px-5 py-4',
        !isLast && 'border-b border-border'
      )}
    >
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function SettingsSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      className="min-w-[140px] cursor-pointer appearance-none rounded-md border border-border bg-muted px-3 py-2 pr-8 text-[13px] text-foreground transition-colors hover:border-muted-foreground/30 focus:border-muted-foreground/50 focus:outline-none"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

export function SettingsInput({
  value,
  readOnly = false,
  type = 'text',
  placeholder,
  className,
}: {
  value: string
  readOnly?: boolean
  type?: 'text' | 'email'
  placeholder?: string
  className?: string
}) {
  return (
    <input
      type={type}
      className={cn(
        'w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground',
        readOnly && 'opacity-60',
        className
      )}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
    />
  )
}
