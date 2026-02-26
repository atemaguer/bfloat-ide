import type * as React from "react";
import { cn } from "@/lib/utils";
import { themeStore } from "@/app/stores/theme";
import { useStore } from "@/app/hooks/useStore";

interface IPhoneFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  /** Show status bar with time, signal, battery */
  showStatusBar?: boolean;
  /** Show home indicator at bottom */
  showHomeIndicator?: boolean;
  /** Frame color variant — matches iPhone 17 Pro Max finishes */
  variant?: 'silver' | 'deep-blue' | 'cosmic-orange';
}

/**
 * iPhone 17 Pro Max frame — Pure CSS/HTML.
 *
 * Real specs:
 *   Body:   78 × 163.4 mm  (aspect ≈ 1 : 2.095)
 *   Screen: 6.9″ OLED, 2868 × 1320 px @ 460 ppi
 *   Bezels: ~2.5 mm uniform
 *   Frame:  Aluminum unibody (first Pro w/ aluminum instead of titanium)
 *   S/B:    ~90.7 %
 *   Colors: Silver, Deep Blue, Cosmic Orange
 *
 * Uses CSS instead of SVG foreignObject so iframes render reliably
 * inside Electron / Tauri webviews.
 */
export function IPhoneFrame({
  children,
  className,
  showStatusBar = true,
  showHomeIndicator = true,
  variant = 'silver',
  ...props
}: IPhoneFrameProps) {
  const resolvedTheme = useStore(themeStore.resolvedTheme);
  const isDarkMode = resolvedTheme === 'dark';

  // ── Proportions (scaled from real mm) ──────────────────────────
  // We use a virtual canvas of 390 × 817 CSS-px so that the
  // aspect ratio matches the real 78 × 163.4 mm body exactly.
  //
  // Bezel: 2.5 mm ≈ 12.5 px at 5 px/mm scale
  // Corner radius: device corners ≈ 55 px, screen corners ≈ 44 px
  const borderRadius = 55;
  const bezelWidth = 5;          // very thin — 90.7% screen-to-body
  const screenRadius = borderRadius - bezelWidth - 2; // slightly inset

  // ── Colors ─────────────────────────────────────────────────────
  const frameColors: Record<string, {
    frame: string; bezel: string; accent: string; buttons: string;
    frameGrad: string;
  }> = {
    'silver': {
      frame: '#d4d4d4',
      bezel: '#0a0a0a',
      accent: '#ebebeb',
      buttons: '#c0c0c0',
      frameGrad: 'linear-gradient(135deg, #ebebeb 0%, #d4d4d4 40%, #b8b8b8 60%, #d4d4d4 100%)',
    },
    'deep-blue': {
      frame: '#2a3a5c',
      bezel: '#0a0a0a',
      accent: '#3d4f75',
      buttons: '#243252',
      frameGrad: 'linear-gradient(135deg, #3d4f75 0%, #2a3a5c 40%, #1e2d4a 60%, #2a3a5c 100%)',
    },
    'cosmic-orange': {
      frame: '#c4784a',
      bezel: '#0a0a0a',
      accent: '#d48b5e',
      buttons: '#b06a3f',
      frameGrad: 'linear-gradient(135deg, #d48b5e 0%, #c4784a 40%, #a86238 60%, #c4784a 100%)',
    },
  };

  const darkModeFrameOverrides: Partial<typeof frameColors> = {
    silver: {
      frame: '#6b6b6b',
      bezel: '#0a0a0a',
      accent: '#7a7a7a',
      buttons: '#5b5b5b',
      frameGrad: 'linear-gradient(135deg, #8b8b8b 0%, #6b6b6b 40%, #4f4f4f 60%, #6b6b6b 100%)',
    },
  };

  const baseColors = frameColors[variant] ?? frameColors['silver'];
  const colors = isDarkMode
    ? (darkModeFrameOverrides[variant] ?? baseColors)
    : baseColors;

  const frameShadow = isDarkMode
    ? `
      inset 0 0.5px 0 rgba(255,255,255,0.15),
      inset 0 -0.5px 0 rgba(0,0,0,0.30),
      0 0 0 0.5px rgba(0,0,0,0.55),
      0 2px 10px rgba(0,0,0,0.35),
      0 16px 56px rgba(0,0,0,0.45)
    `
    : `
      inset 0 0.5px 0 rgba(255,255,255,0.25),
      inset 0 -0.5px 0 rgba(0,0,0,0.15),
      0 0 0 0.5px rgba(0,0,0,0.4),
      0 2px 8px rgba(0,0,0,0.25),
      0 12px 48px rgba(0,0,0,0.35)
    `;

  // Current time for status bar
  const currentTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(' ', '');

  return (
    <div
      className={cn("relative mx-auto", className)}
      style={{
        height: '100%',
        maxHeight: '100%',
        // Real body ratio: 78 / 163.4 ≈ 0.4773
        aspectRatio: '78 / 163.4',
        maxWidth: 340,
        borderRadius,
        background: colors.frameGrad,
        padding: bezelWidth,
        // Aluminum unibody look — subtle brushed-metal sheen
        boxShadow: frameShadow,
      }}
      {...props}
    >
      {/* ── Side buttons (Right) ──────────────────────────────── */}

      {/* Camera Control — new capacitive button, lower-right */}
      <div
        style={{
          position: 'absolute',
          right: -2.5,
          bottom: '25%',
          width: 3,
          height: 22,
          borderRadius: 1.5,
          background: colors.buttons,
          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.3)',
        }}
      />

      {/* Power / Side button */}
      <div
        style={{
          position: 'absolute',
          right: -2.5,
          top: '22%',
          width: 3,
          height: 48,
          borderRadius: 1.5,
          background: `linear-gradient(90deg, ${colors.buttons}, ${colors.accent}, ${colors.buttons})`,
          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.3)',
        }}
      />

      {/* ── Side buttons (Left) ───────────────────────────────── */}

      {/* Action button */}
      <div
        style={{
          position: 'absolute',
          left: -2.5,
          top: '14%',
          width: 3,
          height: 22,
          borderRadius: 1.5,
          background: `linear-gradient(90deg, ${colors.buttons}, ${colors.accent}, ${colors.buttons})`,
          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.3)',
        }}
      />

      {/* Volume Up */}
      <div
        style={{
          position: 'absolute',
          left: -2.5,
          top: '20%',
          width: 3,
          height: 38,
          borderRadius: 1.5,
          background: `linear-gradient(90deg, ${colors.buttons}, ${colors.accent}, ${colors.buttons})`,
          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.3)',
        }}
      />

      {/* Volume Down */}
      <div
        style={{
          position: 'absolute',
          left: -2.5,
          top: '27%',
          width: 3,
          height: 38,
          borderRadius: 1.5,
          background: `linear-gradient(90deg, ${colors.buttons}, ${colors.accent}, ${colors.buttons})`,
          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.3)',
        }}
      />

      {/* ── Screen ────────────────────────────────────────────── */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: screenRadius,
          overflow: 'hidden',
          background: colors.bezel,
          boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.6)',
        }}
      >
        {/* Status Bar */}
        {showStatusBar && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 44,
              zIndex: 20,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              padding: '0 20px 4px',
              pointerEvents: 'none',
            }}
          >
            {/* Time */}
            <span
              style={{
                color: 'white',
                fontSize: 14,
                fontWeight: 600,
                fontFeatureSettings: '"tnum"',
                letterSpacing: '-0.02em',
              }}
            >
              {currentTime}
            </span>

            {/* Status icons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Cellular */}
              <svg width="16" height="11" viewBox="0 0 18 12" fill="white">
                <rect x="0" y="7" width="3" height="5" rx="0.5" fillOpacity="0.3" />
                <rect x="4" y="5" width="3" height="7" rx="0.5" fillOpacity="0.5" />
                <rect x="8" y="3" width="3" height="9" rx="0.5" />
                <rect x="12" y="0" width="3" height="12" rx="0.5" />
              </svg>
              {/* WiFi */}
              <svg width="15" height="11" viewBox="0 0 17 12" fill="white">
                <path d="M8.5 2.5C11.5 2.5 14 4 15.5 6L14 7.5C12.8 5.8 10.8 4.5 8.5 4.5C6.2 4.5 4.2 5.8 3 7.5L1.5 6C3 4 5.5 2.5 8.5 2.5Z" fillOpacity="0.3" />
                <path d="M8.5 5.5C10.3 5.5 11.9 6.3 13 7.5L11.5 9C10.7 8.1 9.7 7.5 8.5 7.5C7.3 7.5 6.3 8.1 5.5 9L4 7.5C5.1 6.3 6.7 5.5 8.5 5.5Z" fillOpacity="0.6" />
                <circle cx="8.5" cy="10.5" r="1.5" />
              </svg>
              {/* Battery */}
              <svg width="24" height="11" viewBox="0 0 27 12" fill="white">
                <rect x="0" y="0" width="23" height="12" rx="3" stroke="white" strokeOpacity="0.35" strokeWidth="1" fill="none" />
                <rect x="2" y="2" width="18" height="8" rx="1.5" />
                <rect x="24" y="3.5" width="2" height="5" rx="1" fillOpacity="0.4" />
              </svg>
            </div>
          </div>
        )}

        {/* Dynamic Island — same dimensions as iPhone 16 Pro Max */}
        {showStatusBar && (
          <div
            style={{
              position: 'absolute',
              top: '1.3%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '30%',
              height: '3.8%',
              borderRadius: 999,
              background: 'linear-gradient(180deg, #1a1a1a, #080808)',
              zIndex: 20,
              boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.04)',
            }}
          />
        )}

        {/* App content — padded to clear Dynamic Island + home indicator
             like iOS safe-area-inset-top / -bottom */}
        <div style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          paddingTop: showStatusBar ? '6%' : 0, // clears Dynamic Island when shown
          paddingBottom: showHomeIndicator ? '2.5%' : 0, // clears home indicator area when shown
          boxSizing: 'border-box',
        }}>
          {children}
        </div>

        {/* Home Indicator */}
        {showHomeIndicator && (
          <div
            style={{
              position: 'absolute',
              bottom: '0.8%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '35%',
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.8)',
              zIndex: 20,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Screen glass reflection */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: screenRadius,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 25%)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      </div>
    </div>
  );
}
