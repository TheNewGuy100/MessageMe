import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { debug, watchDevtools } from './debug'
import { handleRenderError } from '../shared/handlers/render-error'
import { handleNetworkError } from '../shared/handlers/network-error'
import { whatsappService } from './whatsapp'
import { instagramService } from './instagram'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Message Manager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  watchDevtools(mainWindow)

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    handleRenderError({ kind: 'load-failed', errorCode, errorDescription, url: validatedURL, isMainFrame })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    handleRenderError({ kind: 'process-gone', reason: details.reason, exitCode: details.exitCode })
  })
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const isInternalLog = /\[(?:DEBUG|NETWORK|RENDER|IPC)\]/.test(message)
    if (level < 3 || isInternalLog) return
    if (/remote method|Instagram API|Failed to fetch|network/i.test(message)) {
      handleNetworkError({ kind: 'renderer-network-error', message, line, source: sourceId })
      return
    }
    handleRenderError({ kind: 'console-error', message, line, source: sourceId })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  whatsappService.connect().catch(error => console.error('[WA] startup error:', error))
  instagramService.tryRestore().catch(error => console.error('[IG] startup restore error:', error))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
