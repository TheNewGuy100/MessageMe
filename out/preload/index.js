"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  whatsapp: {
    getStatus: () => electron.ipcRenderer.invoke("whatsapp:getStatus"),
    getQRCode: () => electron.ipcRenderer.invoke("whatsapp:getQRCode"),
    connect: () => electron.ipcRenderer.invoke("whatsapp:connect"),
    disconnect: () => electron.ipcRenderer.invoke("whatsapp:disconnect"),
    getChats: () => electron.ipcRenderer.invoke("whatsapp:getChats"),
    getMessages: (chatId) => electron.ipcRenderer.invoke("whatsapp:getMessages", chatId),
    sendMessage: (chatId, text) => electron.ipcRenderer.invoke("whatsapp:sendMessage", chatId, text),
    getProfilePicture: (jid) => electron.ipcRenderer.invoke("whatsapp:getProfilePicture", jid),
    clearCreds: () => electron.ipcRenderer.invoke("whatsapp:clearCreds")
  },
  instagram: {
    getStatus: () => electron.ipcRenderer.invoke("instagram:getStatus"),
    loginWithBrowser: () => electron.ipcRenderer.invoke("instagram:loginWithBrowser"),
    tryRestore: () => electron.ipcRenderer.invoke("instagram:tryRestore"),
    logout: () => electron.ipcRenderer.invoke("instagram:logout"),
    getThreads: () => electron.ipcRenderer.invoke("instagram:getThreads"),
    getMessages: (threadId) => electron.ipcRenderer.invoke("instagram:getMessages", threadId),
    sendMessage: (threadId, text) => electron.ipcRenderer.invoke("instagram:sendMessage", threadId, text)
  },
  app: {
    reload: () => electron.ipcRenderer.invoke("app:reload"),
    hardReload: () => electron.ipcRenderer.invoke("app:hardReload"),
    clearTokens: () => electron.ipcRenderer.invoke("app:clearTokens")
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
