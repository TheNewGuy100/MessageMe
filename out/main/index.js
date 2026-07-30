"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const events = require("events");
const QR = require("qrcode");
const Database = require("better-sqlite3");
const fs = require("fs");
let db;
function getDb() {
  if (!db) {
    const dir = path.join(electron.app.getPath("userData"), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(path.join(dir, "message-manager.db"));
    db.pragma("journal_mode = WAL");
    initSchema();
  }
  return db;
}
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (namespace, key)
    );

    CREATE TABLE IF NOT EXISTS wa_creds (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_keys (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
}
function storeGet(namespace, key) {
  const row = getDb().prepare("SELECT value FROM store WHERE namespace = ? AND key = ?").get(namespace, key);
  return row?.value;
}
function storeSet(namespace, key, value) {
  getDb().prepare("INSERT OR REPLACE INTO store (namespace, key, value) VALUES (?, ?, ?)").run(namespace, key, value);
}
function storeDelete(namespace, key) {
  getDb().prepare("DELETE FROM store WHERE namespace = ? AND key = ?").run(namespace, key);
}
function waGetCreds() {
  const row = getDb().prepare("SELECT data FROM wa_creds WHERE id = 1").get();
  return row?.data;
}
function waSetCreds(data) {
  getDb().prepare("INSERT OR REPLACE INTO wa_creds (id, data) VALUES (1, ?)").run(data);
}
function waGetKey(id) {
  const row = getDb().prepare("SELECT data FROM wa_keys WHERE id = ?").get(id);
  return row?.data;
}
function waSetKey(id, data) {
  getDb().prepare("INSERT OR REPLACE INTO wa_keys (id, data) VALUES (?, ?)").run(id, data);
}
function waClearAll() {
  const d = getDb();
  d.prepare("DELETE FROM wa_creds").run();
  d.prepare("DELETE FROM wa_keys").run();
  d.prepare("DELETE FROM store WHERE namespace = ?").run("instagram");
}
let initAuthCreds;
let BufferJSON;
async function loadInitCreds() {
  if (!initAuthCreds) {
    const m = await import("@whiskeysockets/baileys");
    initAuthCreds = m.initAuthCreds;
    BufferJSON = m.BufferJSON;
  }
}
function makeKeyStore() {
  const get = async (type, ids) => {
    const data = {};
    for (const id of ids) {
      const val = waGetKey(`${type}:${id}`);
      if (val) data[id] = JSON.parse(val, BufferJSON.reviver);
    }
    return data;
  };
  const set = async (data) => {
    for (const id in data) {
      waSetKey(id, JSON.stringify(data[id], BufferJSON.replacer));
    }
  };
  return { get, set };
}
async function useSqliteAuthState() {
  await loadInitCreds();
  let creds;
  const credsRaw = waGetCreds();
  if (credsRaw) {
    creds = JSON.parse(credsRaw, BufferJSON.reviver);
  } else {
    creds = initAuthCreds();
    waSetCreds(JSON.stringify(creds, BufferJSON.replacer));
  }
  const keys = makeKeyStore();
  const saveCreds = () => {
    if (creds) waSetCreds(JSON.stringify(creds, BufferJSON.replacer));
  };
  return { state: { creds, keys }, saveCreds };
}
let makeWASocket, DisconnectReason;
async function loadBaileys() {
  const m = await import("@whiskeysockets/baileys");
  makeWASocket = m.default;
  DisconnectReason = m.DisconnectReason;
}
function makeLogger(label) {
  const noop = () => {
  };
  const log = (fn) => (msg, ...args) => {
    if (typeof msg === "string") console.log(`[WA:${label}] ${fn}:`, msg, ...args);
    else console.log(`[WA:${label}] ${fn}:`, msg);
  };
  const child = () => makeLogger(label + ".c");
  return { info: log("info"), warn: log("warn"), error: log("error"), debug: noop, trace: noop, fatal: log("fatal"), child };
}
class WhatsAppService extends events.EventEmitter {
  sock = null;
  qrBase64 = null;
  status = "disconnected";
  chats = [];
  messagesByChat = /* @__PURE__ */ new Map();
  initPromise = null;
  saveCreds = null;
  reconnectTimer = null;
  connecting = false;
  qrTimeout = null;
  getStatus() {
    return this.status;
  }
  getQRCode() {
    return this.qrBase64;
  }
  getChats() {
    return this.chats;
  }
  getMessages(chatId) {
    return (this.messagesByChat.get(chatId) || []).slice(-50);
  }
  storeMessage(msg) {
    const chatId = msg.key?.remoteJid;
    if (!chatId) return;
    let msgs = this.messagesByChat.get(chatId);
    if (!msgs) {
      msgs = [];
      this.messagesByChat.set(chatId, msgs);
    }
    const idx = msgs.findIndex((m) => m.key?.id === msg.key?.id);
    if (idx === -1) msgs.push(msg);
    else msgs[idx] = msg;
    if (msgs.length > 100) msgs.splice(0, msgs.length - 100);
  }
  async getProfilePicture(jid) {
    if (!this.sock) return null;
    try {
      return await this.sock.profilePictureUrl(jid);
    } catch {
      return null;
    }
  }
  async clearCreds() {
    waClearAll();
  }
  async sendMessage(chatId, text) {
    if (!this.sock) throw new Error("WhatsApp não conectado");
    await this.sock.sendMessage(chatId, { text });
  }
  async ensureBaileys() {
    if (!this.initPromise) this.initPromise = loadBaileys();
    await this.initPromise;
  }
  setStatus(s) {
    this.status = s;
    this.emit(s);
  }
  async connect() {
    await this.ensureBaileys();
    if (this.connecting) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = true;
    this.setStatus("connecting");
    console.log("[WA] connect() chamado");
    const { state, saveCreds } = await useSqliteAuthState();
    this.saveCreds = saveCreds;
    if (state?.creds?.noiseKey) {
      const nk = state.creds.noiseKey;
      console.log("[WA] noiseKey.public type:", nk.public?.constructor?.name, "isBuffer:", Buffer.isBuffer(nk.public));
      console.log("[WA] noiseKey.private type:", nk.private?.constructor?.name, "isBuffer:", Buffer.isBuffer(nk.private));
    } else {
      console.log("[WA] WARNING: noiseKey is missing!");
    }
    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: makeLogger("main"),
      qrTimeout: 3e4,
      shouldSyncHistoryMessage: () => true
    });
    this.sock.ev.on("creds.update", saveCreds);
    this.sock.ev.on("connection.update", async (update) => {
      const keys = Object.keys(update);
      console.log("[WA] connection.update:", JSON.stringify(keys), update.qr ? "qr" : "", update.connection || "", JSON.stringify(update.lastDisconnect?.error?.message));
      if (update.qr) {
        let qrData = update.qr;
        const hashIdx = qrData.indexOf("#");
        if (hashIdx !== -1) {
          qrData = qrData.substring(hashIdx + 1);
          const parts = qrData.split(",");
          if (parts.length === 5) qrData = parts.slice(0, 4).join(",");
        }
        console.log("[WA] QR CODE RECEBIDO");
        this.qrBase64 = await QR.toDataURL(qrData);
        this.emit("qr", this.qrBase64);
        if (this.qrTimeout) {
          clearTimeout(this.qrTimeout);
          this.qrTimeout = null;
        }
      }
      if (update.connection === "open") {
        console.log("[WA] CONECTADO!");
        this.connecting = false;
        this.qrBase64 = null;
        this.setStatus("connected");
        await this.loadChats();
      }
      if (update.connection === "close") {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        console.log("[WA] desconectado, motivo:", code);
        const shouldReconnect = !(code === DisconnectReason.loggedOut || code === 401);
        this.connecting = false;
        this.sock = null;
        this.qrBase64 = null;
        this.setStatus("disconnected");
        if (shouldReconnect) {
          console.log("[WA] reconectando em 5s...");
          this.reconnectTimer = setTimeout(() => this.connect(), 5e3);
        }
      }
    });
    this.sock.ev.on("messaging-history.set", ({ chats, messages }) => {
      if (chats) {
        for (const chat of chats) {
          const idx = this.chats.findIndex((c) => c.id === chat.id);
          if (idx === -1) this.chats.push(chat);
        }
      }
      if (messages) {
        for (const msg of messages) this.storeMessage(msg);
      }
      this.emit("chatsUpdated", this.chats);
    });
    this.sock.ev.on("chats.upsert", (chats) => {
      for (const chat of chats || []) {
        const idx = this.chats.findIndex((c) => c.id === chat.id);
        if (idx === -1) this.chats.push(chat);
        else this.chats[idx] = { ...this.chats[idx], ...chat };
      }
      this.emit("chatsUpdated", this.chats);
    });
    this.sock.ev.on("chats.update", (updates) => {
      for (const update of updates || []) {
        const idx = this.chats.findIndex((c) => c.id === update.id);
        if (idx !== -1) Object.assign(this.chats[idx], update);
      }
      this.emit("chatsUpdated", this.chats);
    });
    this.sock.ev.on("chats.delete", (ids) => {
      this.chats = this.chats.filter((c) => !ids.includes(c.id));
      this.emit("chatsUpdated", this.chats);
    });
    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages) {
        this.storeMessage(msg);
        if (msg.key?.remoteJid) this.emit("message", msg);
      }
    });
    this.qrTimeout = setTimeout(() => {
      if (this.connecting && !this.qrBase64) {
        console.log("[WA] TIMEOUT: QR não gerado após 30s");
        this.emit("error", "QR Code não foi gerado. Verifique sua conexão com a internet.");
        this.disconnect();
      }
    }, 3e4);
  }
  async loadChats() {
    if (!this.sock) return;
    this.emit("chatsUpdated", this.chats);
  }
  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }
    this.connecting = false;
    this.sock?.end(new Error("manual disconnect"));
    this.sock = null;
    this.setStatus("disconnected");
  }
}
const whatsappService = new WhatsAppService();
let enabled = false;
const toggleListeners = [];
function timestamp() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("pt-BR");
}
function toWindows(event, ...args) {
  electron.BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(event, ...args));
}
function notifyToggle() {
  toggleListeners.forEach((fn) => fn(enabled));
}
const debug = {
  get enabled() {
    return enabled;
  },
  enable() {
    if (enabled) return;
    enabled = true;
    console.log("[DEBUG] modo debug ativado");
    toWindows("debug:log", "[DEBUG] modo debug ativado");
    notifyToggle();
  },
  disable() {
    if (!enabled) return;
    console.log("[DEBUG] modo debug desativado");
    toWindows("debug:log", "[DEBUG] modo debug desativado");
    enabled = false;
    notifyToggle();
  },
  send(type, ...args) {
    if (!enabled) return;
    const tag = `[${timestamp()}]`;
    if (type === "error") {
      console.error(tag, ...args);
      toWindows("debug:error", tag, ...args);
    } else {
      console.log(tag, ...args);
      toWindows("debug:log", tag, ...args);
    }
  },
  log(...args) {
    debug.send("log", ...args);
  },
  error(...args) {
    debug.send("error", ...args);
  },
  ipc(channel, direction, data) {
    if (!enabled) return;
    const prefix = direction === "send" ? ">>" : direction === "result" ? "<<" : "!!";
    const tag = `[${timestamp()}] [IPC] ${prefix} ${channel}`;
    console.log(tag, data !== void 0 ? data : "");
    toWindows("debug:ipc", { channel, direction, data, tag });
  },
  onToggle(fn) {
    toggleListeners.push(fn);
  }
};
function watchDevtools(window) {
  window.webContents.on("devtools-opened", () => debug.enable());
  window.webContents.on("devtools-closed", () => debug.disable());
  if (window.webContents.isDevToolsOpened()) debug.enable();
}
const IG_APP_ID = process.env.IG_APP_ID || "936619743392459";
const BASE = process.env.IG_BASE_URL || "https://www.instagram.com";
const API = `${BASE}/api/v1`;
const USER_AGENT = process.env.IG_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
class InstagramService extends events.EventEmitter {
  cookies = null;
  status = "disconnected";
  threads = [];
  pollTimer = null;
  getStatus() {
    return this.status;
  }
  getThreads() {
    return this.threads;
  }
  cookieString() {
    if (!this.cookies) return "";
    return `sessionid=${this.cookies.sessionid}; csrftoken=${this.cookies.csrftoken}; ds_user_id=${this.cookies.ds_user_id}`;
  }
  async igFetch(path2, options = {}) {
    const url = path2.startsWith("http") ? path2 : `${API}${path2}`;
    debug.log("[IG] fetch", options.method || "GET", url);
    const headers = {
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "X-IG-App-ID": IG_APP_ID,
      "X-CSRFToken": this.cookies?.csrftoken ?? "",
      "Cookie": this.cookieString(),
      "Origin": BASE,
      "Referer": `${BASE}/`,
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Accept-Encoding": "gzip, deflate, br"
    };
    if (options.body && !(options.body instanceof URLSearchParams)) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, redirect: "follow" });
    debug.log("[IG] response", res.status, res.statusText);
    if (!res.ok) {
      const text = await res.text();
      debug.log("[IG] error body", text);
      throw new Error(`Instagram API ${res.status}: ${text}`);
    }
    return res.json();
  }
  async loginWithBrowser() {
    return new Promise((resolve, reject) => {
      const win = new electron.BrowserWindow({
        width: 480,
        height: 800,
        resizable: false,
        title: "Login Instagram",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      win.loadURL(`${BASE}/accounts/login/`);
      const checkDone = async (url) => {
        if (url.includes("/direct/inbox/") || url === `${BASE}/` || url === BASE) {
          await new Promise((r) => setTimeout(r, 1500));
          const allCookies = await win.webContents.session.cookies.get({ url: BASE });
          const sid = allCookies.find((c) => c.name === "sessionid");
          const csrf = allCookies.find((c) => c.name === "csrftoken");
          const uid = allCookies.find((c) => c.name === "ds_user_id");
          if (sid?.value && csrf?.value && uid?.value) {
            this.cookies = { sessionid: sid.value, csrftoken: csrf.value, ds_user_id: uid.value };
            storeSet("instagram", "cookies", JSON.stringify(this.cookies));
            win.close();
            this.status = "connected";
            this.emit("connected");
            this.startPolling();
            resolve();
          } else if (!url.includes("/accounts/")) {
            win.close();
            reject(new Error("Não foi possível obter os cookies de sessão"));
          }
        }
      };
      win.webContents.on("did-navigate", (_e, url) => checkDone(url));
      win.on("closed", () => {
        if (!this.cookies) reject(new Error("Janela de login fechada sem concluir"));
      });
    });
  }
  async restoreSession() {
    const raw = storeGet("instagram", "cookies");
    if (!raw) return false;
    try {
      this.cookies = JSON.parse(raw);
      await this.igFetch("/direct_v2/inbox/?persistentBadging=true&limit=1");
      this.status = "connected";
      this.emit("connected");
      this.startPolling();
      return true;
    } catch (e) {
      if (e?.message?.startsWith("Instagram API 401") || e?.message?.startsWith("Instagram API 403")) {
        console.log("[IG] sessão inválida, limpando cookies");
        this.cookies = null;
        storeDelete("instagram", "cookies");
      } else {
        console.log("[IG] restore erro de rede/outro, mantendo cookies:", e?.message || e);
      }
    }
    this.cookies = null;
    return false;
  }
  async tryRestore() {
    await this.restoreSession();
  }
  async logout() {
    this.stopPolling();
    this.cookies = null;
    this.status = "disconnected";
    this.threads = [];
    storeDelete("instagram", "cookies");
    this.emit("disconnected");
  }
  async getMessages(threadId) {
    const data = await this.igFetch(`/direct_v2/threads/${threadId}/`);
    const thread = data.thread || data;
    return (thread.items || []).map((item) => ({
      id: item.item_id || item.id,
      threadId,
      text: item.text || item?.visual_media?.media?.image_versions2?.candidates?.[0]?.url || "",
      senderId: item.user_id?.toString(),
      timestamp: item.timestamp,
      isMine: item.user_id?.toString() === this.cookies?.ds_user_id
    })).reverse();
  }
  async sendMessage(threadId, text) {
    const form = new URLSearchParams();
    form.append("text", text);
    form.append("thread_ids", `["${threadId}"]`);
    form.append("action", "send_item");
    const headers = {
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "X-IG-App-ID": IG_APP_ID,
      "X-CSRFToken": this.cookies?.csrftoken ?? "",
      "Cookie": this.cookieString(),
      "Origin": BASE,
      "Referer": `${BASE}/direct/inbox/`,
      "Content-Type": "application/x-www-form-urlencoded"
    };
    const res = await fetch(`${API}/direct_v2/threads/broadcast/text/`, {
      method: "POST",
      body: form,
      headers,
      redirect: "follow"
    });
    if (!res.ok) {
      const body = await res.text();
      debug.log("[IG] sendMessage response:", res.status, body);
      throw new Error(`Instagram API ${res.status}: ${body}`);
    }
  }
  async startPolling() {
    await this.loadThreads();
    this.pollTimer = setInterval(() => this.loadThreads(), 15e3);
  }
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  async loadThreads() {
    if (!this.cookies) return;
    try {
      const data = await this.igFetch("/direct_v2/inbox/?persistentBadging=true&limit=20");
      console.log("[IG] inbox response keys:", Object.keys(data));
      const inbox = data.inbox || data;
      const threads = inbox.threads || [];
      console.log("[IG] threads count:", threads.length);
      this.threads = threads.map((t) => ({
        id: t.thread_id || t.threadId || t.id,
        name: t.thread_title || t.users?.map((u) => u.username).join(", ") || "Unknown",
        lastMessage: t.last_permanent_item?.text || t.last_item?.text || "",
        lastTimestamp: t.last_activity_at || t.last_item?.timestamp,
        unread: t.has_newer,
        avatarUrl: t.users?.[0]?.profile_pic_url || ""
      }));
      this.emit("threadsUpdated", this.threads);
    } catch (e) {
      debug.log("[IG] erro loadThreads:", e);
    }
  }
}
const instagramService = new InstagramService();
function broadcast(event, ...args) {
  electron.BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(event, ...args));
}
function handle(channel, fn) {
  electron.ipcMain.handle(channel, async (_e, ...args) => {
    debug.ipc(channel, "send", args.length ? args : void 0);
    try {
      const result = await fn(...args);
      debug.ipc(channel, "result", result !== void 0 ? result : "ok");
      return result;
    } catch (e) {
      debug.ipc(channel, "error", e?.message || e);
      throw e;
    }
  });
}
function registerIpcHandlers() {
  whatsappService.on("connecting", () => broadcast("whatsapp:connecting"));
  whatsappService.on("qr", (qr) => broadcast("whatsapp:qr", qr));
  whatsappService.on("connected", () => broadcast("whatsapp:connected"));
  whatsappService.on("disconnected", (reason) => broadcast("whatsapp:disconnected", reason));
  whatsappService.on("error", (msg) => broadcast("whatsapp:error", msg));
  whatsappService.on("message", (msg) => broadcast("whatsapp:message", msg));
  whatsappService.on("chatsUpdated", (chats) => broadcast("whatsapp:chatsUpdated", chats));
  handle("whatsapp:getStatus", () => whatsappService.getStatus());
  handle("whatsapp:getQRCode", () => whatsappService.getQRCode());
  handle("whatsapp:connect", () => whatsappService.connect());
  handle("whatsapp:disconnect", () => whatsappService.disconnect());
  handle("whatsapp:getChats", () => whatsappService.getChats());
  handle("whatsapp:getMessages", (chatId) => whatsappService.getMessages(chatId));
  handle("whatsapp:sendMessage", (chatId, text) => whatsappService.sendMessage(chatId, text));
  handle("whatsapp:getProfilePicture", (jid) => whatsappService.getProfilePicture(jid));
  handle("whatsapp:clearCreds", () => whatsappService.clearCreds());
  instagramService.on("connected", () => broadcast("instagram:connected"));
  instagramService.on("disconnected", () => broadcast("instagram:disconnected"));
  instagramService.on("message", (msg) => broadcast("instagram:message", msg));
  instagramService.on("threadsUpdated", (threads) => broadcast("instagram:threadsUpdated", threads));
  handle("instagram:getStatus", () => instagramService.getStatus());
  handle("instagram:loginWithBrowser", () => instagramService.loginWithBrowser());
  handle("instagram:tryRestore", () => instagramService.tryRestore());
  handle("instagram:logout", () => instagramService.logout());
  handle("instagram:getThreads", () => instagramService.getThreads());
  handle("instagram:getMessages", (threadId) => instagramService.getMessages(threadId));
  handle("instagram:sendMessage", (threadId, text) => instagramService.sendMessage(threadId, text));
  handle("app:reload", () => {
    electron.BrowserWindow.getAllWindows().forEach((w) => w.webContents.reloadIgnoringCache());
  });
  handle("app:clearTokens", async () => {
    try {
      await whatsappService.disconnect();
    } catch (e) {
      debug.log("[IPC] erro disconnect:", e);
    }
    try {
      waClearAll();
      instagramService.logout();
      debug.log("[IPC] tokens limpos");
    } catch (e) {
      debug.log("[IPC] erro clear:", e);
    }
    electron.BrowserWindow.getAllWindows().forEach((w) => w.webContents.reloadIgnoringCache());
  });
  handle("debug:getEnabled", () => debug.enabled);
  debug.onToggle((enabled2) => {
    broadcast("debug:toggle", enabled2);
  });
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Message Manager",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  watchDevtools(mainWindow);
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
