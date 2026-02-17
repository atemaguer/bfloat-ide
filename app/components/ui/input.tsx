import { forwardRef } from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => {
    const baseStyles = [
      'flex h-10 w-full rounded-lg',
      'bg-[hsl(var(--card))]',
      'border border-[hsl(var(--border))]',
      'px-3 py-2 text-sm',
      'text-[hsl(var(--foreground))]',
      'placeholder:text-[hsl(var(--muted-foreground))]',
      'transition-all duration-150',
      'focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-1 focus:ring-offset-[hsl(var(--background))]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      error ? 'border-[hsl(var(--destructive))] focus:ring-[hsl(var(--destructive))]' : '',
    ].filter(Boolean).join(' ')

    return (
      <div className="w-full">
        <input
          ref={ref}
          className={`${baseStyles} ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-xs text-[hsl(var(--destructive))]">{error}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { Input }

// Textarea component with similar styling
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', error, ...props }, ref) => {
    const baseStyles = [
      'flex min-h-[80px] w-full rounded-lg',
      'bg-[hsl(var(--card))]',
      'border border-[hsl(var(--border))]',
      'px-3 py-2 text-sm',
      'text-[hsl(var(--foreground))]',
      'placeholder:text-[hsl(var(--muted-foreground))]',
      'transition-all duration-150',
      'focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-1 focus:ring-offset-[hsl(var(--background))]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'resize-none',
      error ? 'border-[hsl(var(--destructive))] focus:ring-[hsl(var(--destructive))]' : '',
    ].filter(Boolean).join(' ')

    return (
      <div className="w-full">
        <textarea
          ref={ref}
          className={`${baseStyles} ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-xs text-[hsl(var(--destructive))]">{error}</p>
        )}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'

export { Textarea }
