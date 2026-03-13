import { createStore } from 'zustand/vanilla'

export type ProjectListView = 'grid' | 'list'
export type EditorFontSize = '12' | '13' | '14' | '15' | '16' | '18'

const DEFAULT_EDITOR_FONT_SIZE: EditorFontSize = '14'

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

class PreferencesStore {
  projectListView = createStore<ProjectListView>(() => getStoredProjectListView())
  editorFontSize = createStore<EditorFontSize>(() => getStoredEditorFontSize())

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
  }

  setProjectListView = (view: ProjectListView) => {
    this.projectListView.setState(view, true)
  }

  setEditorFontSize = (size: EditorFontSize) => {
    this.editorFontSize.setState(size, true)
  }
}

export const preferencesStore = new PreferencesStore()
