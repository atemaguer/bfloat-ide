import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resourceDir = path.join(repoRoot, 'packages', 'desktop', 'src-tauri', 'resources', 'bun', 'bin')
const isWindows = process.platform === 'win32'

function resolveBunBinary() {
  const locator = isWindows ? 'where.exe' : 'which'
  const result = spawnSync(locator, ['bun'], { encoding: 'utf8' })

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim()
    throw new Error(`Unable to locate Bun on PATH via ${locator}${details ? `: ${details}` : ''}`)
  }

  const firstMatch = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstMatch) {
    throw new Error(`Unable to locate Bun on PATH via ${locator}`)
  }

  return firstMatch
}

function writeFile(filePath, content, mode) {
  fs.writeFileSync(filePath, content, 'utf8')
  if (!isWindows && typeof mode === 'number') {
    fs.chmodSync(filePath, mode)
  }
}

const bunBinary = resolveBunBinary()
const bundledBunName = isWindows ? 'bun.exe' : 'bun'

fs.rmSync(resourceDir, { recursive: true, force: true })
fs.mkdirSync(resourceDir, { recursive: true })
fs.copyFileSync(bunBinary, path.join(resourceDir, bundledBunName))

if (!isWindows) {
  fs.chmodSync(path.join(resourceDir, bundledBunName), 0o755)
  writeFile(
    path.join(resourceDir, 'bunx'),
    '#!/bin/sh\nexec "$(dirname "$0")/bun" x "$@"\n',
    0o755
  )
} else {
  writeFile(
    path.join(resourceDir, 'bunx.cmd'),
    '@echo off\r\n"%~dp0bun.exe" x %*\r\n'
  )
}

console.log(`[prepare-bundled-bun] Bundled Bun from ${bunBinary} into ${resourceDir}`)
