import { atom, map, computed, type ReadableAtom } from 'nanostores'
import type { EditorDocument, FileMap } from '@/app/types/project'
import { FilesStore } from './files'

export interface EditorDocumentState {
  value: string
  isBinary: boolean
}

// Helper functions (outside class to be accessible by computed)
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

  selectedFile = atom<string | undefined>(undefined)
  documents = map<Record<string, EditorDocumentState>>({})
  currentDocument: ReadableAtom<EditorDocument | undefined>

  constructor(filesStore: FilesStore) {
    this.#filesStore = filesStore
    
    // Create computed atom in constructor
    this.currentDocument = computed(
      [this.selectedFile, this.documents],
      (filePath, docs): EditorDocument | undefined => {
        if (!filePath) return undefined

        const doc = docs[filePath]
        if (!doc) return undefined

        return {
          filePath,
          value: doc.value,
          isBinary: doc.isBinary,
          language: getLanguageFromPath(filePath),
        }
      }
    )
  }

  setSelectedFile(filePath: string | undefined): void {
    this.selectedFile.set(filePath)

    if (filePath) {
      const existingDoc = this.documents.get()[filePath]
      if (!existingDoc) {
        const file = this.#filesStore.getFile(filePath)
        if (file) {
          this.documents.setKey(filePath, {
            value: file.content,
            // Use isBinary from file if available, otherwise detect by extension
            isBinary: file.isBinary ?? isBinaryFile(filePath),
          })
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

    this.documents.set(docs)
  }

  updateFile(filePath: string, value: string): void {
    const docs = this.documents.get()
    const existingDoc = docs[filePath]

    this.documents.setKey(filePath, {
      value,
      isBinary: existingDoc?.isBinary ?? isBinaryFile(filePath),
    })
  }
}

