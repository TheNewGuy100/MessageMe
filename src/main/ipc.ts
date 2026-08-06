import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { debug } from './debug'
import { safeErrorMessage } from '../shared/handlers/network-error'
import { officialViews, OfficialViewMode } from './official-views'
import { deleteAutomationFlow, deleteScheduledMessage, insertScheduledMessage, listAutomationFlows, listScheduledMessages, upsertAutomationFlow } from './database'

const dialogWindows = new Set<BrowserWindow>()

function broadcast(event: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(event, ...args))
}

function handle<T>(channel: string, fn: (...args: any[]) => T | Promise<T>) {
  ipcMain.handle(channel, async (_e, ...args: any[]) => {
    debug.ipc(channel, 'send', args.length ? args : undefined)
    try {
      const result = await fn(...args)
      debug.ipc(channel, 'result', result !== undefined ? result : 'ok')
      return result
    } catch (e: any) {
      const message = safeErrorMessage(e)
      debug.ipc(channel, 'error', message)
      return { __ipcError: message }
    }
  })
}

export function registerIpcHandlers() {
  handle('app:reload', () => {
    officialViews.reload()
  })
  handle('app:setSidebarWidth', (width: number) => officialViews.setSidebarWidth(width))
  handle('app:setZoom', (percent: number) => officialViews.setZoom(percent))
  handle('app:setAudioVolume', (volume: number) => officialViews.setAudioVolume(volume))
  handle('app:getAudioVolume', () => officialViews.getAudioVolume())
  handle('app:setViewMode', (mode: OfficialViewMode) => officialViews.setViewMode(mode))
  handle('app:navigateInstagram', (section: 'inbox' | 'requests' | 'hidden') => officialViews.navigateInstagram(section))
  handle('app:getUnreadCount', () => officialViews.getUnreadCount())
  handle('app:getWhatsAppUnreadCount', () => officialViews.getWhatsAppUnreadCount())
  handle('app:getInstagramCounts', () => officialViews.getInstagramCounts())
  handle('app:setInstagramAutomation', (enabled: boolean, text: string, automaticReplies: Array<{ message: string; start?: string; end?: string }>) => officialViews.setInstagramAutomation(enabled, text, automaticReplies))
  handle('app:setGlobalAutomation', (enabled: boolean) => officialViews.setGlobalAutomation(enabled))
  handle('app:getAutomationStatus', () => officialViews.getAutomationStatus())
  handle('app:getAutomationLogs', () => officialViews.getAutomationLogs())
  handle('app:clearAutomationLogs', () => officialViews.clearAutomationLogs())
  handle('app:resetAutomationRuntime', () => officialViews.resetAutomationRuntime())
  handle('app:getScheduledMessages', () => listScheduledMessages())
  handle('app:createScheduledMessage', (item: { id: string; message: string; at: string; createdAt?: string; platform?: string; conversationId?: string | null }) => insertScheduledMessage(item))
  handle('app:deleteScheduledMessage', (id: string) => deleteScheduledMessage(id))
  handle('app:getAutomationFlows', () => listAutomationFlows())
  handle('app:saveAutomationFlow', (flow: { id: string; name: string; enabled: boolean; priority?: number; definition: string; createdAt?: string }) => {
    upsertAutomationFlow(flow)
    officialViews.refreshAutomationStatus()
  })
  handle('app:deleteAutomationFlow', (id: string) => deleteAutomationFlow(id))
  handle('app:openDialog', (type: 'dashboard' | 'automation' | 'appointments' | 'logs') => {
    const existingDialog = [...dialogWindows][0]
    if (existingDialog && !existingDialog.isDestroyed()) {
      existingDialog.show()
      existingDialog.focus()
      return
    }
    const parent = BrowserWindow.getAllWindows().find(window => !dialogWindows.has(window))
    if (!parent || parent.isDestroyed()) return
    const parentBounds = parent.getContentBounds()
    const dialogWidth = Math.max(440, Math.round(parentBounds.width * 0.8))
    const dialogHeight = Math.max(420, Math.round(parentBounds.height * 0.8))

    const dialogWindow = new BrowserWindow({
      parent,
      width: dialogWidth,
      height: dialogHeight,
      minWidth: 440,
      minHeight: 420,
      frame: false,
      show: false,
      resizable: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    dialogWindows.add(dialogWindow)

    dialogWindow.once('ready-to-show', () => {
      dialogWindow?.center()
      dialogWindow?.show()
    })
    dialogWindow.on('closed', () => { dialogWindows.delete(dialogWindow) })

    if (process.env.ELECTRON_RENDERER_URL) {
      void dialogWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?dialog=${type}`)
    } else {
      void dialogWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { dialog: type } })
    }
  })
  handle('app:closeDialog', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow && dialogWindows.has(focusedWindow)) focusedWindow.close()
  })

  handle('debug:getEnabled', () => debug.enabled)

  debug.onToggle((enabled) => {
    broadcast('debug:toggle', enabled)
  })
}
