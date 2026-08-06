"use strict";
const electron = require("electron");
async function invoke(channel, ...args) {
  const result = await electron.ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === "object" && "__ipcError" in result) {
    throw new Error(String(result.__ipcError));
  }
  return result;
}
electron.contextBridge.exposeInMainWorld("electronAPI", {
  whatsapp: {
    open: () => invoke("app:toggleOfficialViews")
  },
  instagram: {
    open: () => invoke("app:toggleOfficialViews"),
    navigate: (section) => invoke("app:navigateInstagram", section)
  },
  app: {
    reload: () => invoke("app:reload"),
    hardReload: () => invoke("app:hardReload"),
    setSidebarWidth: (width) => invoke("app:setSidebarWidth", width),
    setZoom: (percent) => invoke("app:setZoom", percent),
    setAudioVolume: (volume) => invoke("app:setAudioVolume", volume),
    getAudioVolume: () => invoke("app:getAudioVolume"),
    setViewMode: (mode) => invoke("app:setViewMode", mode),
    getUnreadCount: () => invoke("app:getUnreadCount"),
    getWhatsAppUnreadCount: () => invoke("app:getWhatsAppUnreadCount"),
    getInstagramCounts: () => invoke("app:getInstagramCounts"),
    setInstagramAutomation: (enabled, text, automaticReplies) => invoke("app:setInstagramAutomation", enabled, text, automaticReplies),
    setGlobalAutomation: (enabled) => invoke("app:setGlobalAutomation", enabled),
    getAutomationStatus: () => invoke("app:getAutomationStatus"),
    getAutomationLogs: () => invoke("app:getAutomationLogs"),
    clearAutomationLogs: () => invoke("app:clearAutomationLogs"),
    resetAutomationRuntime: () => invoke("app:resetAutomationRuntime"),
    getScheduledMessages: () => invoke("app:getScheduledMessages"),
    createScheduledMessage: (item) => invoke("app:createScheduledMessage", item),
    deleteScheduledMessage: (id) => invoke("app:deleteScheduledMessage", id),
    getAutomationFlows: () => invoke("app:getAutomationFlows"),
    saveAutomationFlow: (flow) => invoke("app:saveAutomationFlow", flow),
    deleteAutomationFlow: (id) => invoke("app:deleteAutomationFlow", id),
    openDialog: (type) => invoke("app:openDialog", type),
    closeDialog: () => invoke("app:closeDialog")
  },
  onEvent: (channel, callback) => {
    electron.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  removeListener: (channel) => {
    electron.ipcRenderer.removeAllListeners(channel);
  },
  debug: {
    getEnabled: () => electron.ipcRenderer.invoke("debug:getEnabled"),
    onToggle: (callback) => {
      electron.ipcRenderer.on("debug:toggle", (_e, enabled) => callback(enabled));
    }
  }
});
