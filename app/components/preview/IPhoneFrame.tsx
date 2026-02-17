import type * as React from "react";
import { cn } from "@/lib/utils";

interface IPhoneFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  /** Show status bar with time, signal, battery */
  showStatusBar?: boolean;
  /** Show home indicator at bottom */
  showHomeIndicator?: boolean;
  /** Frame color variant */
  variant?: 'black' | 'silver' | 'gold' | 'blue';
}

export function IPhoneFrame({
  children,
  className,
  showStatusBar = true,
  showHomeIndicator = true,
  variant = 'black',
  ...props
}: IPhoneFrameProps) {
  // iPhone 17 Pro Max dimensions
  // Larger display with thinner bezels and smaller Dynamic Island
  const frameWidth = 440;
  const frameHeight = 956;
  const borderRadius = 58;
  const bezelWidth = 8; // Thinner bezels on newer models
  const screenRadius = borderRadius - bezelWidth;

  // Dynamic Island dimensions (smaller on iPhone 17 Pro Max)
  const dynamicIslandWidth = 120;
  const dynamicIslandHeight = 34;
  const dynamicIslandY = 18;

  // Frame colors based on variant
  const frameColors = {
    black: {
      frame: '#1a1a1a',
      bezel: '#0d0d0d',
      accent: '#2a2a2a',
      buttons: '#1f1f1f',
    },
    silver: {
      frame: '#e3e3e3',
      bezel: '#1a1a1a',
      accent: '#f5f5f5',
      buttons: '#d0d0d0',
    },
    gold: {
      frame: '#f5e6d3',
      bezel: '#1a1a1a',
      accent: '#faf3eb',
      buttons: '#e6d4be',
    },
    blue: {
      frame: '#394867',
      bezel: '#1a1a1a',
      accent: '#4a5d82',
      buttons: '#2f3d54',
    },
  };

  const colors = frameColors[variant];

  // Current time for status bar
  const currentTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).replace(' ', '');

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[440px]",
        "drop-shadow-2xl",
        className
      )}
      style={{ aspectRatio: `${frameWidth / frameHeight}` }}
      {...props}
    >
      <svg
        viewBox={`0 0 ${frameWidth} ${frameHeight}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Metallic frame gradient */}
          <linearGradient id="frameGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.accent} />
            <stop offset="50%" stopColor={colors.frame} />
            <stop offset="100%" stopColor={colors.accent} />
          </linearGradient>

          {/* Side highlight for 3D effect */}
          <linearGradient id="sideHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.05)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
          </linearGradient>

          {/* Button gradient */}
          <linearGradient id="buttonGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colors.buttons} />
            <stop offset="50%" stopColor={colors.accent} />
            <stop offset="100%" stopColor={colors.buttons} />
          </linearGradient>

          {/* Screen glass reflection */}
          <linearGradient id="screenReflection" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="30%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>

          {/* Dynamic Island gradient */}
          <linearGradient id="dynamicIslandGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#0a0a0a" />
          </linearGradient>

          {/* Clip path for rounded screen */}
          <clipPath id="screenClip">
            <rect
              x={bezelWidth}
              y={bezelWidth}
              width={frameWidth - bezelWidth * 2}
              height={frameHeight - bezelWidth * 2}
              rx={screenRadius}
              ry={screenRadius}
            />
          </clipPath>
        </defs>

        {/* Outer frame shadow */}
        <rect
          x="2"
          y="4"
          width={frameWidth - 4}
          height={frameHeight - 4}
          rx={borderRadius}
          ry={borderRadius}
          fill="rgba(0,0,0,0.3)"
          filter="blur(8px)"
        />

        {/* Main frame body */}
        <rect
          x="0"
          y="0"
          width={frameWidth}
          height={frameHeight}
          rx={borderRadius}
          ry={borderRadius}
          fill="url(#frameGradient)"
        />

        {/* Frame highlight overlay */}
        <rect
          x="0"
          y="0"
          width={frameWidth}
          height={frameHeight}
          rx={borderRadius}
          ry={borderRadius}
          fill="url(#sideHighlight)"
        />

        {/* Inner bezel (camera ring simulation) */}
        <rect
          x={bezelWidth - 1}
          y={bezelWidth - 1}
          width={frameWidth - (bezelWidth - 1) * 2}
          height={frameHeight - (bezelWidth - 1) * 2}
          rx={screenRadius + 1}
          ry={screenRadius + 1}
          fill="none"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1"
        />

        {/* Screen background (black for OLED effect) */}
        <rect
          x={bezelWidth}
          y={bezelWidth}
          width={frameWidth - bezelWidth * 2}
          height={frameHeight - bezelWidth * 2}
          rx={screenRadius}
          ry={screenRadius}
          fill={colors.bezel}
        />

        {/* Side buttons - Right side (Power/Action) */}
        {/* Action button (iPhone 15 Pro) */}
        <rect
          x={frameWidth - 3}
          y="170"
          width="6"
          height="35"
          rx="2"
          fill="url(#buttonGradient)"
        />
        {/* Power button */}
        <rect
          x={frameWidth - 3}
          y="220"
          width="6"
          height="70"
          rx="2"
          fill="url(#buttonGradient)"
        />

        {/* Side buttons - Left side */}
        {/* Silent switch */}
        <rect
          x="-3"
          y="145"
          width="6"
          height="30"
          rx="2"
          fill="url(#buttonGradient)"
        />
        {/* Volume Up */}
        <rect
          x="-3"
          y="195"
          width="6"
          height="55"
          rx="2"
          fill="url(#buttonGradient)"
        />
        {/* Volume Down */}
        <rect
          x="-3"
          y="265"
          width="6"
          height="55"
          rx="2"
          fill="url(#buttonGradient)"
        />

        {/* Content area with clip */}
        <g clipPath="url(#screenClip)">
          {/* Content will be rendered via foreignObject */}
          <foreignObject
            x={bezelWidth}
            y={bezelWidth}
            width={frameWidth - bezelWidth * 2}
            height={frameHeight - bezelWidth * 2}
          >
            <div
              className="w-full h-full overflow-hidden bg-black"
              style={{ borderRadius: `${screenRadius}px` }}
            >
              {/* Status Bar */}
              {showStatusBar && (
                <div className="absolute top-0 left-0 right-0 z-20 h-[54px] flex items-end justify-between px-8 pb-2 pointer-events-none">
                  {/* Left: Time */}
                  <span className="text-white text-[15px] font-semibold tracking-tight">
                    {currentTime}
                  </span>

                  {/* Right: Icons */}
                  <div className="flex items-center gap-[5px]">
                    {/* Cellular */}
                    <svg width="18" height="12" viewBox="0 0 18 12" fill="white">
                      <rect x="0" y="7" width="3" height="5" rx="0.5" fillOpacity="0.3"/>
                      <rect x="4" y="5" width="3" height="7" rx="0.5" fillOpacity="0.3"/>
                      <rect x="8" y="3" width="3" height="9" rx="0.5" fillOpacity="1"/>
                      <rect x="12" y="0" width="3" height="12" rx="0.5" fillOpacity="1"/>
                    </svg>
                    {/* WiFi */}
                    <svg width="17" height="12" viewBox="0 0 17 12" fill="white">
                      <path d="M8.5 2.5C11.5 2.5 14 4 15.5 6L14 7.5C12.8 5.8 10.8 4.5 8.5 4.5C6.2 4.5 4.2 5.8 3 7.5L1.5 6C3 4 5.5 2.5 8.5 2.5Z" fillOpacity="0.3"/>
                      <path d="M8.5 5.5C10.3 5.5 11.9 6.3 13 7.5L11.5 9C10.7 8.1 9.7 7.5 8.5 7.5C7.3 7.5 6.3 8.1 5.5 9L4 7.5C5.1 6.3 6.7 5.5 8.5 5.5Z" fillOpacity="0.6"/>
                      <circle cx="8.5" cy="10.5" r="1.5" fillOpacity="1"/>
                    </svg>
                    {/* Battery */}
                    <svg width="27" height="12" viewBox="0 0 27 12" fill="white">
                      <rect x="0" y="0" width="23" height="12" rx="3" stroke="white" strokeOpacity="0.35" strokeWidth="1" fill="none"/>
                      <rect x="2" y="2" width="18" height="8" rx="1.5" fill="white"/>
                      <rect x="24" y="3.5" width="2" height="5" rx="1" fill="white" fillOpacity="0.4"/>
                    </svg>
                  </div>
                </div>
              )}

              {/* App content */}
              <div className="w-full h-full">
                {children}
              </div>

              {/* Home Indicator */}
              {showHomeIndicator && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                  <div className="w-[134px] h-[5px] bg-white/80 rounded-full" />
                </div>
              )}
            </div>
          </foreignObject>

          {/* Dynamic Island */}
          <rect
            x={(frameWidth - dynamicIslandWidth) / 2}
            y={dynamicIslandY}
            width={dynamicIslandWidth}
            height={dynamicIslandHeight}
            rx={dynamicIslandHeight / 2}
            ry={dynamicIslandHeight / 2}
            fill="url(#dynamicIslandGradient)"
          />

          {/* Dynamic Island inner shadow */}
          <rect
            x={(frameWidth - dynamicIslandWidth) / 2 + 1}
            y={dynamicIslandY + 1}
            width={dynamicIslandWidth - 2}
            height={dynamicIslandHeight - 2}
            rx={(dynamicIslandHeight - 2) / 2}
            ry={(dynamicIslandHeight - 2) / 2}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />

          {/* Screen reflection overlay */}
          <rect
            x={bezelWidth}
            y={bezelWidth}
            width={frameWidth - bezelWidth * 2}
            height={frameHeight - bezelWidth * 2}
            rx={screenRadius}
            ry={screenRadius}
            fill="url(#screenReflection)"
            pointerEvents="none"
          />
        </g>

        {/* Frame edge highlight (top) */}
        <path
          d={`M ${borderRadius} 0.5
              L ${frameWidth - borderRadius} 0.5
              Q ${frameWidth - 5} 0.5 ${frameWidth - 0.5} ${borderRadius}`}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
          fill="none"
        />
      </svg>
    </div>
  );
}
