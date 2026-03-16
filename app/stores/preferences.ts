import { createStore } from 'zustand/vanilla'

export type ProjectListView = 'grid' | 'list'
export type EditorFontSize = '12' | '13' | '14' | '15' | '16' | '18'

const DEFAULT_EDITOR_FONT_SIZE: EditorFontSize = '14'
const DEFAULT_SHOW_LINE_NUMBERS = true
const DEFAULT_WORD_WRAP = false
const DEFAULT_FORMAT_ON_SAVE = true
const DEFAULT_AUTO_SAVE = true

function getStoredProjectListView(): ProjectListView {
  try {
    const stored = localStorage.getItem('home_project_list_view')
    if (stored === 'grid' || stored === 'list') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return 'grid'
}

function getStoredEditorFontSize(): EditorFontSize {
  try {
    const stored = localStorage.getItem('editor_font_size')
    if (stored === '12' || stored === '13' || stored === '14' || stored === '15' || stored === '16' || stored === '18') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_EDITOR_FONT_SIZE
}

function getStoredShowLineNumbers(): boolean {
  try {
    const stored = localStorage.getItem('editor_show_line_numbers')
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_SHOW_LINE_NUMBERS
}

function getStoredWordWrap(): boolean {
  try {
    const stored = localStorage.getItem('editor_word_wrap')
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_WORD_WRAP
}

function getStoredFormatOnSave(): boolean {
  try {
    const stored = localStorage.getItem('editor_format_on_save')
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_FORMAT_ON_SAVE
}

function getStoredAutoSave(): boolean {
  try {
    const stored = localStorage.getItem('editor_auto_save')
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_AUTO_SAVE
}

class PreferencesStore {
  projectListView = createStore<ProjectListView>(() => getStoredProjectListView())
  editorFontSize = createStore<EditorFontSize>(() => getStoredEditorFontSize())
  showLineNumbers = createStore<boolean>(() => getStoredShowLineNumbers())
  wordWrap = createStore<boolean>(() => getStoredWordWrap())
  formatOnSave = createStore<boolean>(() => getStoredFormatOnSave())
  autoSave = createStore<boolean>(() => getStoredAutoSave())

  constructor() {
    this.projectListView.subscribe((view) => {
      try {
        localStorage.setItem('home_project_list_view', view)
      } catch {
        // localStorage unavailable
      }
    })

    this.editorFontSize.subscribe((size) => {
      try {
        localStorage.setItem('editor_font_size', size)
      } catch {
        // localStorage unavailable
      }
    })

    this.showLineNumbers.subscribe((enabled) => {
      try {
        localStorage.setItem('editor_show_line_numbers', String(enabled))
      } catch {
        // localStorage unavailable
      }
    })

    this.wordWrap.subscribe((enabled) => {
      try {
        localStorage.setItem('editor_word_wrap', String(enabled))
      } catch {
        // localStorage unavailable
      }
    })

    this.formatOnSave.subscribe((enabled) => {
      try {
        localStorage.setItem('editor_format_on_save', String(enabled))
      } catch {
        // localStorage unavailable
      }
    })

    this.autoSave.subscribe((enabled) => {
      try {
        localStorage.setItem('editor_auto_save', String(enabled))
      } catch {
        // localStorage unavailable
      }
    })
  }

  setProjectListView = (view: ProjectListView) => {
    this.projectListView.setState(view, true)
  }

  setEditorFontSize = (size: EditorFontSize) => {
    this.editorFontSize.setState(size, true)
  }

  setShowLineNumbers = (enabled: boolean) => {
    this.showLineNumbers.setState(enabled, true)
  }

  setWordWrap = (enabled: boolean) => {
    this.wordWrap.setState(enabled, true)
  }

  setFormatOnSave = (enabled: boolean) => {
    this.formatOnSave.setState(enabled, true)
  }

  setAutoSave = (enabled: boolean) => {
    this.autoSave.setState(enabled, true)
  }
}

export const preferencesStore = new PreferencesStore()
