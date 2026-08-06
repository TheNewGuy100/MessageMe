/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    whatsapp: {
       open: () => Promise<boolean>
    }
    instagram: {
       open: () => Promise<boolean>
       navigate: (section: 'inbox' | 'requests' | 'hidden') => Promise<void>
    }
    app: {
       reload: () => Promise<void>
        hardReload: () => Promise<void>
        setSidebarWidth: (width: number) => Promise<void>
        setZoom: (percent: number) => Promise<void>
        setAudioVolume: (volume: number) => Promise<void>
        getAudioVolume: () => Promise<number>
        setViewMode: (mode: 'instagram' | 'whatsapp' | 'both') => Promise<void>
        getUnreadCount: () => Promise<number>
        getWhatsAppUnreadCount: () => Promise<number>
        getInstagramCounts: () => Promise<{ inbox: number; requests: number; hidden: number }>
        setInstagramAutomation: (enabled: boolean, text: string, automaticReplies: Array<{ message: string; start?: string; end?: string }>) => Promise<void>
        setGlobalAutomation: (enabled: boolean) => Promise<void>
        getAutomationStatus: () => Promise<{ enabled: boolean; configured: boolean; globalEnabled: boolean; running: boolean }>
        openDialog: (type: 'dashboard' | 'automation' | 'appointments' | 'logs') => Promise<void>
        closeDialog: () => Promise<void>
        getAutomationLogs: () => Promise<Array<{ id: string; at: string; platform: 'instagram'; conversation: string; action: 'reply'; status: 'sent' | 'failed'; detail: string }>>
        clearAutomationLogs: () => Promise<void>
        resetAutomationRuntime: () => Promise<void>
        getScheduledMessages: () => Promise<Array<{ id: string; message: string; at: string; createdAt: string; platform: string; conversationId: string | null }>>
        createScheduledMessage: (item: { id: string; message: string; at: string; createdAt?: string; platform?: string; conversationId?: string | null }) => Promise<void>
        deleteScheduledMessage: (id: string) => Promise<void>
        getAutomationFlows: () => Promise<Array<{ id: string; name: string; enabled: boolean; priority: number; definition: string; createdAt: string; updatedAt: string }>>
        saveAutomationFlow: (flow: { id: string; name: string; enabled: boolean; priority?: number; definition: string; createdAt?: string }) => Promise<void>
        deleteAutomationFlow: (id: string) => Promise<void>
    }
    onEvent: (channel: string, callback: (...args: any[]) => void) => void
    removeListener: (channel: string) => void
  }
}
