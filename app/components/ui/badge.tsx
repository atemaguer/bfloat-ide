import * as React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'outline'
  size?: 'default' | 'sm' | 'lg'
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className = '', variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center gap-1 rounded-full font-medium transition-colors'

    const variants = {
      default: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
      primary: 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]',
      secondary: 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]',
      success: 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]',
      warning: 'bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]',
      danger: 'bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))]',
      outline: 'border border-[hsl(var(--border))] text-[hsl(var(--foreground))] bg-transparent',
    }

    const sizes = {
      sm: 'px-2 py-0.5 text-[10px]',
      default: 'px-2.5 py-0.5 text-xs',
      lg: 'px-3 py-1 text-sm',
    }

    return (
      <div
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        ref={ref}
        {...props}
      />
    )
  }
)

Badge.displayName = 'Badge'

export { Badge }
