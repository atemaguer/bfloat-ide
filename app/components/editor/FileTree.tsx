import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Search } from 'lucide-react'
import type { FileMap, Dirent } from '@/app/types/project'
import { FileIcon } from './FileIcons'

interface FileTreeProps {
  files: FileMap
  selectedFile?: string
  onFileSelect: (filePath: string) => void
  unsavedFiles?: Set<string>
  projectName?: string
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

function buildTree(files: FileMap): TreeNode[] {
  const root: Record<string, TreeNode> = {}

  // Sort file paths for consistent ordering
  const sortedPaths = Object.keys(files).sort()

  for (const path of sortedPaths) {
    const dirent = files[path]
    if (!dirent) continue

    const parts = path.split('/')
    let current = root

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1
      const currentPath = parts.slice(0, index + 1).join('/')

      if (!current[part]) {
        current[part] = {
          name: part,
          path: currentPath,
          type: isLast && dirent.type === 'file' ? 'file' : 'folder',
          children: isLast && dirent.type === 'file' ? undefined : {},
        }
      }

      if (!isLast && current[part].children) {
        current = current[part].children as Record<string, TreeNode>
      }
    })
  }

  // Convert to array and sort (folders first, then files)
  // Filter out dot-prefixed folders but keep dot-prefixed files
  function toArray(obj: Record<string, TreeNode>): TreeNode[] {
    return Object.values(obj)
      .filter((node) => {
        // Hide dot-prefixed folders, but keep dot-prefixed files
        if (node.type === 'folder' && node.name.startsWith('.')) {
          return false
        }
        return true
      })
      .map((node) => ({
        ...node,
        children: node.children ? toArray(node.children as unknown as Record<string, TreeNode>) : undefined,
      }))
      .sort((a, b) => {
        if (a.type === 'folder' && b.type === 'file') return -1
        if (a.type === 'file' && b.type === 'folder') return 1
        return a.name.localeCompare(b.name)
      })
  }

  return toArray(root)
}

export function FileTree({ files, selectedFile, onFileSelect, unsavedFiles, projectName }: FileTreeProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isProjectCollapsed, setIsProjectCollapsed] = useState(false)
  const tree = useMemo(() => buildTree(files), [files])

  // Filter files based on search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return null
    const query = searchQuery.toLowerCase()
    const matches: TreeNode[] = []

    function searchNodes(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(query)) {
          matches.push(node)
        }
        if (node.children) {
          searchNodes(node.children)
        }
      }
    }
    searchNodes(tree)
    return matches
  }, [tree, searchQuery])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const displayName = projectName || 'Project'

  return (
    <div className="file-tree">
      {/* Search Bar */}
      <div className="file-tree-search">
        <Search size={13} className="file-tree-search-icon" />
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="file-tree-search-input"
        />
      </div>

      {/* Project Header */}
      <div
        className="file-tree-header"
        onClick={() => setIsProjectCollapsed(!isProjectCollapsed)}
      >
        <span className="file-tree-header-chevron">
          {isProjectCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <span className="file-tree-header-name">{displayName.toUpperCase()}</span>
      </div>

      {/* File Tree Content */}
      <AnimatePresence>
        {!isProjectCollapsed && (
          <motion.div
            className="file-tree-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {searchQuery && filteredFiles ? (
              // Show search results
              filteredFiles.length > 0 ? (
                filteredFiles.map((node) => (
                  <TreeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedFile={selectedFile}
                    onFileSelect={onFileSelect}
                    unsavedFiles={unsavedFiles}
                    isSearchResult
                  />
                ))
              ) : (
                <div className="file-tree-empty">No files found</div>
              )
            ) : (
              // Show normal tree
              tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedFile={selectedFile}
                  onFileSelect={onFileSelect}
                  unsavedFiles={unsavedFiles}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface TreeItemProps {
  node: TreeNode
  depth: number
  selectedFile?: string
  onFileSelect: (filePath: string) => void
  unsavedFiles?: Set<string>
  isSearchResult?: boolean
}

function TreeItem({ node, depth, selectedFile, onFileSelect, unsavedFiles, isSearchResult }: TreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2) // Auto-expand first 2 levels
  const isSelected = selectedFile === node.path
  const isUnsaved = unsavedFiles?.has(node.path)

  const handleClick = () => {
    if (node.type === 'folder') {
      setIsExpanded(!isExpanded)
    } else {
      onFileSelect(node.path)
    }
  }

  return (
    <div className="tree-item">
      <div
        className={`tree-item-row ${isSelected ? 'selected' : ''}`}
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.type === 'folder' ? (
          <>
            <span className="tree-item-chevron">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            <span className="tree-item-icon folder">
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
          </>
        ) : (
          <>
            <span className="tree-item-spacer" />
            <span className="tree-item-icon file">
              <FileIcon fileName={node.name} size={14} />
            </span>
          </>
        )}
        <span className="tree-item-name">{node.name}</span>
        {isUnsaved && <span className="tree-item-unsaved" />}
      </div>

      <AnimatePresence>
        {node.type === 'folder' && isExpanded && node.children && !isSearchResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
                unsavedFiles={unsavedFiles}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

