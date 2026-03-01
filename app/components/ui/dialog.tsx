import * as React from 'react'
import { X } from 'lucide-react'

interface DialogContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined)

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export const Dialog: React.FC<DialogProps> = ({ open = false, onOpenChange, children }) => {
  // Fully controlled component - use `open` prop directly
  // Let the parent handle state changes via onOpenChange
  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    onOpenChange?.(newOpen)
  }, [onOpenChange])

  return (
    <DialogContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

const useDialogContext = () => {
  const context = React.useContext(DialogContext)
  if (!context) {
    throw new Error('Dialog components must be used within Dialog')
  }
  return context
}

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className = '', children, ...props }, ref) => {
    const { open, onOpenChange } = useDialogContext()

    if (!open) return null

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onOpenChange(false)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target === e.currentTarget) {
              onOpenChange(false)
            }
          }
        }}
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
          aria-hidden="true"
        />

        {/* Dialog */}
        <div
          ref={ref}
          className={`relative z-50 w-full max-w-md rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 ${className}`}
          {...props}
        >
          {children}
        </div>
      </div>
    )
  }
)

DialogContent.displayName = 'DialogContent'

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const DialogHeader: React.FC<DialogHeaderProps> = ({ className = '', children, ...props }) => {
  return (
    <div className={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`} {...props}>
      {children}
    </div>
  )
}

export interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode
}

export const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <h2
        ref={ref}
        className={`text-lg font-semibold leading-none tracking-tight text-[hsl(var(--foreground))] ${className}`}
        {...props}
      >
        {children}
      </h2>
    )
  }
)

DialogTitle.displayName = 'DialogTitle'

export interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode
}

export const DialogDescription = React.forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={`text-sm text-[hsl(var(--muted-foreground))] ${className}`}
        {...props}
      >
        {children}
      </p>
    )
  }
)

DialogDescription.displayName = 'DialogDescription'

export interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode
}

export const DialogClose = React.forwardRef<HTMLButtonElement, DialogCloseProps>(
  ({ className = '', children, ...props }, ref) => {
    const { onOpenChange } = useDialogContext()

    return (
      <button
        ref={ref}
        className={`absolute right-4 top-4 rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] transition-all hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:pointer-events-none ${className}`}
        onClick={() => onOpenChange(false)}
        {...props}
      >
        {children || <X className="h-4 w-4" />}
        <span className="sr-only">Close</span>
      </button>
    )
  }
)

DialogClose.displayName = 'DialogClose'

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const DialogFooter: React.FC<DialogFooterProps> = ({ className = '', children, ...props }) => {
  return (
    <div className={`flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6 ${className}`} {...props}>
      {children}
    </div>
  )
}
