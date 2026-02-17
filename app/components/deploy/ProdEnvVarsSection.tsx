import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface ProdEnvVarsSectionProps {
  projectId: string | undefined
}

export function ProdEnvVarsSection({ projectId: _projectId }: ProdEnvVarsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="border border-border rounded-[10px] overflow-hidden">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-sm font-medium text-foreground">Production Variables</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <span className="text-xs text-muted-foreground">
              Production variables are managed locally via <code className="font-mono">.env.local</code>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
