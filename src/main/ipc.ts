import { ipcMain, BrowserWindow } from 'electron'
import { whatsappService } from './whatsapp'
import { instagramService } from './instagram'
import { waClearAll } from './database'

function broadcast(event: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(event, ...args))
}

export function registerIpcHandlers() {
  whatsappService.on('connecting', () => broadcast('whatsapp:connecting'))
  whatsappService.on('qr', (qr: string) => broadcast('whatsapp:qr', qr))
  whatsappService.on('connected', () => broadcast('whatsapp:connected'))
  whatsappService.on('disconnected', (reason: string) => broadcast('whatsapp:disconnected', reason))
  whatsappService.on('error', (msg: string) => broadcast('whatsapp:error', msg))
  whatsappService.on('message', (msg: any) => broadcast('whatsapp:message', msg))
  whatsappService.on('chatsUpdated', (chats: any[]) => broadcast('whatsapp:chatsUpdated', chats))

  ipcMain.handle('whatsapp:getStatus', () => whatsappService.getStatus())
  ipcMain.handle('whatsapp:getQRCode', () => whatsappService.getQRCode())
  ipcMain.handle('whatsapp:connect', () => whatsappService.connect())
  ipcMain.handle('whatsapp:disconnect', () => whatsappService.disconnect())
  ipcMain.handle('whatsapp:getChats', () => whatsappService.getChats())
  ipcMain.handle('whatsapp:getMessages', (_e, chatId: string) => whatsappService.getMessages(chatId))
  ipcMain.handle('whatsapp:sendMessage', (_e, chatId: string, text: string) => whatsappService.sendMessage(chatId, text))
  ipcMain.handle('whatsapp:getProfilePicture', (_e, jid: string) => whatsappService.getProfilePicture(jid))
  ipcMain.handle('whatsapp:clearCreds', () => whatsappService.clearCreds())

  instagramService.on('connected', () => broadcast('instagram:connected'))
  instagramService.on('disconnected', () => broadcast('instagram:disconnected'))
  instagramService.on('message', (msg: any) => broadcast('instagram:message', msg))
  instagramService.on('threadsUpdated', (threads: any[]) => broadcast('instagram:threadsUpdated', threads))

  ipcMain.handle('instagram:getStatus', () => instagramService.getStatus())
  ipcMain.handle('instagram:loginWithBrowser', async () => {
    await instagramService.loginWithBrowser()
  })
  ipcMain.handle('instagram:tryRestore', async () => {
    await instagramService.tryRestore()
  })
  ipcMain.handle('instagram:logout', () => instagramService.logout())
  ipcMain.handle('instagram:getThreads', () => instagramService.getThreads())
  ipcMain.handle('instagram:getMessages', (_e, threadId: string) => instagramService.getMessages(threadId))
  ipcMain.handle('instagram:sendMessage', (_e, threadId: string, text: string) => instagramService.sendMessage(threadId, text))

  ipcMain.handle('app:reload', () => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.reloadIgnoringCache())
  })
  ipcMain.handle('app:clearTokens', async () => {
    try {
      await whatsappService.disconnect()
    } catch (e) {
      console.log('[IPC] erro disconnect:', e)
    }
    try {
      waClearAll()
      instagramService.logout()
      console.log('[IPC] tokens limpos')
    } catch (e) {
      console.log('[IPC] erro clear:', e)
    }
    BrowserWindow.getAllWindows().forEach(w => w.webContents.reloadIgnoringCache())
  })
}
