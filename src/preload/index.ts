import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  whatsapp: {
    getStatus: () => ipcRenderer.invoke('whatsapp:getStatus'),
    getQRCode: () => ipcRenderer.invoke('whatsapp:getQRCode'),
    connect: () => ipcRenderer.invoke('whatsapp:connect'),
    disconnect: () => ipcRenderer.invoke('whatsapp:disconnect'),
    getChats: () => ipcRenderer.invoke('whatsapp:getChats'),
    getMessages: (chatId: string) => ipcRenderer.invoke('whatsapp:getMessages', chatId),
    sendMessage: (chatId: string, text: string) => ipcRenderer.invoke('whatsapp:sendMessage', chatId, text),
    getProfilePicture: (jid: string) => ipcRenderer.invoke('whatsapp:getProfilePicture', jid),
    clearCreds: () => ipcRenderer.invoke('whatsapp:clearCreds')
  },
  instagram: {
    getStatus: () => ipcRenderer.invoke('instagram:getStatus'),
    loginWithBrowser: () => ipcRenderer.invoke('instagram:loginWithBrowser'),
    tryRestore: () => ipcRenderer.invoke('instagram:tryRestore'),
    logout: () => ipcRenderer.invoke('instagram:logout'),
    getThreads: () => ipcRenderer.invoke('instagram:getThreads'),
    getMessages: (threadId: string) => ipcRenderer.invoke('instagram:getMessages', threadId),
    sendMessage: (threadId: string, text: string) => ipcRenderer.invoke('instagram:sendMessage', threadId, text)
  },
  app: {
    reload: () => ipcRenderer.invoke('app:reload'),
    hardReload: () => ipcRenderer.invoke('app:hardReload'),
    clearTokens: () => ipcRenderer.invoke('app:clearTokens')
  },
  onEvent: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  removeListener: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
