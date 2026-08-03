import { contextBridge, ipcRenderer } from 'electron'

async function invoke<T>(channel: string, ...args: any[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (result && typeof result === 'object' && '__ipcError' in result) {
    throw new Error(String((result as { __ipcError: unknown }).__ipcError))
  }
  return result as T
}

contextBridge.exposeInMainWorld('electronAPI', {
  whatsapp: {
     getStatus: () => invoke('whatsapp:getStatus'),
     getQRCode: () => invoke('whatsapp:getQRCode'),
     getHistorySyncing: () => invoke('whatsapp:getHistorySyncing'),
     connect: () => invoke('whatsapp:connect'),
     disconnect: () => invoke('whatsapp:disconnect'),
     getChats: () => invoke('whatsapp:getChats'),
     getMessages: (chatId: string) => invoke('whatsapp:getMessages', chatId),
     getOlderMessages: (chatId: string, beforeId: string) => invoke('whatsapp:getOlderMessages', chatId, beforeId),
     getMedia: (chatId: string, messageId: string) => invoke('whatsapp:getMedia', chatId, messageId),
     sendMessage: (chatId: string, text: string) => invoke('whatsapp:sendMessage', chatId, text),
    sendMedia: (chatId: string, data: Uint8Array, mimeType: string, fileName: string, caption?: string) =>
       invoke('whatsapp:sendMedia', chatId, data, mimeType, fileName, caption),
     getProfilePicture: (jid: string) => invoke('whatsapp:getProfilePicture', jid),
     clearCreds: () => invoke('whatsapp:clearCreds'),
     clearDatabase: () => invoke('whatsapp:clearDatabase')
  },
  instagram: {
     getStatus: () => invoke('instagram:getStatus'),
     loginWithBrowser: () => invoke('instagram:loginWithBrowser'),
     tryRestore: () => invoke('instagram:tryRestore'),
     logout: () => invoke('instagram:logout'),
     getThreads: () => invoke('instagram:getThreads'),
     getCachedThreads: (folder?: string) => invoke('instagram:getCachedThreads', folder || 'main'),
     getMessages: (threadId: string) => invoke('instagram:getMessages', threadId),
     getMessagesPage: (threadId: string, cursor?: string) => invoke('instagram:getMessagesPage', threadId, cursor),
     getThreadsPage: (folder?: string, cursor?: string) => invoke('instagram:getThreadsPage', folder, cursor),
     searchThreads: (query: string) => invoke('instagram:searchThreads', query),
     sendMessage: (threadId: string, text: string) => invoke('instagram:sendMessage', threadId, text)
  },
  app: {
     reload: () => invoke('app:reload'),
     hardReload: () => invoke('app:hardReload'),
     clearTokens: () => invoke('app:clearTokens')
  },
  onEvent: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  removeListener: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
  debug: {
    getEnabled: () => ipcRenderer.invoke('debug:getEnabled'),
    onToggle: (callback: (enabled: boolean) => void) => {
      ipcRenderer.on('debug:toggle', (_e, enabled) => callback(enabled))
    }
  }
})
