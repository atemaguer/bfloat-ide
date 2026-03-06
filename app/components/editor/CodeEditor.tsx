import { useEffect, useRef, useCallback } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { themeStore } from '@/app/stores/theme'

// Custom dark theme matching the terminal aesthetic
const refinedDarkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#141414',
    color: '#b8b8b8',
    fontSize: '13px',
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", "Monaco", "Consolas", monospace',
  },
  '.cm-content': {
    caretColor: '#e0e0e0',
    padding: '8px 0',
    lineHeight: '1.5',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#e0e0e0',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#e0e0e0',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  '.cm-gutters': {
    backgroundColor: '#141414',
    color: '#4a4a4a',
    border: 'none',
    paddingRight: '8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    color: '#6a6a6a',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '32px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    color: '#4a4a4a',
    transition: 'color 150ms ease',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: '#8a8a8a',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    outline: '1px solid rgba(255, 255, 255, 0.2)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  // Scrollbar styling
  '.cm-scroller::-webkit-scrollbar': {
    width: '6px',
    height: '6px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: 'rgba(255, 255, 255, 0.08)',
    borderRadius: '3px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: 'rgba(255, 255, 255, 0.15)',
  },
}, { dark: true })

// Custom light theme
const refinedLightTheme = EditorView.theme({
  '&': {
    backgroundColor: '#fafafa',
    color: '#383a42',
    fontSize: '13px',
    fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", "Monaco", "Consolas", monospace',
  },
  '.cm-content': {
    caretColor: '#526eff',
    padding: '8px 0',
    lineHeight: '1.5',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#526eff',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#526eff',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
  },
  '.cm-gutters': {
    backgroundColor: '#fafafa',
    color: '#b0b0b0',
    border: 'none',
    paddingRight: '8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    color: '#8a8a8a',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '32px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    color: '#b0b0b0',
    transition: 'color 150ms ease',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: '#6a6a6a',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    outline: '1px solid rgba(0, 0, 0, 0.15)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '6px',
    height: '6px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: 'rgba(0, 0, 0, 0.1)',
    borderRadius: '3px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: 'rgba(0, 0, 0, 0.18)',
  },
}, { dark: false })

// Dark syntax highlighting matching terminal colors
const refinedDarkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c099e0' },           // Muted magenta
  { tag: tags.operator, color: '#b8b8b8' },          // Muted foreground
  { tag: tags.special(tags.variableName), color: '#e06c75' }, // Muted red
  { tag: tags.typeName, color: '#e5c07b' },          // Warm yellow
  { tag: tags.atom, color: '#d19a66' },              // Orange
  { tag: tags.number, color: '#d19a66' },            // Orange
  { tag: tags.definition(tags.variableName), color: '#7ab3ef' }, // Muted blue
  { tag: tags.string, color: '#7ec699' },            // Muted green
  { tag: tags.special(tags.string), color: '#7ec699' },
  { tag: tags.comment, color: '#5c6370', fontStyle: 'italic' }, // Muted gray
  { tag: tags.variableName, color: '#b8b8b8' },      // Muted foreground
  { tag: tags.function(tags.variableName), color: '#7ab3ef' }, // Muted blue
  { tag: tags.labelName, color: '#e06c75' },         // Muted red
  { tag: tags.propertyName, color: '#e06c75' },      // Muted red
  { tag: tags.attributeName, color: '#d19a66' },     // Orange
  { tag: tags.className, color: '#e5c07b' },         // Warm yellow
  { tag: tags.tagName, color: '#e06c75' },           // Muted red (for JSX/HTML)
  { tag: tags.angleBracket, color: '#5c6370' },      // Muted gray
  { tag: tags.bracket, color: '#b8b8b8' },           // Muted foreground
  { tag: tags.punctuation, color: '#8a8a8a' },       // Slightly muted
  { tag: tags.meta, color: '#5c6370' },              // Muted gray
  { tag: tags.link, color: '#7ab3ef', textDecoration: 'underline' },
  { tag: tags.heading, color: '#e06c75', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.bool, color: '#d19a66' },              // Orange
  { tag: tags.null, color: '#d19a66' },              // Orange
  { tag: tags.self, color: '#e06c75' },              // Muted red
  { tag: tags.regexp, color: '#7ec699' },            // Muted green
])

// Light syntax highlighting (One Light-inspired)
const refinedLightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#a626a4' },           // Purple
  { tag: tags.operator, color: '#383a42' },          // Foreground
  { tag: tags.special(tags.variableName), color: '#e45649' }, // Red
  { tag: tags.typeName, color: '#c18401' },          // Yellow/amber
  { tag: tags.atom, color: '#986801' },              // Dark orange
  { tag: tags.number, color: '#986801' },            // Dark orange
  { tag: tags.definition(tags.variableName), color: '#4078f2' }, // Blue
  { tag: tags.string, color: '#50a14f' },            // Green
  { tag: tags.special(tags.string), color: '#50a14f' },
  { tag: tags.comment, color: '#a0a1a7', fontStyle: 'italic' }, // Gray
  { tag: tags.variableName, color: '#383a42' },      // Foreground
  { tag: tags.function(tags.variableName), color: '#4078f2' }, // Blue
  { tag: tags.labelName, color: '#e45649' },         // Red
  { tag: tags.propertyName, color: '#e45649' },      // Red
  { tag: tags.attributeName, color: '#986801' },     // Dark orange
  { tag: tags.className, color: '#c18401' },         // Yellow/amber
  { tag: tags.tagName, color: '#e45649' },           // Red (for JSX/HTML)
  { tag: tags.angleBracket, color: '#a0a1a7' },     // Gray
  { tag: tags.bracket, color: '#383a42' },           // Foreground
  { tag: tags.punctuation, color: '#696c77' },       // Slightly muted
  { tag: tags.meta, color: '#a0a1a7' },             // Gray
  { tag: tags.link, color: '#4078f2', textDecoration: 'underline' },
  { tag: tags.heading, color: '#e45649', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.bool, color: '#986801' },              // Dark orange
  { tag: tags.null, color: '#986801' },              // Dark orange
  { tag: tags.self, color: '#e45649' },              // Red
  { tag: tags.regexp, color: '#50a14f' },            // Green
])

// Helper to get theme extensions for a given resolved theme
function getEditorThemeExtensions(resolvedTheme: 'light' | 'dark') {
  if (resolvedTheme === 'dark') {
    return [refinedDarkTheme, syntaxHighlighting(refinedDarkHighlightStyle)]
  }
  return [refinedLightTheme, syntaxHighlighting(refinedLightHighlightStyle)]
}

interface CodeEditorProps {
  value: string
  language?: string
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
}

function getLanguageExtension(language?: string) {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return javascript({ jsx: true, typescript: language?.includes('typescript') })
    case 'json':
      return json()
    case 'css':
      return css()
    default:
      return javascript({ jsx: true })
  }
}

export function CodeEditor({ value, language, onChange, onSave, readOnly = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isUserChangeRef = useRef(false)
  const themeCompartmentRef = useRef(new Compartment())
  const hasThemeCompartmentRef = useRef(false)

  const handleSave = useCallback(() => {
    onSave?.()
  }, [onSave])

  // Initialize editor once
  useEffect(() => {
    if (!containerRef.current) return

    const themeCompartment = themeCompartmentRef.current
    hasThemeCompartmentRef.current = false

    // Create save keymap
    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSave()
          return true
        },
      },
    ])

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        isUserChangeRef.current = true
        onChange(update.state.doc.toString())
      }
    })

    let view: EditorView
    try {
      const startState = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          bracketMatching(),
          themeCompartment.of(getEditorThemeExtensions(themeStore.resolvedTheme.getState())),
          getLanguageExtension(language),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          saveKeymap,
          EditorState.readOnly.of(readOnly),
          updateListener,
        ],
      })

      view = new EditorView({
        state: startState,
        parent: containerRef.current,
      })
      hasThemeCompartmentRef.current = true
    } catch (error) {
      // Guard against runtime extension-set incompatibilities so the project page
      // remains usable even when a dependency mismatch occurs.
      console.error('[CodeEditor] Failed to initialize full editor extensions, falling back to minimal mode:', error)
      const fallbackState = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          keymap.of(defaultKeymap),
          saveKeymap,
          EditorState.readOnly.of(readOnly),
          updateListener,
        ],
      })
      view = new EditorView({
        state: fallbackState,
        parent: containerRef.current,
      })
    }

    viewRef.current = view

    // Subscribe to theme changes
    const unsubTheme = themeStore.resolvedTheme.subscribe((resolved) => {
      if (viewRef.current && hasThemeCompartmentRef.current) {
        viewRef.current.dispatch({
          effects: themeCompartment.reconfigure(getEditorThemeExtensions(resolved)),
        })
      }
    })

    return () => {
      unsubTheme()
      view.destroy()
      viewRef.current = null
    }
  }, [language, readOnly, handleSave]) // Removed value, onChange from dependencies

  // Update editor content when value prop changes externally (not from user typing)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Skip update if this change came from the user typing
    if (isUserChangeRef.current) {
      isUserChangeRef.current = false
      return
    }

    // Update content only if it differs from current editor content
    const currentContent = view.state.doc.toString()
    if (currentContent !== value) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: value }
      })
    }
  }, [value])

  return <div ref={containerRef} className="code-editor" />
}
