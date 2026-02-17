import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Plus,
  Settings,
  Sparkles,
  ArrowRight,
  Command,
} from 'lucide-react'

interface CommandItem {
  id: string
  label: string
  icon: React.ElementType
  description?: string
  shortcut?: string
  action: () => void
  category: 'navigation' | 'actions'
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Build command items
  const navigationCommands: CommandItem[] = [
    {
      id: 'home',
      label: 'Go to Home',
      icon: Sparkles,
      shortcut: 'G H',
      action: () => {
        navigate('/')
        onOpenChange(false)
      },
      category: 'navigation',
    },
    {
      id: 'settings',
      label: 'Open Settings',
      icon: Settings,
      shortcut: '⌘ ,',
      action: () => {
        navigate('/settings')
        onOpenChange(false)
      },
      category: 'navigation',
    },
  ]

  const actionCommands: CommandItem[] = [
    {
      id: 'new-workspace',
      label: 'Create New Workspace',
      icon: Plus,
      shortcut: '⌘ N',
      action: () => {
        navigate('/')
        onOpenChange(false)
      },
      category: 'actions',
    },
  ]

  // Filter commands based on query
  const filterCommands = (commands: CommandItem[]) => {
    if (!query.trim()) return commands
    const lowerQuery = query.toLowerCase()
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lowerQuery) ||
        cmd.description?.toLowerCase().includes(lowerQuery)
    )
  }

  const filteredNavigation = filterCommands(navigationCommands)
  const filteredActions = filterCommands(actionCommands)

  const allFilteredCommands = [...filteredNavigation, ...filteredActions]

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, allFilteredCommands.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (allFilteredCommands[selectedIndex]) {
            allFilteredCommands[selectedIndex].action()
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    },
    [allFilteredCommands, selectedIndex, onOpenChange]
  )

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const renderCommandGroup = (title: string, commands: CommandItem[], startIndex: number) => {
    if (commands.length === 0) return null

    return (
      <div className="mb-2">
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </div>
        {commands.map((cmd, idx) => {
          const globalIndex = startIndex + idx
          const isSelected = globalIndex === selectedIndex

          return (
            <button
              key={cmd.id}
              data-index={globalIndex}
              className={`flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIndex(globalIndex)}
            >
              <cmd.icon size={18} className={isSelected ? 'text-primary' : ''} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{cmd.label}</div>
                {cmd.description && (
                  <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
                )}
              </div>
              {cmd.shortcut && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {cmd.shortcut.split(' ').map((key, i) => (
                    <kbd
                      key={i}
                      className="px-1.5 py-0.5 bg-secondary rounded text-[10px] font-mono"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              )}
              {isSelected && <ArrowRight size={14} className="text-primary" />}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[2000] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={20} className="text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search commands..."
                className="flex-1 bg-transparent text-foreground text-base outline-none placeholder:text-zinc-500"
              />
              <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 bg-secondary rounded text-xs text-muted-foreground">
                <Command size={12} />K
              </kbd>
            </div>

            {/* Command List */}
            <div ref={listRef} className="max-h-[400px] overflow-y-auto py-2">
              {allFilteredCommands.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Search size={32} className="mb-2 opacity-50" />
                  <p className="text-sm">No results found</p>
                </div>
              ) : (
                <>
                  {renderCommandGroup('Navigation', filteredNavigation, 0)}
                  {renderCommandGroup('Actions', filteredActions, filteredNavigation.length)}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-secondary/30">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-secondary rounded text-[10px]">↑↓</kbd>
                  Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-secondary rounded text-[10px]">↵</kbd>
                  Select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-secondary rounded text-[10px]">Esc</kbd>
                  Close
                </span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
