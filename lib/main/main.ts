// Load environment variables from .env file for main process
import * as dotenv from 'dotenv'
dotenv.config()

// CRITICAL: Protocol registration MUST happen before any imports that use app APIs
import { protocol } from 'electron'

// Register custom protocols with privileges before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bfloat',
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
  {
    scheme: 'chat',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createAppWindow } from './app'
import { cleanupTerminals } from '@/lib/conveyor/handlers/terminal-handler'
import { cleanupAllTempDirectories } from '@/lib/conveyor/handlers/filesystem-handler'
import { cleanupProjectService } from './project-service-handlers'
import { cleanupChatProtocol } from './chat-protocol'
import { getAgentManager } from '@/lib/agents'
import { resolve } from 'path'

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('bfloat', process.execPath, [resolve(process.argv[1])])
  }
} else {
  const registered = app.setAsDefaultProtocolClient('bfloat')
  console.log(`[Main] Protocol handler registration: ${registered ? 'success' : 'FAILED'}`)
}

/**
 * Handles protocol URLs (deep links) from external browser OAuth flow
 * Sends the URL to the renderer via IPC for authentication handling
 */
const pendingProtocolUrls: string[] = []

const stripWrappingQuotes = (value: string) => value.replace(/^"+|"+$/g, '')

const normalizeCallbackPath = (callbackPath: string) => {
  const trimmed = callbackPath.replace(/\/+$/, '')
  return trimmed || '/'
}

const extractProtocolUrl = (args: string[]): string | null => {
  for (const rawArg of args) {
    const arg = stripWrappingQuotes(rawArg)
    if (arg.startsWith('bfloat://')) return arg
  }

  for (const rawArg of args) {
    const arg = stripWrappingQuotes(rawArg)
    const idx = arg.indexOf('bfloat://')
    if (idx >= 0) return arg.substring(idx)
  }

  return null
}

async function ensureMacAppInApplicationsFolder(): Promise<boolean> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return true
  }

  if (app.isInApplicationsFolder()) {
    return true
  }

  try {
    const moved = app.moveToApplicationsFolder({
      conflictHandler: () => true,
    })
    if (moved) {
      console.log('[Main] Moved app to /Applications, relaunching...')
      // On success, Electron will relaunch the app automatically.
      return false
    }
    console.warn('[Main] Move to /Applications was cancelled or declined.')
    return true
  } catch (error) {
    console.error('[Main] Move to /Applications failed:', error)
    return true
  }
}

function flushPendingProtocolUrls(window: BrowserWindow): void {
  while (pendingProtocolUrls.length > 0) {
    const url = pendingProtocolUrls.shift()
    if (url) {
      handleProtocolUrl(url, window)
    }
  }
}

function handleProtocolUrl(url: string, window: BrowserWindow): void {
  const sanitizedUrl = stripWrappingQuotes(url.trim())
  console.log('[Main] Handling protocol URL:', sanitizedUrl)
  try {
    const parsedUrl = new URL(sanitizedUrl)
    const callbackPath = normalizeCallbackPath(`/${parsedUrl.hostname}${parsedUrl.pathname}`)
    console.log('[Main] Parsed callback path:', callbackPath)

    // Handle auth callbacks
    if (callbackPath === '/auth/callback' || callbackPath === '/auth') {
      console.log('[Main] Auth callback detected, sending to renderer')
      // Log all URL params for debugging
      const params: Record<string, string> = {}
      parsedUrl.searchParams.forEach((value, key) => {
        params[key] = key === 'token' ? value.substring(0, 20) + '...' : value
      })
      console.log('[Main] Auth callback params:', JSON.stringify(params))
      // Send auth token via IPC to renderer for processing
      // The renderer will parse the URL and extract the token
      window.webContents.send('auth-token', sanitizedUrl)
    }
    // Handle OAuth success callbacks (Google, Firebase, etc.)
    else if (callbackPath === '/oauth-success') {
      const message = parsedUrl.searchParams.get('message')
      window.webContents.send('oauth-success', { message })
    }
    // Handle OAuth error callbacks
    else if (callbackPath === '/oauth-error') {
      const message = parsedUrl.searchParams.get('message')
      window.webContents.send('oauth-error', { message })
    }
    // Handle Convex OAuth callbacks
    else if (callbackPath === '/convex/callback') {
      // Send convex callback event to renderer for processing
      const success = parsedUrl.searchParams.get('success')
      const error = parsedUrl.searchParams.get('error')

      window.webContents.send('convex-callback', {
        success: success === 'true',
        error: error || null,
      })
    }
    // Handle Google OAuth callbacks (for Firebase integration)
    else if (callbackPath === '/google/callback') {
      const success = parsedUrl.searchParams.get('success')
      const error = parsedUrl.searchParams.get('error')

      window.webContents.send('google-callback', {
        success: success === 'true',
        error: error || null,
      })
    }
    // Handle Stripe Connect OAuth callbacks
    else if (callbackPath === '/stripe/callback') {
      const success = parsedUrl.searchParams.get('success')
      const error = parsedUrl.searchParams.get('error')

      window.webContents.send('stripe-callback', {
        success: success === 'true',
        error: error || null,
      })
    }
    // Handle RevenueCat OAuth callbacks
    else if (callbackPath === '/revenuecat/callback') {
      const success = parsedUrl.searchParams.get('success')
      const error = parsedUrl.searchParams.get('error')

      window.webContents.send('revenuecat-callback', {
        success: success === 'true',
        error: error || null,
      })
    }
    // Handle Anthropic (Claude) OAuth callbacks
    else if (callbackPath === '/anthropic/callback') {
      const success = parsedUrl.searchParams.get('success')
      const error = parsedUrl.searchParams.get('error')
      const accessToken = parsedUrl.searchParams.get('access_token')
      const refreshToken = parsedUrl.searchParams.get('refresh_token')
      const expiresAt = parsedUrl.searchParams.get('expires_at')
      const accountId = parsedUrl.searchParams.get('account_id')

      window.webContents.send('anthropic-callback', {
        success: success === 'true',
        error: error || null,
        accessToken: accessToken || null,
        refreshToken: refreshToken || null,
        expiresAt: expiresAt ? Number(expiresAt) : null,
        accountId: accountId || null,
      })
    }
  } catch (err) {
    console.error('Failed to parse protocol URL:', sanitizedUrl, err)
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    console.log('[Main] second-instance event fired, commandLine:', JSON.stringify(commandLine))

    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) {
      console.error('[Main] second-instance: No main window found')
      return
    }

    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()

    // Find protocol URL in command line args
    // On Windows, the URL might be a standalone arg or embedded in another arg
    const url = extractProtocolUrl(commandLine)

    if (url) {
      if (mainWindow.webContents.isLoading()) {
        pendingProtocolUrls.push(url)
      } else {
        handleProtocolUrl(url, mainWindow)
      }
    } else {
      console.warn('[Main] second-instance: No bfloat:// URL found in commandLine')
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')
  const canContinue = await ensureMacAppInApplicationsFolder()
  if (!canContinue) {
    return
  }
  // Create app window (async - starts chat server)
  await createAppWindow()

  // Check if app was launched with a protocol URL
  const protocolUrl = extractProtocolUrl(process.argv)
  if (protocolUrl) {
    pendingProtocolUrls.push(protocolUrl)
  }

  const existingWindows = BrowserWindow.getAllWindows()
  for (const window of existingWindows) {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        flushPendingProtocolUrls(window)
      })
    } else {
      flushPendingProtocolUrls(window)
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    window.webContents.once('did-finish-load', () => {
      flushPendingProtocolUrls(window)
    })
  })

  app.on('activate', async function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      await createAppWindow()
    }
  })

})

// macOS: Handle protocol URLs when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault()
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length > 0) {
    const mainWindow = allWindows[0]
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    if (mainWindow.webContents.isLoading()) {
      pendingProtocolUrls.push(url)
    } else {
      handleProtocolUrl(url, mainWindow)
    }
  } else {
    pendingProtocolUrls.push(url)
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up terminal processes, temp directories, agent sessions, and chat protocol before quitting
app.on('before-quit', async () => {
  cleanupTerminals()
  cleanupAllTempDirectories()
  await cleanupProjectService()
  cleanupChatProtocol()

  // Terminate all running agent sessions to prevent orphaned processes
  try {
    const agentManager = getAgentManager()
    await agentManager.terminateAllSessions()
    console.log('[Main] All agent sessions terminated on quit')
  } catch (error) {
    console.error('[Main] Failed to terminate agent sessions on quit:', error)
  }
})

// In this file, you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
