import { BrowserWindow, shell, app } from 'electron'
import { join } from 'path'
import appIcon from '@/resources/build/icon.png?asset'
import { registerResourcesProtocol } from './protocols'
import { registerWindowHandlers } from '@/lib/conveyor/handlers/window-handler'
import { registerTerminalHandlers } from '@/lib/conveyor/handlers/terminal-handler'
import { registerFilesystemHandlers } from '@/lib/conveyor/handlers/filesystem-handler'
import { registerProjectSyncHandlers, setProjectSyncMainWindow } from '@/lib/conveyor/handlers/project-sync-handler'
import { registerProviderHandlers } from '@/lib/conveyor/handlers/provider-handler'
import { registerAIAgentHandlers } from '@/lib/conveyor/handlers/ai-agent-handler'
import { registerDeployHandlers } from '@/lib/conveyor/handlers/deploy-handler'
import { registerProjectServiceHandlers, setProjectServiceWindow } from './project-service-handlers'
import { registerChatProtocol } from './chat-protocol'
import { registerSecretsHandlers } from '@/lib/conveyor/handlers/secrets-handler'
import { registerScreenshotHandlers } from '@/lib/conveyor/handlers/screenshot-handler'
import { registerLocalProjectsHandlers } from '@/lib/conveyor/handlers/local-projects-handler'
import { registerTemplateHandlers } from '@/lib/conveyor/handlers/template-handler'

export async function createAppWindow(): Promise<void> {
  // Register custom protocol for resources
  registerResourcesProtocol()

  // Register the chat:// protocol handler for useChat integration
  registerChatProtocol()
  console.log('[App] Chat protocol registered: chat://api/chat')


  // Create the main window.
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: '#1a1a1a',
    icon: appIcon,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    title: 'Bfloat',
    maximizable: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      webviewTag: true, // Enable <webview> tag for embedded browser preview
    },
  })

  // Register IPC events for the main window.
  registerWindowHandlers(mainWindow)
  registerTerminalHandlers()
  registerFilesystemHandlers()
  registerProjectSyncHandlers()
  registerProviderHandlers()
  registerAIAgentHandlers()
  registerDeployHandlers()
  registerProjectServiceHandlers()
  registerSecretsHandlers()
  registerScreenshotHandlers()
  registerLocalProjectsHandlers()
  registerTemplateHandlers()
  setProjectSyncMainWindow(mainWindow)
  setProjectServiceWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
