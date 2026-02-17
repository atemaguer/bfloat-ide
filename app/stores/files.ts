import { atom, map } from 'nanostores'
import type { FileMap, Dirent, ProjectFile } from '@/app/types/project'

export class FilesStore {
  files = map<FileMap>({})
  #modifiedFiles = new Set<string>()

  get filesCount(): number {
    return Object.keys(this.files.get()).length
  }

  getFile(filePath: string): ProjectFile | undefined {
    const dirent = this.files.get()[filePath]
    if (dirent?.type === 'file') {
      return dirent
    }
    return undefined
  }

  setFiles(files: FileMap | null): void {
    this.files.set(files || {})
  }

  addFile(filePath: string, content: string, isBinary?: boolean): void {
    const currentFiles = this.files.get()
    this.files.set({
      ...currentFiles,
      [filePath]: { type: 'file', content, isBinary },
    })
    this.#modifiedFiles.add(filePath)
  }

  updateFile(filePath: string, content: string): void {
    const currentFiles = this.files.get()
    const file = currentFiles[filePath]

    if (file?.type === 'file') {
      this.files.set({
        ...currentFiles,
        // Preserve isBinary flag when updating content
        [filePath]: { type: 'file', content, isBinary: file.isBinary },
      })
      this.#modifiedFiles.add(filePath)
    }
  }

  deleteFile(filePath: string): void {
    const currentFiles = this.files.get()
    const { [filePath]: _, ...rest } = currentFiles
    this.files.set(rest)
    this.#modifiedFiles.delete(filePath)
  }

  async saveFile(filePath: string, content: string): Promise<void> {
    this.updateFile(filePath, content)
    this.#modifiedFiles.delete(filePath)
  }

  reinitialize(files: FileMap | null): void {
    this.files.set(files || {})
    this.#modifiedFiles.clear()
  }

  getFileModifications(): Set<string> {
    return new Set(this.#modifiedFiles)
  }

  resetFileModifications(): void {
    this.#modifiedFiles.clear()
  }
}

export const filesStore = new FilesStore()

