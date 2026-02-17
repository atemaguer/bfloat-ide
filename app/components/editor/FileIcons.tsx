import { File, FileText, FileCode, FileJson, Settings, Image, FileType } from 'lucide-react'

// File extension to icon mapping with colors
const FILE_ICONS: Record<string, { icon: typeof File; color: string }> = {
  // TypeScript/JavaScript
  tsx: { icon: Settings, color: '#3b82f6' }, // Blue gear for React components
  jsx: { icon: Settings, color: '#3b82f6' },
  ts: { icon: FileCode, color: '#3178c6' }, // TypeScript blue
  js: { icon: FileCode, color: '#f7df1e' }, // JavaScript yellow
  mjs: { icon: FileCode, color: '#f7df1e' },
  cjs: { icon: FileCode, color: '#f7df1e' },

  // Config files
  json: { icon: FileJson, color: '#cbcb41' }, // Yellow for JSON

  // Styles
  css: { icon: FileText, color: '#563d7c' }, // CSS purple
  scss: { icon: FileText, color: '#c6538c' },
  sass: { icon: FileText, color: '#c6538c' },
  less: { icon: FileText, color: '#1d365d' },

  // Markup
  html: { icon: FileCode, color: '#e34c26' },
  htm: { icon: FileCode, color: '#e34c26' },
  xml: { icon: FileCode, color: '#e34c26' },
  svg: { icon: Image, color: '#ffb13b' },

  // Images
  png: { icon: Image, color: '#a074c4' },
  jpg: { icon: Image, color: '#a074c4' },
  jpeg: { icon: Image, color: '#a074c4' },
  gif: { icon: Image, color: '#a074c4' },
  webp: { icon: Image, color: '#a074c4' },
  ico: { icon: Image, color: '#a074c4' },

  // Documentation
  md: { icon: FileText, color: '#519aba' }, // Markdown blue
  mdx: { icon: FileText, color: '#519aba' },
  txt: { icon: FileText, color: '#9a9a9a' },

  // Lock files
  lock: { icon: FileJson, color: '#cbcb41' },

  // Environment
  env: { icon: Settings, color: '#ecd53f' },

  // Git
  gitignore: { icon: File, color: '#f14e32' }, // Git orange/red

  // Default
  default: { icon: File, color: '#9a9a9a' },
}

// Special filenames that override extension-based icons
const SPECIAL_FILES: Record<string, { icon: typeof File; color: string }> = {
  'package.json': { icon: FileJson, color: '#cbcb41' },
  'tsconfig.json': { icon: FileCode, color: '#3178c6' },
  'next.config.ts': { icon: FileCode, color: '#3178c6' },
  'next.config.js': { icon: FileCode, color: '#f7df1e' },
  'next.config.mjs': { icon: FileCode, color: '#f7df1e' },
  'next-env.d.ts': { icon: FileCode, color: '#3178c6' },
  'eslint.config.mjs': { icon: FileCode, color: '#4b32c3' },
  'eslint.config.js': { icon: FileCode, color: '#4b32c3' },
  '.eslintrc': { icon: FileCode, color: '#4b32c3' },
  '.eslintrc.js': { icon: FileCode, color: '#4b32c3' },
  '.eslintrc.json': { icon: FileCode, color: '#4b32c3' },
  'postcss.config.js': { icon: FileCode, color: '#dd3a0a' },
  'postcss.config.mjs': { icon: FileCode, color: '#dd3a0a' },
  'tailwind.config.js': { icon: FileCode, color: '#38bdf8' },
  'tailwind.config.ts': { icon: FileCode, color: '#38bdf8' },
  'vite.config.ts': { icon: FileCode, color: '#646cff' },
  'vite.config.js': { icon: FileCode, color: '#646cff' },
  '.gitignore': { icon: File, color: '#f14e32' },
  'README.md': { icon: FileText, color: '#519aba' },
  'LICENSE': { icon: FileText, color: '#d4af37' },
  'bun.lock': { icon: FileJson, color: '#fbf0df' },
  'bun.lockb': { icon: FileJson, color: '#fbf0df' },
  'yarn.lock': { icon: FileJson, color: '#2c8ebb' },
  'package-lock.json': { icon: FileJson, color: '#cb3837' },
  'components.json': { icon: FileJson, color: '#cbcb41' },
}

export function getFileIcon(fileName: string): { Icon: typeof File; color: string } {
  // Check special filenames first
  if (SPECIAL_FILES[fileName]) {
    return { Icon: SPECIAL_FILES[fileName].icon, color: SPECIAL_FILES[fileName].color }
  }

  // Get extension
  const ext = fileName.split('.').pop()?.toLowerCase() || ''

  // Handle dotfiles (like .gitignore)
  if (fileName.startsWith('.') && !ext) {
    const dotfileExt = fileName.slice(1).toLowerCase()
    if (FILE_ICONS[dotfileExt]) {
      return { Icon: FILE_ICONS[dotfileExt].icon, color: FILE_ICONS[dotfileExt].color }
    }
  }

  // Get icon by extension
  const iconConfig = FILE_ICONS[ext] || FILE_ICONS.default
  return { Icon: iconConfig.icon, color: iconConfig.color }
}

interface FileIconProps {
  fileName: string
  size?: number
  className?: string
}

export function FileIcon({ fileName, size = 14, className }: FileIconProps) {
  const { Icon, color } = getFileIcon(fileName)
  return <Icon size={size} style={{ color }} className={className} />
}
