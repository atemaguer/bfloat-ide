try {
  require('dotenv').config()
} catch {}

import * as fs from 'node:fs'
import * as path from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

type Platform = 'darwin' | 'linux' | 'win32'
type Arch = 'arm64' | 'x64'

type ClassifiedFile = {
  absolutePath: string
  name: string
  platform: Platform
  arch: Arch
}

type UpdaterTarget = {
  platform: Platform
  arch: Arch
  artifact: ClassifiedFile
  signature: ClassifiedFile
}

const DEFAULT_BUCKET = 'bfloat-ide-updates'
const DEFAULT_REGION = 'us-west-2'
const DEFAULT_CHANNEL = 'stable'

function walkFiles(root: string): string[] {
  const results: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()!
    const stat = fs.statSync(current)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry))
      }
      continue
    }
    if (stat.isFile()) {
      results.push(current)
    }
  }

  return results
}

function classifyArtifact(filePath: string): ClassifiedFile | null {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const name = path.basename(filePath)
  const lower = name.toLowerCase()

  if (normalizedPath.includes('aarch64-apple-darwin') || lower.includes('_aarch64.')) {
    return { absolutePath: filePath, name, platform: 'darwin', arch: 'arm64' }
  }

  if (
    normalizedPath.includes('x86_64-apple-darwin') ||
    lower.includes('_x64.dmg') ||
    lower.includes('_x64.app.tar.gz')
  ) {
    return { absolutePath: filePath, name, platform: 'darwin', arch: 'x64' }
  }

  if (
    normalizedPath.includes('x86_64-unknown-linux-gnu') ||
    lower.endsWith('.appimage') ||
    lower.endsWith('.deb') ||
    lower.endsWith('.rpm')
  ) {
    return { absolutePath: filePath, name, platform: 'linux', arch: 'x64' }
  }

  if (
    normalizedPath.includes('x86_64-pc-windows-msvc') ||
    lower.endsWith('.exe') ||
    lower.endsWith('.msi') ||
    lower.endsWith('.nsis.zip')
  ) {
    return { absolutePath: filePath, name, platform: 'win32', arch: 'x64' }
  }

  return null
}

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'text/yaml'
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (lower.endsWith('.deb')) return 'application/vnd.debian.binary-package'
  if (lower.endsWith('.rpm')) return 'application/x-rpm'
  if (lower.endsWith('.msi')) return 'application/x-msi'
  if (lower.endsWith('.sig')) return 'text/plain'
  if (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.appimage') || lower.endsWith('.exe')) {
    return 'application/octet-stream'
  }
  return 'application/octet-stream'
}

function uploadKey(channel: string, platform: Platform, arch: Arch, name: string, prefix?: string): string {
  const base = `${channel}/${platform}/${arch}/${name}`
  return prefix ? `${prefix.replace(/\/$/, '')}/${base}` : base
}

function publicBaseUrl(bucket: string, region: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com`
}

function readPackageVersion(repoRoot: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/desktop/package.json'), 'utf8'))
  return pkg.version
}

function updaterPriority(platform: Platform, name: string): number {
  const lower = name.toLowerCase()
  if (platform === 'darwin') return lower.endsWith('.app.tar.gz') ? 100 : 0
  if (platform === 'linux') return lower.endsWith('.appimage') ? 100 : 0
  if (platform === 'win32') {
    if (lower.endsWith('.exe')) return 100
    if (lower.endsWith('.msi')) return 90
  }
  return 0
}

function targetKey(platform: Platform, arch: Arch): string {
  const platformName = platform === 'win32' ? 'windows' : platform
  const archName = arch === 'arm64' ? 'aarch64' : 'x86_64'
  return `${platformName}-${archName}`
}

function findUpdaterTarget(bucketFiles: ClassifiedFile[], platform: Platform, arch: Arch): UpdaterTarget | null {
  const signatures = new Map(
    bucketFiles
      .filter((file) => file.name.toLowerCase().endsWith('.sig'))
      .map((file) => [file.name.slice(0, -4), file])
  )

  const candidates = bucketFiles
    .filter((file) => updaterPriority(platform, file.name) > 0)
    .sort((a, b) => updaterPriority(platform, b.name) - updaterPriority(platform, a.name))

  for (const artifact of candidates) {
    const signature = signatures.get(artifact.name)
    if (signature) {
      return { platform, arch, artifact, signature }
    }
  }

  return null
}

async function putFile(
  s3: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  name: string
): Promise<void> {
  const immutable =
    !name.toLowerCase().endsWith('.json') && !name.toLowerCase().endsWith('.yml') && !name.toLowerCase().endsWith('.yaml')

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentTypeFor(name),
      CacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate'
    })
  )
}

async function putJson(s3: S3Client, bucket: string, key: string, value: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate'
    })
  )
}

async function main() {
  const repoRoot = process.cwd()
  const artifactsRoot = path.resolve(process.argv[2] ?? 'artifacts')
  const version = process.argv[3] ?? readPackageVersion(repoRoot)
  const bucket = process.env.UPDATES_BUCKET || DEFAULT_BUCKET
  const region = process.env.AWS_REGION || DEFAULT_REGION
  const channel = process.env.UPDATE_CHANNEL || DEFAULT_CHANNEL
  const prefix = process.env.UPDATES_PREFIX
  const baseUrl = process.env.UPDATES_BASE_URL || publicBaseUrl(bucket, region)

  if (!fs.existsSync(artifactsRoot)) {
    throw new Error(`Artifacts directory not found: ${artifactsRoot}`)
  }

  const s3 = new S3Client({ region })
  const files = walkFiles(artifactsRoot)
    .map(classifyArtifact)
    .filter((value): value is ClassifiedFile => value !== null)

  if (files.length === 0) {
    throw new Error(`No releasable artifacts found in ${artifactsRoot}`)
  }

  for (const file of files) {
    const key = uploadKey(channel, file.platform, file.arch, file.name, prefix)
    await putFile(s3, bucket, key, file.absolutePath, file.name)
    console.log(`Uploaded ${key}`)
  }

  const grouped = new Map<string, ClassifiedFile[]>()
  for (const file of files) {
    const groupKey = `${file.platform}/${file.arch}`
    const bucketFiles = grouped.get(groupKey) ?? []
    bucketFiles.push(file)
    grouped.set(groupKey, bucketFiles)
  }

  const platforms: Record<string, { signature: string; url: string }> = {}

  for (const [groupKey, bucketFiles] of grouped) {
    const [platform, arch] = groupKey.split('/') as [Platform, Arch]
    const target = findUpdaterTarget(bucketFiles, platform, arch)
    if (!target) {
      console.log(`Skipping updater manifest entry for ${groupKey}: no signed updater artifact found`)
      continue
    }

    const artifactKey = uploadKey(channel, platform, arch, target.artifact.name, prefix)
    platforms[targetKey(platform, arch)] = {
      signature: fs.readFileSync(target.signature.absolutePath, 'utf8').trim(),
      url: `${baseUrl}/${artifactKey}`
    }
  }

  if (Object.keys(platforms).length > 0) {
    const latestKey = prefix ? `${prefix.replace(/\/$/, '')}/${channel}/latest.json` : `${channel}/latest.json`
    await putJson(s3, bucket, latestKey, {
      version,
      notes: `Bfloat IDE v${version}`,
      pub_date: new Date().toISOString(),
      platforms
    })
    console.log(`Uploaded ${latestKey}`)
  } else {
    console.log('Skipping latest.json: no signed updater artifacts found')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
