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
      open: () => invoke('app:toggleOfficialViews')
   },
   instagram: {
       open: () => invoke('app:toggleOfficialViews'),
       navigate: (section: 'inbox' | 'requests' | 'hidden') => invoke('app:navigateInstagram', section)
   },
  app: {
      reload: () => invoke('app:reload'),
       hardReload: () => invoke('app:hardReload'),
       setSidebarWidth: (width: number) => invoke('app:setSidebarWidth', width),
       setZoom: (percent: number) => invoke('app:setZoom', percent),
        setAudioVolume: (volume: number) => invoke('app:setAudioVolume', volume),
        getAudioVolume: () => invoke<number>('app:getAudioVolume'),
       setViewMode: (mode: 'instagram' | 'whatsapp' | 'both') => invoke('app:setViewMode', mode),
        getUnreadCount: () => invoke<number>('app:getUnreadCount'),
        getWhatsAppUnreadCount: () => invoke<number>('app:getWhatsAppUnreadCount'),
       getInstagramCounts: () => invoke<{ inbox: number; requests: number; hidden: number }>('app:getInstagramCounts'),
        setInstagramAutomation: (enabled: boolean, text: string, automaticReplies: Array<{ message: string; start?: string; end?: string }>) => invoke('app:setInstagramAutomation', enabled, text, automaticReplies),
       setGlobalAutomation: (enabled: boolean) => invoke('app:setGlobalAutomation', enabled),
       getAutomationStatus: () => invoke<{ enabled: boolean; configured: boolean; globalEnabled: boolean; running: boolean }>('app:getAutomationStatus'),
       getAutomationLogs: () => invoke<Array<{ id: string; at: string; platform: 'instagram'; conversation: string; action: 'reply'; status: 'sent' | 'failed'; detail: string }>>('app:getAutomationLogs'),
       clearAutomationLogs: () => invoke('app:clearAutomationLogs'),
       resetAutomationRuntime: () => invoke('app:resetAutomationRuntime'),
       getScheduledMessages: () => invoke<Array<{ id: string; message: string; at: string; createdAt: string; platform: string; conversationId: string | null }>>('app:getScheduledMessages'),
       createScheduledMessage: (item: { id: string; message: string; at: string; createdAt?: string; platform?: string; conversationId?: string | null }) => invoke('app:createScheduledMessage', item),
       deleteScheduledMessage: (id: string) => invoke('app:deleteScheduledMessage', id),
       getAutomationFlows: () => invoke<Array<{ id: string; name: string; enabled: boolean; priority: number; definition: string; createdAt: string; updatedAt: string }>>('app:getAutomationFlows'),
       saveAutomationFlow: (flow: { id: string; name: string; enabled: boolean; priority?: number; definition: string; createdAt?: string }) => invoke('app:saveAutomationFlow', flow),
       deleteAutomationFlow: (id: string) => invoke('app:deleteAutomationFlow', id),
        openDialog: (type: 'dashboard' | 'automation' | 'appointments' | 'logs') => invoke('app:openDialog', type),
      closeDialog: () => invoke('app:closeDialog')
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
