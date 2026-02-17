/**
 * Download vendor binaries for Windows builds
 *
 * This script downloads MinGit and BusyBox for bundling with the Windows app.
 * Run this before building for Windows: node scripts/download-vendor-binaries.cjs
 */

const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const MINGIT_VERSION = '2.47.1'
const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/MinGit-${MINGIT_VERSION}-64-bit.zip`
const BUSYBOX_URL = 'https://frippery.org/files/busybox/busybox.exe'

const VENDOR_DIR = path.join(__dirname, '..', 'resources', 'vendor', 'win32')

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`)

    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(destPath)

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close()
        fs.unlinkSync(destPath)
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject)
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(destPath)
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'], 10)
      let downloadedSize = 0

      response.on('data', (chunk) => {
        downloadedSize += chunk.length
        if (totalSize) {
          const percent = Math.round((downloadedSize / totalSize) * 100)
          process.stdout.write(`\r  Progress: ${percent}%`)
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        console.log('\n  Download complete.')
        resolve()
      })
    })

    request.on('error', (err) => {
      file.close()
      fs.unlinkSync(destPath)
      reject(err)
    })
  })
}

async function main() {
  console.log('=== Downloading vendor binaries for Windows ===\n')

  // Create vendor directory
  if (!fs.existsSync(VENDOR_DIR)) {
    fs.mkdirSync(VENDOR_DIR, { recursive: true })
    console.log(`Created directory: ${VENDOR_DIR}`)
  }

  const mingitDir = path.join(VENDOR_DIR, 'mingit')
  const mingitZip = path.join(VENDOR_DIR, 'mingit.zip')
  const busyboxPath = path.join(VENDOR_DIR, 'busybox.exe')

  // Download MinGit if not present
  if (!fs.existsSync(mingitDir)) {
    console.log('\n[1/2] MinGit')

    await downloadFile(MINGIT_URL, mingitZip)

    console.log('  Extracting...')
    fs.mkdirSync(mingitDir, { recursive: true })

    // Use unzip on Unix, PowerShell on Windows (though this script is mainly for CI)
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${mingitZip}' -DestinationPath '${mingitDir}'"`, {
        stdio: 'inherit',
      })
    } else {
      execSync(`unzip -q "${mingitZip}" -d "${mingitDir}"`, { stdio: 'inherit' })
    }

    fs.unlinkSync(mingitZip)
    console.log('  Extracted MinGit.')
  } else {
    console.log('[1/2] MinGit: Already present, skipping.')
  }

  // Download BusyBox if not present
  if (!fs.existsSync(busyboxPath)) {
    console.log('\n[2/2] BusyBox')
    await downloadFile(BUSYBOX_URL, busyboxPath)
  } else {
    console.log('[2/2] BusyBox: Already present, skipping.')
  }

  // Print summary
  console.log('\n=== Summary ===')

  const mingitSize = getDirectorySize(mingitDir)
  const busyboxSize = fs.statSync(busyboxPath).size

  console.log(`MinGit:  ${formatSize(mingitSize)}`)
  console.log(`BusyBox: ${formatSize(busyboxSize)}`)
  console.log(`Total:   ${formatSize(mingitSize + busyboxSize)}`)

  console.log('\n✓ Vendor binaries ready for Windows build.')
}

function getDirectorySize(dirPath) {
  let size = 0
  const files = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const file of files) {
    const filePath = path.join(dirPath, file.name)
    if (file.isDirectory()) {
      size += getDirectorySize(filePath)
    } else {
      size += fs.statSync(filePath).size
    }
  }

  return size
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
