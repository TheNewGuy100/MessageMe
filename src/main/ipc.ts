import { ipcMain, BrowserWindow } from 'electron'
import { whatsappService } from './whatsapp'
import { instagramService } from './instagram'
import { waClearAll } from './database'
import { debug } from './debug'
import { safeErrorMessage } from '../shared/handlers/network-error'

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
  whatsappService.on('connecting', () => broadcast('whatsapp:connecting'))
  whatsappService.on('qr', (qr: string) => broadcast('whatsapp:qr', qr))
  whatsappService.on('connected', () => broadcast('whatsapp:connected'))
  whatsappService.on('disconnected', (reason: string) => broadcast('whatsapp:disconnected', reason))
  whatsappService.on('error', (msg: string) => broadcast('whatsapp:error', msg))
  whatsappService.on('message', (msg: any) => broadcast('whatsapp:message', msg))
  whatsappService.on('chatsUpdated', (chats: any[]) => broadcast('whatsapp:chatsUpdated', chats))
  whatsappService.on('messagesUpdated', (chatIds: string[]) => broadcast('whatsapp:messagesUpdated', chatIds))
  whatsappService.on('historySync', (syncing: boolean) => broadcast('whatsapp:historySync', syncing))

  handle('whatsapp:getStatus', () => whatsappService.getStatus())
  handle('whatsapp:getQRCode', () => whatsappService.getQRCode())
  handle('whatsapp:getHistorySyncing', () => whatsappService.getHistorySyncing())
  handle('whatsapp:connect', () => whatsappService.connect())
  handle('whatsapp:disconnect', () => whatsappService.disconnect())
  handle('whatsapp:getChats', () => whatsappService.getChats())
  handle('whatsapp:getMessages', (chatId: string) => whatsappService.getMessages(chatId))
  handle('whatsapp:getOlderMessages', (chatId: string, beforeId: string) => whatsappService.getOlderMessages(chatId, beforeId))
  handle('whatsapp:getMedia', (chatId: string, messageId: string) => whatsappService.getMedia(chatId, messageId))
  handle('whatsapp:sendMessage', (chatId: string, text: string) => whatsappService.sendMessage(chatId, text))
  handle('whatsapp:sendMedia', (chatId: string, data: Uint8Array | ArrayBuffer, mimeType: string, fileName: string, caption?: string) =>
    whatsappService.sendMedia(chatId, data, mimeType, fileName, caption))
  handle('whatsapp:getProfilePicture', (jid: string) => whatsappService.getProfilePicture(jid))
  handle('whatsapp:clearCreds', () => whatsappService.clearCreds())
  handle('whatsapp:clearDatabase', () => whatsappService.clearDatabase())

  instagramService.on('connected', () => broadcast('instagram:connected'))
  instagramService.on('disconnected', () => broadcast('instagram:disconnected'))
  instagramService.on('message', (msg: any) => broadcast('instagram:message', msg))
  instagramService.on('threadsUpdated', (threads: any[]) => broadcast('instagram:threadsUpdated', threads))

  handle('instagram:getStatus', () => instagramService.getStatus())
  handle('instagram:loginWithBrowser', () => instagramService.loginWithBrowser())
  handle('instagram:tryRestore', () => instagramService.tryRestore())
  handle('instagram:logout', () => instagramService.logout())
  handle('instagram:getThreads', () => instagramService.getThreads())
  handle('instagram:getCachedThreads', (folder: string) => instagramService.getCachedThreads((folder as any) || 'main'))
  handle('instagram:getMessages', (threadId: string) => instagramService.getMessages(threadId))
  handle('instagram:getMessagesPage', (threadId: string, cursor?: string) => instagramService.getMessagesPage(threadId, cursor))
  handle('instagram:getThreadsPage', (folder?: string, cursor?: string) => instagramService.getThreadsPage((folder as any) || 'main', cursor))
  handle('instagram:searchThreads', (query: string) => instagramService.searchThreads(query))
  handle('instagram:sendMessage', (threadId: string, text: string) => instagramService.sendMessage(threadId, text))

  handle('app:reload', () => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.reloadIgnoringCache())
  })
  handle('app:clearTokens', async () => {
    try {
      await whatsappService.disconnect()
      await whatsappService.clearCreds()
    } catch (e) {
      debug.log('[IPC] erro disconnect:', e)
    }
    try {
      waClearAll()
      instagramService.logout()
      debug.log('[IPC] tokens limpos')
    } catch (e) {
      debug.log('[IPC] erro clear:', e)
    }
    BrowserWindow.getAllWindows().forEach(w => w.webContents.reloadIgnoringCache())
  })

  handle('debug:getEnabled', () => debug.enabled)

  debug.onToggle((enabled) => {
    broadcast('debug:toggle', enabled)
  })
}
