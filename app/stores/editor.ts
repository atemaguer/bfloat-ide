import { createStore, type StoreApi } from 'zustand/vanilla'
import type { EditorDocument, FileMap } from '@/app/types/project'
import { FilesStore } from './files'

export interface EditorDocumentState {
  value: string
  isBinary: boolean
}

// Helper functions (outside class to be accessible by derived store)
function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.woff', '.woff2', '.ttf', '.eot']
  return binaryExtensions.some((ext) => filePath.toLowerCase().endsWith(ext))
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sh: 'shell',
    bash: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    sql: 'sql',
  }
  return languageMap[ext || ''] || 'plaintext'
}

export class EditorStore {
  #filesStore: FilesStore

  selectedFile = createStore<string | undefined>(() => undefined)
  documents = createStore<Record<string, EditorDocumentState>>(() => ({}))
  currentDocument: StoreApi<EditorDocument | undefined>

  constructor(filesStore: FilesStore) {
    this.#filesStore = filesStore

    // Create derived store initialized from current state
    this.currentDocument = createStore<EditorDocument | undefined>(() =>
      this.#deriveCurrentDocument()
    )

    // Subscribe to dependencies to update derived store
    this.selectedFile.subscribe(() => {
      this.currentDocument.setState(this.#deriveCurrentDocument(), true)
    })
    this.documents.subscribe(() => {
      this.currentDocument.setState(this.#deriveCurrentDocument(), true)
    })
  }

  #deriveCurrentDocument(): EditorDocument | undefined {
    const filePath = this.selectedFile.getState()
    if (!filePath) return undefined

    const docs = this.documents.getState()
    const doc = docs[filePath]
    if (!doc) return undefined

    return {
      filePath,
      value: doc.value,
      isBinary: doc.isBinary,
      language: getLanguageFromPath(filePath),
    }
  }

  setSelectedFile(filePath: string | undefined): void {
    this.selectedFile.setState(filePath, true)

    if (filePath) {
      const existingDoc = this.documents.getState()[filePath]
      if (!existingDoc) {
        const file = this.#filesStore.getFile(filePath)
        if (file) {
          const docs = this.documents.getState()
          this.documents.setState({
            ...docs,
            [filePath]: {
              value: file.content,
              // Use isBinary from file if available, otherwise detect by extension
              isBinary: file.isBinary ?? isBinaryFile(filePath),
            },
          }, true)
        }
      }
    }
  }

  setDocuments(files: FileMap | null): void {
    const docs: Record<string, EditorDocumentState> = {}

    if (files) {
      for (const [path, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          docs[path] = {
            value: dirent.content,
            // Use isBinary from file if available, otherwise detect by extension
            isBinary: dirent.isBinary ?? isBinaryFile(path),
          }
        }
      }
    }

    this.documents.setState(docs, true)
  }

  updateFile(filePath: string, value: string): void {
    const docs = this.documents.getState()
    const existingDoc = docs[filePath]

    this.documents.setState({
      ...docs,
      [filePath]: {
        value,
        isBinary: existingDoc?.isBinary ?? isBinaryFile(filePath),
      },
    }, true)
  }
}
