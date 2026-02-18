import { createStore } from 'zustand/vanilla'
import type { FileMap, Dirent, ProjectFile } from '@/app/types/project'

export class FilesStore {
  files = createStore<FileMap>(() => ({}))
  #modifiedFiles = new Set<string>()

  get filesCount(): number {
    return Object.keys(this.files.getState()).length
  }

  getFile(filePath: string): ProjectFile | undefined {
    const dirent = this.files.getState()[filePath]
    if (dirent?.type === 'file') {
      return dirent
    }
    return undefined
  }

  setFiles(files: FileMap | null): void {
    this.files.setState(files || {}, true)
  }

  addFile(filePath: string, content: string, isBinary?: boolean): void {
    const currentFiles = this.files.getState()
    this.files.setState({
      ...currentFiles,
      [filePath]: { type: 'file', content, isBinary },
    }, true)
    this.#modifiedFiles.add(filePath)
  }

  updateFile(filePath: string, content: string): void {
    const currentFiles = this.files.getState()
    const file = currentFiles[filePath]

    if (file?.type === 'file') {
      this.files.setState({
        ...currentFiles,
        // Preserve isBinary flag when updating content
        [filePath]: { type: 'file', content, isBinary: file.isBinary },
      }, true)
      this.#modifiedFiles.add(filePath)
    }
  }

  deleteFile(filePath: string): void {
    const currentFiles = this.files.getState()
    const { [filePath]: _, ...rest } = currentFiles
    this.files.setState(rest, true)
    this.#modifiedFiles.delete(filePath)
  }

  async saveFile(filePath: string, content: string): Promise<void> {
    this.updateFile(filePath, content)
    this.#modifiedFiles.delete(filePath)
  }

  reinitialize(files: FileMap | null): void {
    this.files.setState(files || {}, true)
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

