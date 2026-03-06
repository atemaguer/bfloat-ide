import { useState } from 'react'
import { ChevronUp, ChevronDown, UserRound } from 'lucide-react'

function GooglePlayIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
      <g clipPath="url(#gplay_clip)">
        <path d="M8.86457 8.64062L1.93457 15.8856C2.15957 16.6506 2.87957 17.2356 3.73457 17.2356C4.09457 17.2356 4.40957 17.1456 4.67957 16.9656L12.5096 12.5106L8.86457 8.64062Z" fill="#EA4335" />
        <path d="M15.885 7.37641L12.51 5.44141L8.72998 8.77141L12.555 12.5064L15.93 10.6164C16.515 10.3014 16.92 9.67141 16.92 8.99641C16.875 8.32141 16.47 7.69141 15.885 7.37641Z" fill="#FBBC04" />
        <path d="M1.93514 2.11719C1.89014 2.25219 1.89014 2.43219 1.89014 2.61219V15.4372C1.89014 15.6172 1.89014 15.7522 1.93514 15.9322L9.13514 8.86719L1.93514 2.11719Z" fill="#4285F4" />
        <path d="M8.90957 9.00062L12.5096 5.44563L4.72457 1.03562C4.45457 0.855625 4.09457 0.765625 3.73457 0.765625C2.87957 0.765625 2.11457 1.35062 1.93457 2.11562L8.90957 9.00062Z" fill="#34A853" />
      </g>
      <defs>
        <clipPath id="gplay_clip">
          <rect width="18" height="18" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}

export function DeployAndroidSection() {
  const [personalExpanded, setPersonalExpanded] = useState(true)
  const [playStoreExpanded, setPlayStoreExpanded] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {/* Personal Use & Limited Distribution */}
      <div className="flex flex-col gap-2">
        <button
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setPersonalExpanded(!personalExpanded)}
        >
          <div className="flex items-center gap-2">
            <div className="w-[18px] h-[18px] bg-blue-500 rounded flex items-center justify-center">
              <UserRound size={14} className="text-white" />
            </div>
            <span className="text-sm font-medium text-foreground">
              Personal Use & Limited Distribution
            </span>
          </div>
          {personalExpanded ? (
            <ChevronUp size={16} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground" />
          )}
        </button>

        {personalExpanded && (
          <div className="flex items-center justify-between ps-4 pe-3 py-3 border-0 bg-background rounded-[10px]">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-foreground">Version 1.0.0</span>
            </div>
            <button
              disabled
              className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium bg-foreground text-background rounded-[10px] opacity-50 cursor-not-allowed"
            >
              Build APK
            </button>
          </div>
        )}
      </div>

      {/* Publish to Google Play */}
      <div className="flex flex-col gap-2">
        <button
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setPlayStoreExpanded(!playStoreExpanded)}
        >
          <div className="flex items-center gap-2">
            <GooglePlayIcon />
            <span className="text-sm font-medium text-foreground">
              Publish to Google Play
            </span>
          </div>
          {playStoreExpanded ? (
            <ChevronUp size={16} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground" />
          )}
        </button>

        {playStoreExpanded && (
          <div className="ps-4 pe-3 py-3 border-0 bg-background rounded-[10px]">
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </div>
        )}
      </div>
    </div>
  )
}
