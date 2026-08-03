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
    getStatus: () => invoke("whatsapp:getStatus"),
    getQRCode: () => invoke("whatsapp:getQRCode"),
    getHistorySyncing: () => invoke("whatsapp:getHistorySyncing"),
    connect: () => invoke("whatsapp:connect"),
    disconnect: () => invoke("whatsapp:disconnect"),
    getChats: () => invoke("whatsapp:getChats"),
    getMessages: (chatId) => invoke("whatsapp:getMessages", chatId),
    getOlderMessages: (chatId, beforeId) => invoke("whatsapp:getOlderMessages", chatId, beforeId),
    getMedia: (chatId, messageId) => invoke("whatsapp:getMedia", chatId, messageId),
    sendMessage: (chatId, text) => invoke("whatsapp:sendMessage", chatId, text),
    sendMedia: (chatId, data, mimeType, fileName, caption) => invoke("whatsapp:sendMedia", chatId, data, mimeType, fileName, caption),
    getProfilePicture: (jid) => invoke("whatsapp:getProfilePicture", jid),
    clearCreds: () => invoke("whatsapp:clearCreds"),
    clearDatabase: () => invoke("whatsapp:clearDatabase")
  },
  instagram: {
    getStatus: () => invoke("instagram:getStatus"),
    loginWithBrowser: () => invoke("instagram:loginWithBrowser"),
    tryRestore: () => invoke("instagram:tryRestore"),
    logout: () => invoke("instagram:logout"),
    getThreads: () => invoke("instagram:getThreads"),
    getCachedThreads: (folder) => invoke("instagram:getCachedThreads", folder || "main"),
    getMessages: (threadId) => invoke("instagram:getMessages", threadId),
    getMessagesPage: (threadId, cursor) => invoke("instagram:getMessagesPage", threadId, cursor),
    getThreadsPage: (folder, cursor) => invoke("instagram:getThreadsPage", folder, cursor),
    searchThreads: (query) => invoke("instagram:searchThreads", query),
    sendMessage: (threadId, text) => invoke("instagram:sendMessage", threadId, text)
  },
  app: {
    reload: () => invoke("app:reload"),
    hardReload: () => invoke("app:hardReload"),
    clearTokens: () => invoke("app:clearTokens")
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
