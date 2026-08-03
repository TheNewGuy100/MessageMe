/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    whatsapp: {
      getStatus: () => Promise<string>
      getQRCode: () => Promise<string | null>
      getHistorySyncing: () => Promise<boolean>
      connect: () => Promise<void>
      disconnect: () => Promise<void>
      getChats: () => Promise<any[]>
      getMessages: (chatId: string) => Promise<any[]>
      getOlderMessages: (chatId: string, beforeId: string) => Promise<{ messages: any[]; hasMore: boolean }>
      getMedia: (chatId: string, messageId: string) => Promise<string | null>
      sendMessage: (chatId: string, text: string) => Promise<void>
      getProfilePicture: (jid: string) => Promise<string | null>
      clearCreds: () => Promise<void>
      clearDatabase: () => Promise<void>
    }
    instagram: {
      getStatus: () => Promise<string>
      loginWithBrowser: () => Promise<void>
      tryRestore: () => Promise<void>
      logout: () => Promise<void>
      getThreads: () => Promise<any[]>
      getCachedThreads: (folder?: string) => Promise<any[]>
      getMessages: (threadId: string) => Promise<any[]>
      getMessagesPage: (threadId: string, cursor?: string) => Promise<{ messages: any[]; nextCursor: string | null; hasMore: boolean }>
      getThreadsPage: (folder?: string, cursor?: string) => Promise<{ threads: any[]; nextCursor: string | null; hasMore: boolean }>
      searchThreads: (query: string) => Promise<any[]>
      sendMessage: (threadId: string, text: string) => Promise<void>
    }
    app: {
      reload: () => Promise<void>
      hardReload: () => Promise<void>
      clearTokens: () => Promise<void>
    }
    onEvent: (channel: string, callback: (...args: any[]) => void) => void
    removeListener: (channel: string) => void
  }
}
