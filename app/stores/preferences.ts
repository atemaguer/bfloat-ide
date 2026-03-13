import { createStore } from 'zustand/vanilla'

export type ProjectListView = 'grid' | 'list'

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

class PreferencesStore {
  projectListView = createStore<ProjectListView>(() => getStoredProjectListView())

  constructor() {
    this.projectListView.subscribe((view) => {
      try {
        localStorage.setItem('home_project_list_view', view)
      } catch {
        // localStorage unavailable
      }
    })
  }

  setProjectListView = (view: ProjectListView) => {
    this.projectListView.setState(view, true)
  }
}

export const preferencesStore = new PreferencesStore()
