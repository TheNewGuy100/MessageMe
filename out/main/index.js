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

    CREATE TABLE IF NOT EXISTS wa_chats (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_timestamp INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_wa_messages_chat_time
      ON wa_messages (chat_id, message_timestamp);

    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wa_outbox_pending
      ON wa_outbox (status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS instagram_threads (
      folder TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (folder, id)
    );

    CREATE INDEX IF NOT EXISTS idx_instagram_threads_folder
      ON instagram_threads (folder, updated_at);
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
function waDeleteKey(id) {
  getDb().prepare("DELETE FROM wa_keys WHERE id = ?").run(id);
}
function waClearAll() {
  const d = getDb();
  d.prepare("DELETE FROM wa_creds").run();
  d.prepare("DELETE FROM wa_keys").run();
  d.prepare("DELETE FROM store WHERE namespace = ?").run("instagram");
  d.prepare("DELETE FROM store WHERE namespace = ?").run("whatsapp");
  d.prepare("DELETE FROM wa_chats").run();
  d.prepare("DELETE FROM wa_messages").run();
  d.prepare("DELETE FROM wa_outbox").run();
  d.prepare("DELETE FROM instagram_threads").run();
}
function waClearData() {
  const d = getDb();
  d.prepare("DELETE FROM store WHERE namespace = ?").run("whatsapp");
  d.prepare("DELETE FROM wa_chats").run();
  d.prepare("DELETE FROM wa_messages").run();
  d.prepare("DELETE FROM wa_outbox").run();
}
function instagramUpsertThreads(folder, threads) {
  const statement = getDb().prepare(`
    INSERT INTO instagram_threads (folder, id, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(folder, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);
  const transaction = getDb().transaction((items) => {
    const now = Date.now();
    for (const thread of items || []) {
      if (thread?.id) statement.run(folder, String(thread.id), JSON.stringify(thread), now);
    }
  });
  transaction(threads);
}
function instagramReplaceThreads(folder, threads) {
  const db2 = getDb();
  const replace = db2.transaction((items) => {
    db2.prepare("DELETE FROM instagram_threads WHERE folder = ?").run(folder);
    const now = Date.now();
    const insert = db2.prepare(`
      INSERT INTO instagram_threads (folder, id, data, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const thread of items || []) {
      if (thread?.id) insert.run(folder, String(thread.id), JSON.stringify(thread), now);
    }
  });
  replace(threads);
}
function instagramListThreads(folder) {
  return getDb().prepare(`
    SELECT id, data FROM instagram_threads
    WHERE folder = ? ORDER BY updated_at DESC
  `).all(folder);
}
function instagramClearThreads(folder) {
  getDb().prepare("DELETE FROM instagram_threads").run();
}
function waUpsertChat(id, data) {
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO wa_chats (id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(id, data, now);
}
function waListChats() {
  return getDb().prepare("SELECT id, data FROM wa_chats ORDER BY updated_at ASC").all();
}
function waUpsertMessage(chatId, messageId, timestamp2, data) {
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO wa_messages (chat_id, message_id, message_timestamp, data, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, message_id) DO UPDATE SET
      message_timestamp = excluded.message_timestamp,
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(chatId, messageId, timestamp2, data, now);
}
function waListMessages(chatId) {
  return getDb().prepare("SELECT chat_id, message_id, data FROM wa_messages").all();
}
function waEnqueueOutbox(chatId, kind, data) {
  const now = Date.now();
  const result = getDb().prepare(`
    INSERT INTO wa_outbox (chat_id, kind, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, kind, data, now, now);
  return Number(result.lastInsertRowid);
}
function waListPendingOutbox() {
  return getDb().prepare(`
    SELECT * FROM wa_outbox
    WHERE status = 'pending' AND next_attempt_at <= ?
    ORDER BY id ASC
  `).all(Date.now());
}
function waRecoverOutbox() {
  getDb().prepare(`
    UPDATE wa_outbox
    SET status = 'pending', next_attempt_at = 0, updated_at = ?
    WHERE status = 'sending'
  `).run(Date.now());
}
function waUpdateOutbox(id, status, attempts, error, nextAttemptAt = 0) {
  getDb().prepare(`
    UPDATE wa_outbox
    SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, attempts, error || null, nextAttemptAt, Date.now(), id);
}
let initAuthCreds;
let BufferJSON$1;
async function loadInitCreds() {
  if (!initAuthCreds) {
    const m = await import("@whiskeysockets/baileys");
    initAuthCreds = m.initAuthCreds;
    BufferJSON$1 = m.BufferJSON;
  }
}
function makeKeyStore() {
  const get = async (type, ids) => {
    const data = {};
    for (const id of ids) {
      const val = waGetKey(`${type}:${id}`);
      if (val) data[id] = JSON.parse(val, BufferJSON$1.reviver);
    }
    return data;
  };
  const set = async (data) => {
    for (const type in data) {
      for (const id in data[type]) {
        const key = `${type}:${id}`;
        const value = data[type][id];
        if (value === null) {
          waDeleteKey(key);
        } else {
          waSetKey(key, JSON.stringify(value, BufferJSON$1.replacer));
        }
      }
    }
  };
  return { get, set };
}
async function useSqliteAuthState() {
  await loadInitCreds();
  let creds;
  const credsRaw = waGetCreds();
  if (credsRaw) {
    creds = JSON.parse(credsRaw, BufferJSON$1.reviver);
  } else {
    creds = initAuthCreds();
    waSetCreds(JSON.stringify(creds, BufferJSON$1.replacer));
  }
  const keys = makeKeyStore();
  const saveCreds = () => {
    if (creds) waSetCreds(JSON.stringify(creds, BufferJSON$1.replacer));
  };
  return { state: { creds, keys }, saveCreds };
}
let enabled = true;
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
  networkError(...args) {
    if (!enabled) return;
    const tag = `[${timestamp()}] [NETWORK]`;
    console.error(tag, ...args);
    toWindows("debug:network-error", tag, ...args);
  },
  renderError(...args) {
    if (!enabled) return;
    const tag = `[${timestamp()}] [RENDER]`;
    console.error(tag, ...args);
    toWindows("debug:render-error", tag, ...args);
  },
  browserLog(...args) {
    if (!enabled) return;
    toWindows("debug:log", `[${timestamp()}]`, ...args);
  },
  ipc(channel, direction, data) {
    if (!enabled) return;
    const prefix = direction === "send" ? ">>" : direction === "result" ? "<<" : "!!";
    const tag = `[${timestamp()}] [IPC] ${prefix} ${channel}`;
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
let makeWASocket, downloadMediaMessage, BufferJSON;
async function loadBaileys() {
  const m = await import("@whiskeysockets/baileys");
  makeWASocket = m.default;
  downloadMediaMessage = m.downloadMediaMessage;
  BufferJSON = m.BufferJSON;
}
function makeLogger(label) {
  const noop = () => {
  };
  const log = (fn) => (msg, ...args) => {
    if (msg && typeof msg === "object" && "histNotification" in msg) {
      debug.browserLog(`[WA:${label}] ${fn}:`, msg, ...args);
      return;
    }
    if (typeof msg === "string") console.log(`[WA:${label}] ${fn}:`, msg, ...args);
    else console.log(`[WA:${label}] ${fn}:`, msg);
  };
  const child = () => makeLogger(label + ".c");
  return { info: log("info"), warn: log("warn"), error: log("error"), debug: noop, trace: noop, fatal: log("fatal"), child };
}
function timestampValue(value) {
  if (value && typeof value === "object" && typeof value.low === "number") {
    return value.low + (value.high || 0) * 4294967296;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
function chatTimestamp(chat) {
  return Math.max(
    timestampValue(chat?.conversationTimestamp),
    timestampValue(chat?.lastMessage?.messageTimestamp),
    timestampValue(chat?.lastMessageTimestamp),
    timestampValue(chat?.lastTimestamp),
    timestampValue(chat?.timestamp)
  );
}
function messageTimestamp(message) {
  const value = message?.messageTimestamp ?? message?.timestamp ?? message?.message?.messageTimestamp;
  return timestampValue(value);
}
function sortMessages(messages) {
  return messages.map((message, index) => ({ message, index })).sort((a, b) => {
    const timestampDifference = messageTimestamp(a.message) - messageTimestamp(b.message);
    if (timestampDifference) return timestampDifference;
    const idDifference = String(a.message.key?.id || a.message.id || "").localeCompare(String(b.message.key?.id || b.message.id || ""));
    return idDifference || a.index - b.index;
  }).map(({ message }) => message);
}
function hasMessagePayload(message) {
  if (!message?.message || typeof message.message !== "object") return false;
  return Object.keys(message.message).some((key) => key !== "protocolMessage" && key !== "messageContextInfo");
}
function latestMessage(messages) {
  return sortMessages(messages.filter(hasMessagePayload)).at(-1);
}
function disconnectDetails(error) {
  if (!error) return null;
  const output = error.output || {};
  const data = output.payload?.data ?? output.data ?? error.data;
  return {
    name: error.name,
    message: error.message,
    statusCode: output.statusCode ?? error.statusCode,
    data: typeof data === "string" || typeof data === "number" ? data : void 0,
    stack: error.stack
  };
}
function contactKeys(value) {
  if (!value) return [];
  const key = String(value);
  const bare = key.split("@")[0];
  return [...new Set([key, bare].filter(Boolean))];
}
function isPlaceholderName(name, chatId) {
  if (!name) return true;
  const normalizedName = String(name).replace(/[^0-9]/g, "");
  const normalizedId = String(chatId || "").split("@")[0].replace(/[^0-9]/g, "");
  return Boolean(normalizedName && normalizedId && normalizedName === normalizedId);
}
class WhatsAppService extends events.EventEmitter {
  sock = null;
  qrBase64 = null;
  status = "disconnected";
  chats = [];
  contactNames = /* @__PURE__ */ new Map();
  messagesByChat = /* @__PURE__ */ new Map();
  initPromise = null;
  saveCreds = null;
  reconnectTimer = null;
  connecting = false;
  qrTimeout = null;
  historySyncing = false;
  cacheLoaded = false;
  persistTimer = null;
  historyFetches = 0;
  historyCompleteTimer = null;
  historyStatusComplete = false;
  outboxRunning = false;
  getStatus() {
    return this.status;
  }
  getQRCode() {
    return this.qrBase64;
  }
  getHistorySyncing() {
    return this.historySyncing;
  }
  getChats() {
    return this.sortedChats();
  }
  getMessages(chatId) {
    return sortMessages([...this.messagesByChat.get(chatId) || []].filter(hasMessagePayload)).slice(-50);
  }
  async getOlderMessages(chatId, beforeId) {
    const getSorted = () => sortMessages([...this.messagesByChat.get(chatId) || []].filter(hasMessagePayload));
    let messages = getSorted();
    let index = messages.findIndex((message) => message.key?.id === beforeId);
    if (index <= 0 && this.sock && messages[0]?.key) {
      this.historyFetches++;
      try {
        await this.sock.fetchMessageHistory(50, messages[0].key, messageTimestamp(messages[0]));
        await new Promise((resolve) => setTimeout(resolve, 1200));
        messages = getSorted();
        index = messages.findIndex((message) => message.key?.id === beforeId);
      } catch (error) {
        console.warn("[WA] não foi possível buscar mensagens antigas:", error?.message || error);
      } finally {
        this.historyFetches--;
      }
    }
    if (index <= 0) return { messages: [], hasMore: false };
    const older = messages.slice(Math.max(0, index - 50), index);
    return { messages: older, hasMore: index - older.length > 0 };
  }
  async getMedia(chatId, messageId) {
    if (!downloadMediaMessage) await this.ensureBaileys();
    const message = this.messagesByChat.get(chatId)?.find((msg) => msg.key?.id === messageId);
    const content = message?.message?.ephemeralMessage?.message || message?.message?.viewOnceMessage?.message || message?.message;
    if (!content) return null;
    const media = content.imageMessage ? { value: content.imageMessage, type: "image", mime: "image/jpeg" } : content.videoMessage ? { value: content.videoMessage, type: "video", mime: "video/mp4" } : content.audioMessage ? { value: content.audioMessage, type: "audio", mime: "audio/ogg" } : content.stickerMessage ? { value: content.stickerMessage, type: "sticker", mime: "image/webp" } : content.documentMessage ? { value: content.documentMessage, type: "document", mime: "application/octet-stream" } : null;
    if (!media) return null;
    try {
      const buffer = await downloadMediaMessage(message, "buffer", {}, {
        logger: makeLogger("media"),
        reuploadRequest: async (staleMessage) => {
          const updatedMessage = await this.sock.updateMediaMessage(staleMessage);
          this.storeMessage(updatedMessage);
          this.persistCache();
          return updatedMessage;
        }
      });
      const mime = media.value.mimetype || media.mime;
      return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
    } catch (error) {
      return null;
    }
  }
  storeMessage(msg) {
    const chatId = msg.key?.remoteJid;
    if (!chatId || !hasMessagePayload(msg)) return;
    const messageId = msg.key?.id || msg.id;
    if (!messageId) return;
    let msgs = this.messagesByChat.get(chatId);
    if (!msgs) {
      msgs = [];
      this.messagesByChat.set(chatId, msgs);
    }
    const idx = msgs.findIndex((m) => (m.key?.id || m.id) === messageId);
    if (idx === -1) msgs.push(msg);
    else msgs[idx] = msg;
    if (msgs.length > 5e3) msgs.splice(0, msgs.length - 5e3);
    waUpsertMessage(chatId, messageId, messageTimestamp(msg), JSON.stringify(msg, BufferJSON?.replacer));
  }
  persistChats() {
    for (const chat of this.chats) {
      if (chat.id) waUpsertChat(chat.id, JSON.stringify(chat, BufferJSON?.replacer));
    }
  }
  restoreCache() {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const raw = storeGet("whatsapp", "cache");
      const storedChats = waListChats();
      const storedMessages = waListMessages();
      if (storedChats.length) {
        this.chats = storedChats.map((row) => JSON.parse(row.data, BufferJSON?.reviver));
      }
      if (storedMessages.length) {
        this.messagesByChat = /* @__PURE__ */ new Map();
        for (const row of storedMessages) {
          const messages = this.messagesByChat.get(row.chat_id) || [];
          messages.push(JSON.parse(row.data, BufferJSON?.reviver));
          this.messagesByChat.set(row.chat_id, messages);
        }
      }
      if (!storedChats.length && !storedMessages.length && raw) {
        const cache = JSON.parse(raw, BufferJSON?.reviver);
        this.chats = cache.chats || [];
        this.messagesByChat = new Map(cache.messages || []);
      }
      for (const chat of this.chats) {
        const validLastMessage = latestMessage(this.messagesByChat.get(chat.id) || []);
        if (validLastMessage && !hasMessagePayload(chat.lastMessage)) {
          chat.lastMessage = validLastMessage;
          chat.lastTimestamp = messageTimestamp(validLastMessage);
          chat.conversationTimestamp = messageTimestamp(validLastMessage);
        }
      }
      console.log("[WA] cache restaurado:", this.chats.length, "chats");
    } catch (error) {
      console.warn("[WA] não foi possível restaurar cache:", error);
    }
  }
  persistCache() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        storeSet("whatsapp", "cache", JSON.stringify({
          chats: this.chats,
          messages: [...this.messagesByChat.entries()]
        }, BufferJSON?.replacer));
      } catch (error) {
        console.warn("[WA] não foi possível persistir cache:", error);
      }
    }, 1e3);
  }
  mergeChat(chat) {
    const contactName = contactKeys(chat.id).map((key) => this.contactNames.get(key)).find(Boolean);
    if (contactName && isPlaceholderName(chat.name, chat.id)) return { ...chat, name: contactName };
    return chat;
  }
  sortedChats() {
    return [...this.chats].sort((a, b) => chatTimestamp(b) - chatTimestamp(a));
  }
  updateContacts(contacts) {
    for (const contact of contacts || []) {
      const name = contact.name || contact.notify || contact.verifiedName;
      if (!contact.id || !name) continue;
      const aliases = [contact.id, contact.lid, contact.phoneNumber, contact.pnJid].flatMap(contactKeys);
      for (const alias of aliases) this.contactNames.set(alias, name);
      const chat = this.chats.find((item) => aliases.some((alias) => contactKeys(item.id).includes(alias)));
      if (chat && isPlaceholderName(chat.name, chat.id)) chat.name = name;
    }
  }
  ensureChatFromMessage(msg) {
    const chatId = msg.key?.remoteJid;
    if (!chatId || chatId === "status@broadcast" || !hasMessagePayload(msg)) return;
    const timestamp2 = messageTimestamp(msg);
    const idx = this.chats.findIndex((chat) => chat.id === chatId);
    if (idx === -1) {
      this.chats.push(this.mergeChat({
        id: chatId,
        name: msg.pushName,
        lastMessage: msg,
        lastTimestamp: timestamp2,
        conversationTimestamp: timestamp2
      }));
    } else if (timestamp2 >= chatTimestamp(this.chats[idx])) {
      this.chats[idx].lastMessage = msg;
      this.chats[idx].lastTimestamp = timestamp2;
      this.chats[idx].conversationTimestamp = timestamp2;
      if (msg.pushName && isPlaceholderName(this.chats[idx].name, chatId)) {
        this.chats[idx].name = msg.pushName;
      }
    } else if (msg.pushName && isPlaceholderName(this.chats[idx].name, chatId)) {
      this.chats[idx].name = msg.pushName;
    }
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
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    waClearAll();
    this.qrBase64 = null;
    storeDelete("whatsapp", "cache");
    this.chats = [];
    this.messagesByChat.clear();
    this.cacheLoaded = false;
  }
  async clearDatabase() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    waClearData();
    this.chats = [];
    this.contactNames.clear();
    this.messagesByChat.clear();
    this.emit("chatsUpdated", []);
    this.emit("messagesUpdated", []);
  }
  async sendOutboxRow(row) {
    if (!this.sock || this.status !== "connected") throw new Error("WhatsApp não conectado");
    const attempts = Number(row.attempts || 0) + 1;
    waUpdateOutbox(row.id, "sending", attempts);
    try {
      const payload = JSON.parse(row.data);
      if (row.kind === "text") {
        await this.sock.sendMessage(row.chat_id, { text: payload.text });
      } else if (row.kind === "media") {
        const buffer = Buffer.from(payload.data, "base64");
        const mime = String(payload.mimeType || "").toLowerCase();
        if (mime.startsWith("image/") && mime !== "image/gif") {
          await this.sock.sendMessage(row.chat_id, { image: buffer, caption: payload.caption || void 0, mimetype: mime });
        } else if (mime.startsWith("video/") || mime === "image/gif") {
          await this.sock.sendMessage(row.chat_id, {
            video: buffer,
            caption: payload.caption || void 0,
            mimetype: mime === "image/gif" ? "video/mp4" : mime,
            gifPlayback: String(payload.fileName || "").toLowerCase().endsWith(".gif")
          });
        } else if (mime.startsWith("audio/")) {
          await this.sock.sendMessage(row.chat_id, { audio: buffer, mimetype: mime, ptt: true });
        } else {
          throw new Error("Formato de mídia não suportado");
        }
      } else {
        throw new Error(`Tipo de envio desconhecido: ${row.kind}`);
      }
      waUpdateOutbox(row.id, "sent", attempts);
    } catch (error) {
      const delay = Math.min(6e4, 1e3 * 2 ** Math.min(attempts, 6));
      waUpdateOutbox(row.id, "pending", attempts, error?.message || String(error), Date.now() + delay);
      throw error;
    }
  }
  async processOutbox() {
    if (this.outboxRunning || !this.sock || this.status !== "connected") return;
    this.outboxRunning = true;
    waRecoverOutbox();
    try {
      for (const row of waListPendingOutbox()) {
        if (!this.sock || this.status !== "connected") break;
        try {
          await this.sendOutboxRow(row);
        } catch (error) {
          console.warn("[WA] falha ao reenviar item da outbox:", error);
        }
      }
    } finally {
      this.outboxRunning = false;
    }
  }
  async sendMessage(chatId, text) {
    const id = waEnqueueOutbox(chatId, "text", JSON.stringify({ text }));
    await this.sendOutboxRow({ id, chat_id: chatId, kind: "text", data: JSON.stringify({ text }), attempts: 0 });
  }
  async sendMedia(chatId, data, mimeType, fileName, caption = "") {
    const buffer = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    const mime = mimeType.toLowerCase();
    if (!(mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/"))) {
      throw new Error("Formato de mídia não suportado");
    }
    const dataPayload = { data: buffer.toString("base64"), mimeType: mime, fileName, caption };
    const id = waEnqueueOutbox(chatId, "media", JSON.stringify(dataPayload));
    await this.sendOutboxRow({ id, chat_id: chatId, kind: "media", data: JSON.stringify(dataPayload), attempts: 0 });
  }
  async ensureBaileys() {
    if (!this.initPromise) this.initPromise = loadBaileys();
    await this.initPromise;
  }
  setStatus(s) {
    this.status = s;
    this.emit(s);
  }
  waitForHistoryQuiet() {
    if (!this.historyStatusComplete) return;
    if (this.historyCompleteTimer) clearTimeout(this.historyCompleteTimer);
    this.historyCompleteTimer = setTimeout(() => {
      this.historyCompleteTimer = null;
      this.historySyncing = false;
      this.emit("historySync", false);
    }, 8e3);
  }
  async connect() {
    await this.ensureBaileys();
    if (this.connecting || this.status === "connected" || this.sock) return;
    this.restoreCache();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = true;
    if (this.historyCompleteTimer) {
      clearTimeout(this.historyCompleteTimer);
      this.historyCompleteTimer = null;
    }
    this.historySyncing = true;
    this.historyStatusComplete = false;
    this.emit("historySync", true);
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
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: makeLogger("main"),
      qrTimeout: 3e4,
      shouldSyncHistoryMessage: () => true
    });
    this.sock = socket;
    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", async (update) => {
      if (this.sock !== socket) return;
      const keys = Object.keys(update);
      const connectionError = disconnectDetails(update.lastDisconnect?.error);
      console.log("[WA] connection.update diagnostic:", {
        keys,
        connection: update.connection,
        qrPresent: Boolean(update.qr),
        isNewLogin: update.isNewLogin,
        receivedPendingNotifications: update.receivedPendingNotifications,
        isOnline: update.isOnline,
        hasLastDisconnect: Boolean(update.lastDisconnect),
        lastDisconnect: connectionError
      });
      console.log(
        "[WA] connection.update:",
        JSON.stringify(keys),
        update.qr ? "qr" : "",
        update.connection || "",
        connectionError?.message || ""
      );
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
      if (update.connection === "connecting") {
        this.setStatus("connecting");
      }
      if (update.connection === "open") {
        console.log("[WA] CONECTADO!");
        this.connecting = false;
        this.qrBase64 = null;
        this.setStatus("connected");
        await this.loadChats();
        this.processOutbox().catch((error) => console.warn("[WA] erro processando outbox:", error));
      }
      if (update.connection === "close") {
        const disconnectError = update.lastDisconnect?.error;
        const code = disconnectError?.output?.statusCode;
        const numericCode = Number(code);
        const isRestartRequired = numericCode === 515 || String(disconnectError?.message || "").toLowerCase().includes("restart required");
        console.log("[WA] desconectado, motivo:", code);
        console.log("[WA] restartRequired:", isRestartRequired, "statusCode:", numericCode);
        console.log("[WA] disconnect diagnostic:", {
          code,
          numericCode,
          isRestartRequired,
          error: disconnectDetails(disconnectError)
        });
        const shouldReconnect = isRestartRequired;
        this.connecting = false;
        this.sock = null;
        this.qrBase64 = null;
        if (this.historyCompleteTimer) {
          clearTimeout(this.historyCompleteTimer);
          this.historyCompleteTimer = null;
        }
        this.historySyncing = false;
        this.historyStatusComplete = false;
        if (shouldReconnect) {
          console.log("[WA] reinício solicitado pelo servidor, reconectando...");
          this.setStatus("connecting");
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch((error) => console.error("[WA] erro ao reiniciar conexão:", error));
          }, 500);
          return;
        }
        this.setStatus("disconnected");
        const errorMessage = numericCode === 401 ? "A sessão do WhatsApp foi rejeitada. Limpe os tokens e leia um novo QR Code." : `A conexão do WhatsApp foi encerrada${code ? ` (${code})` : ""}.`;
        this.emit("error", errorMessage);
      }
    });
    socket.ev.on("messaging-history.set", ({ chats, contacts, messages, syncType, progress, isLatest, chunkOrder, peerDataRequestSessionId }) => {
      this.updateContacts(contacts || []);
      if (chats) {
        for (const rawChat of chats) {
          const chat = this.mergeChat(rawChat);
          const idx = this.chats.findIndex((c) => c.id === chat.id);
          if (idx === -1) this.chats.push(chat);
        }
      }
      if (messages) {
        for (const msg of messages) {
          this.storeMessage(msg);
          this.ensureChatFromMessage(msg);
        }
      }
      this.persistChats();
      console.log("[WA] history sync:", {
        chats: chats?.length || 0,
        contacts: contacts?.length || 0,
        messages: messages?.length || 0,
        syncType,
        progress,
        isLatest,
        chunkOrder,
        peerDataRequestSessionId
      });
      this.persistCache();
      this.emit("chatsUpdated", this.sortedChats());
      this.emit("messagesUpdated", [...new Set((messages || []).map((message) => message.key?.remoteJid).filter(Boolean))]);
      this.waitForHistoryQuiet();
    });
    socket.ev.on("messaging-history.status", (status) => {
      console.log("[WA] history status:", status.syncType, status.status, "explicit:", status.explicit);
      if (status.status === "complete" || status.status === "paused") {
        this.historyStatusComplete = true;
        this.waitForHistoryQuiet();
      }
    });
    socket.ev.on("chats.upsert", (chats) => {
      for (const rawChat of chats || []) {
        const chat = this.mergeChat(rawChat);
        const idx = this.chats.findIndex((c) => c.id === chat.id);
        if (idx === -1) this.chats.push(chat);
        else {
          const previous = this.chats[idx];
          this.chats[idx] = { ...previous, ...chat };
          if (chat.lastMessage && !hasMessagePayload(chat.lastMessage) && hasMessagePayload(previous.lastMessage)) {
            this.chats[idx].lastMessage = previous.lastMessage;
          }
        }
      }
      this.persistChats();
      this.emit("chatsUpdated", this.sortedChats());
      this.persistCache();
    });
    socket.ev.on("chats.update", (updates) => {
      for (const update of updates || []) {
        const idx = this.chats.findIndex((c) => c.id === update.id);
        if (idx !== -1) {
          const previous = this.chats[idx];
          const merged = this.mergeChat(update);
          Object.assign(this.chats[idx], merged);
          if (merged.lastMessage && !hasMessagePayload(merged.lastMessage) && hasMessagePayload(previous.lastMessage)) {
            this.chats[idx].lastMessage = previous.lastMessage;
          }
        }
      }
      this.persistChats();
      this.emit("chatsUpdated", this.sortedChats());
      this.persistCache();
    });
    socket.ev.on("contacts.upsert", (contacts) => {
      this.updateContacts(contacts || []);
      this.persistChats();
      this.emit("chatsUpdated", this.sortedChats());
      this.persistCache();
    });
    socket.ev.on("contacts.update", (updates) => {
      this.updateContacts(updates || []);
      this.persistChats();
      this.emit("chatsUpdated", this.sortedChats());
      this.persistCache();
    });
    socket.ev.on("chats.delete", (ids) => {
      if (this.historyFetches > 0) return;
      this.chats = this.chats.filter((c) => !ids.includes(c.id));
      this.persistChats();
      this.emit("chatsUpdated", this.chats);
      this.persistCache();
    });
    socket.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages) {
        this.storeMessage(msg);
        this.ensureChatFromMessage(msg);
        if (msg.key?.remoteJid) this.emit("message", msg);
      }
      this.persistChats();
      this.emit("chatsUpdated", this.sortedChats());
      this.persistCache();
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
    console.log("[WA] chats disponíveis:", this.chats.length);
    this.emit("chatsUpdated", this.sortedChats());
    this.persistCache();
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
    if (this.historyCompleteTimer) {
      clearTimeout(this.historyCompleteTimer);
      this.historyCompleteTimer = null;
    }
    this.connecting = false;
    this.sock?.end(new Error("manual disconnect"));
    this.sock = null;
    this.chats = [];
    this.contactNames.clear();
    this.messagesByChat.clear();
    this.historySyncing = false;
    this.historyStatusComplete = false;
    this.setStatus("disconnected");
  }
}
const whatsappService = new WhatsAppService();
function handleNetworkError(details) {
  debug.networkError(details);
}
function safeErrorMessage(error, fallback = "Operação falhou") {
  const message = error instanceof Error ? error.message : String(error || fallback);
  if (/<html[\s>]/i.test(message)) {
    const status = message.match(/Instagram API\s+(\d{3})/i)?.[1];
    return status ? `Instagram API ${status} retornou HTML` : "O servidor retornou uma página HTML inesperada";
  }
  return message.length > 500 ? `${message.slice(0, 500)}...` : message;
}
function handleRenderError(details) {
  debug.renderError(details);
}
const IG_APP_ID = process.env.IG_APP_ID || "936619743392459";
const BASE = process.env.IG_BASE_URL || "https://www.instagram.com";
const API = `${BASE}/api/v1`;
const MOBILE_BASE = process.env.IG_MOBILE_BASE_URL || "https://i.instagram.com";
const MOBILE_API = `${MOBILE_BASE}/api/v1`;
const USER_AGENT = process.env.IG_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
function summarizeResponseBody(body, contentType) {
  if (contentType.toLowerCase().includes("text/html") || /<html[\s>]/i.test(body)) {
    return `[HTML omitido; ${body.length} caracteres]`;
  }
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}
class InstagramService extends events.EventEmitter {
  cookies = null;
  status = "disconnected";
  threads = [];
  pollTimer = null;
  webWindow = null;
  realtimeSocketIds = /* @__PURE__ */ new Set();
  realtimeSeenMessageIds = /* @__PURE__ */ new Set();
  realtimeAttached = false;
  getStatus() {
    return this.status;
  }
  getThreads() {
    return this.threads;
  }
  getCachedThreads(folder) {
    return instagramListThreads(folder).map((row) => JSON.parse(row.data));
  }
  cookieString() {
    if (!this.cookies) return "";
    const cookies = {
      ...this.cookies.extra,
      sessionid: this.cookies.sessionid,
      csrftoken: this.cookies.csrftoken,
      ds_user_id: this.cookies.ds_user_id
    };
    return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  }
  async getWebWindow() {
    if (this.webWindow && !this.webWindow.isDestroyed()) return this.webWindow;
    this.webWindow = new electron.BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    this.webWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      handleRenderError({ kind: "instagram-window-load-failed", errorCode, errorDescription, url: validatedURL, isMainFrame });
    });
    this.webWindow.webContents.on("render-process-gone", (_event, details) => {
      handleRenderError({ kind: "instagram-window-process-gone", reason: details.reason, exitCode: details.exitCode });
    });
    const devtools = this.webWindow.webContents.debugger;
    try {
      devtools.attach("1.3");
      devtools.on("message", (_event, method, params) => {
        if (method === "Network.webSocketCreated" && params.url?.includes("instagram.com")) {
          this.realtimeSocketIds.add(params.requestId);
          debug.log("[IG] realtime socket connected:", params.url);
        }
        if (method === "Network.webSocketClosed") {
          this.realtimeSocketIds.delete(params.requestId);
        }
        if (method === "Network.webSocketFrameReceived" && this.realtimeSocketIds.has(params.requestId)) {
          this.handleRealtimeFrame(params.response?.payloadData, params.response?.opcode);
        }
      });
      await devtools.sendCommand("Network.enable");
      this.realtimeAttached = true;
    } catch (error) {
      debug.log("[IG] realtime monitor unavailable:", error?.message || error);
    }
    for (const [name, value] of Object.entries({
      ...this.cookies?.extra,
      sessionid: this.cookies?.sessionid,
      csrftoken: this.cookies?.csrftoken,
      ds_user_id: this.cookies?.ds_user_id
    })) {
      if (!value) continue;
      await this.webWindow.webContents.session.cookies.set({ url: BASE, name, value: String(value) }).catch(() => {
      });
    }
    await this.webWindow.loadURL(`${BASE}/direct/inbox/`);
    return this.webWindow;
  }
  handleRealtimeFrame(payload, opcode) {
    if (!payload) return;
    let parsed;
    try {
      parsed = JSON.parse(payload.replace(/^for\s*\(;;\);/, ""));
    } catch {
      debug.log("[IG] realtime frame:", { opcode, size: payload.length, format: "binary-or-non-json" });
      return;
    }
    const candidates = [];
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if ((value.item_id || value.id) && (value.thread_id || value.threadId) && (value.timestamp || value.created_at)) {
        candidates.push(value);
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else {
        for (const child of Object.values(value)) visit(child);
      }
    };
    visit(parsed);
    debug.log("[IG] realtime frame:", { opcode, size: payload.length, candidates: candidates.length });
    for (const item of candidates) {
      const threadId = item.thread_id || item.threadId;
      const message = this.normalizeDirectItem(item, String(threadId));
      if (!message.id || this.realtimeSeenMessageIds.has(String(message.id))) continue;
      this.realtimeSeenMessageIds.add(String(message.id));
      if (this.realtimeSeenMessageIds.size > 5e3) {
        const oldest = this.realtimeSeenMessageIds.values().next().value;
        if (oldest) this.realtimeSeenMessageIds.delete(oldest);
      }
      this.emit("message", message);
    }
  }
  async igFetch(path2, options = {}) {
    const url = path2.startsWith("http") ? path2 : `${API}${path2}`;
    const requestBase = url.startsWith(MOBILE_BASE) ? MOBILE_BASE : BASE;
    debug.log("[IG] fetch", options.method || "GET", url);
    const headers = {
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "X-IG-App-ID": IG_APP_ID,
      "X-CSRFToken": this.cookies?.csrftoken ?? "",
      "Cookie": this.cookieString(),
      "Origin": requestBase,
      "Referer": `${requestBase}/`,
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Accept-Encoding": "gzip, deflate, br"
    };
    if (options.body && !(options.body instanceof URLSearchParams)) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    let res;
    try {
      res = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, redirect: "follow" });
    } catch (error) {
      handleNetworkError({ kind: "request-failed", method: options.method || "GET", url, message: error?.message || String(error) });
      throw new Error(`Falha de rede ao acessar o Instagram: ${error?.message || "conexão recusada"}`);
    }
    debug.log("[IG] response", res.status, res.statusText);
    if (!res.ok) {
      const text = await res.text();
      const contentType = res.headers.get("content-type") || "desconhecido";
      handleNetworkError({
        kind: "http-error",
        method: options.method || "GET",
        url,
        status: res.status,
        statusText: res.statusText,
        contentType,
        body: summarizeResponseBody(text, contentType)
      });
      throw new Error(`Instagram API ${res.status} ${res.statusText || "erro HTTP"}`);
    }
    try {
      return await res.json();
    } catch (error) {
      const contentType = res.headers.get("content-type") || "desconhecido";
      handleNetworkError({
        kind: "invalid-response",
        method: options.method || "GET",
        url,
        status: res.status,
        contentType,
        message: error?.message || "resposta não é JSON"
      });
      throw new Error("O Instagram retornou uma resposta inválida (não-JSON)");
    }
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
            const coreCookies = /* @__PURE__ */ new Set(["sessionid", "csrftoken", "ds_user_id"]);
            this.cookies = {
              sessionid: sid.value,
              csrftoken: csrf.value,
              ds_user_id: uid.value,
              extra: Object.fromEntries(
                allCookies.filter((cookie) => !coreCookies.has(cookie.name)).map((cookie) => [cookie.name, cookie.value])
              )
            };
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
    if (this.status === "connected") return true;
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
    if (this.webWindow && !this.webWindow.isDestroyed()) this.webWindow.close();
    this.webWindow = null;
    this.realtimeSocketIds.clear();
    this.realtimeSeenMessageIds.clear();
    this.realtimeAttached = false;
    this.cookies = null;
    this.status = "disconnected";
    this.threads = [];
    instagramClearThreads();
    storeDelete("instagram", "cookies");
    this.emit("disconnected");
  }
  normalizeDirectItem(item, threadId) {
    const media = item.visual_media?.media || item.media_share?.media || item.reel_share?.media || item.clip?.clip || item.media;
    const videoUrl = media?.video_versions?.[0]?.url;
    const imageUrl = media?.image_versions2?.candidates?.[0]?.url;
    const audioUrl = item.voice_media?.media?.audio_src || item.audio_media?.audio_src || item.audio_media?.media?.audio_src;
    const mediaUrl = videoUrl || imageUrl || audioUrl || "";
    const mediaType = videoUrl ? media?.is_dash_eligible ? "video" : "video" : imageUrl ? "image" : audioUrl ? "audio" : "";
    return {
      id: item.item_id || item.id,
      threadId,
      text: item.text || item.caption?.text || "",
      senderId: item.user_id?.toString(),
      timestamp: item.timestamp,
      isMine: item.user_id?.toString() === this.cookies?.ds_user_id,
      mediaUrl,
      mediaType,
      thumbnailUrl: imageUrl || media?.image_versions2?.candidates?.[0]?.url || ""
    };
  }
  async getMessages(threadId) {
    const page = await this.getMessagesPage(threadId);
    return page.messages;
  }
  async getMessagesPage(threadId, cursor) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const data = await this.igFetch(`/direct_v2/threads/${threadId}/${suffix}`);
    const thread = data.thread || data;
    const messages = (thread.items || []).map((item) => this.normalizeDirectItem(item, threadId)).reverse();
    const nextCursor = thread.oldest_cursor || thread.next_cursor || data.oldest_cursor || null;
    return {
      messages,
      nextCursor,
      hasMore: Boolean(nextCursor && nextCursor !== cursor && (thread.has_older !== false && thread.has_older_items !== false))
    };
  }
  async getThreadsPage(folder = "main", cursor) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const endpoint = folder === "pending" ? `${MOBILE_API}/direct_v2/pending_inbox/` : folder === "hidden" ? `${MOBILE_API}/direct_v2/hidden_inbox/` : "/direct_v2/inbox/";
    const data = await this.igFetch(`${endpoint}?persistentBadging=true&limit=20${suffix}`);
    const inbox = folder === "pending" ? data.pending_inbox || data.pendingInbox || data.inbox || data : folder === "hidden" ? data.hidden_inbox || data.hiddenInbox || data.inbox || data : data.inbox || data;
    debug.log("[IG] folder response:", {
      folder,
      keys: Object.keys(data || {}),
      inboxKeys: Object.keys(inbox || {}),
      threads: inbox?.threads?.length || 0
    });
    const threads = (inbox.threads || []).map((t) => ({
      id: t.thread_id || t.threadId || t.id,
      graphqlId: t.thread_v2_id || t.thread_igid || t.thread_pk || t.pk || t.thread_id || t.id,
      name: t.thread_title || t.users?.map((u) => u.username).join(", ") || "Unknown",
      lastMessage: t.last_permanent_item?.text || t.last_item?.text || "",
      lastTimestamp: t.last_activity_at || t.last_item?.timestamp,
      unread: t.has_newer,
      avatarUrl: t.users?.[0]?.profile_pic_url || "",
      folder
    }));
    if (cursor) instagramUpsertThreads(folder, threads);
    else instagramReplaceThreads(folder, threads);
    const nextCursor = inbox.oldest_cursor || inbox.next_cursor || data.oldest_cursor || null;
    return {
      threads,
      nextCursor,
      hasMore: Boolean(nextCursor && nextCursor !== cursor && (inbox.has_older_threads !== false && inbox.has_older !== false))
    };
  }
  async searchThreads(query) {
    const offsets = encodeURIComponent('{"message_content":0}');
    const resultTypes = encodeURIComponent('["message_content"]');
    const data = await this.igFetch(`/direct_v2/search_secondary/?offsets=${offsets}&query=${encodeURIComponent(query)}&result_types=${resultTypes}`);
    const results = data.message_content || data.results || data.items || [];
    return results.map((result) => {
      const thread = result.thread || result.thread_info || result;
      const item = result.item || result.message || result.last_item || result;
      const users = thread.users || result.users || [];
      return {
        id: thread.thread_id || thread.threadId || thread.id || result.thread_id,
        graphqlId: thread.thread_v2_id || thread.thread_igid || thread.thread_pk || thread.pk || thread.thread_id,
        name: thread.thread_title || users.map((user) => user.username).join(", ") || result.thread_title || "Unknown",
        lastMessage: item.text || result.text || "",
        lastTimestamp: item.timestamp || result.timestamp,
        unread: thread.has_newer,
        avatarUrl: users[0]?.profile_pic_url || ""
      };
    }).filter((thread) => thread.id);
  }
  async sendMessage(threadId, text) {
    const window = await this.getWebWindow();
    let result;
    try {
      result = await window.webContents.executeJavaScript(`
      (async () => {
        const threadId = ${JSON.stringify(threadId)};
        const text = ${JSON.stringify(text)};
        const html = document.documentElement.innerHTML;
        const lsd = html.match(/\\["LSD",\\[\\],\\{"token":"([^"]+)"/)?.[1] || '';
        const fbDtsg = html.match(/\\["DTSGInitialData",\\[\\],\\{"token":"([^"]+)"/)?.[1] || '';
        const jazoest = String(2 + [...lsd].reduce((sum, char) => sum + char.charCodeAt(0), 0));
        const variables = {
          ig_thread_igid: threadId,
          offline_threading_id: String(Date.now()) + String(Math.floor(Math.random() * 1000000)),
          recipient_igids: null,
          replied_to_client_context: null,
          replied_to_item_id: null,
          reply_to_message_id: null,
          sampled: null,
          text: { sensitive_string_value: text },
          mentions: [],
          mentioned_user_ids: [],
          commands: null,
          forwarded_from_thread_id: null,
          is_forwarded_from_own_message: null,
          send_attribution: 'igd_web_chat_tab:in_thread'
        };
        const form = new URLSearchParams({
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: 'IGDirectTextSendMutation',
          server_timestamps: 'true',
          lsd,
          fb_dtsg: fbDtsg,
          jazoest,
          variables: JSON.stringify(variables),
          doc_id: '26911679871773184'
        });
        const csrf = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] || '';
        const response = await fetch('/api/graphql', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': decodeURIComponent(csrf),
            'X-FB-Friendly-Name': 'IGDirectTextSendMutation',
            'X-FB-LSD': lsd,
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '359341'
          },
          body: form
        });
        return { status: response.status, body: await response.text() };
      })()
      `, true);
    } catch (error) {
      handleRenderError({ kind: "instagram-send-render-failed", message: error?.message || String(error) });
      throw new Error(`Falha no renderer do Instagram: ${error?.message || "não foi possível executar o envio"}`);
    }
    const { status, body } = result;
    debug.log("[IG] sendMessage response:", status);
    if (status < 200 || status >= 300) {
      handleNetworkError({
        kind: "send-http-error",
        method: "POST",
        url: `${BASE}/api/graphql`,
        status,
        body: summarizeResponseBody(body, "text/plain")
      });
      throw new Error(`Instagram API ${status} ao enviar mensagem`);
    }
    try {
      const data = JSON.parse(body);
      if (data.errors?.length || !data.data?.xig_direct_text_send_with_slide_messaging_response) {
        throw new Error(`Instagram API 400: ${body}`);
      }
    } catch (e) {
      handleNetworkError({ kind: "send-invalid-response", message: e?.message || String(e) });
      throw e;
    }
  }
  async startPolling() {
    this.stopPolling();
    await this.loadThreads();
    this.getWebWindow().catch((error) => debug.log("[IG] realtime startup failed:", error?.message || error));
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
      const page = await this.getThreadsPage("main");
      this.threads = page.threads;
      console.log("[IG] threads count:", this.threads.length);
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
      const message = safeErrorMessage(e);
      debug.ipc(channel, "error", message);
      return { __ipcError: message };
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
  whatsappService.on("messagesUpdated", (chatIds) => broadcast("whatsapp:messagesUpdated", chatIds));
  whatsappService.on("historySync", (syncing) => broadcast("whatsapp:historySync", syncing));
  handle("whatsapp:getStatus", () => whatsappService.getStatus());
  handle("whatsapp:getQRCode", () => whatsappService.getQRCode());
  handle("whatsapp:getHistorySyncing", () => whatsappService.getHistorySyncing());
  handle("whatsapp:connect", () => whatsappService.connect());
  handle("whatsapp:disconnect", () => whatsappService.disconnect());
  handle("whatsapp:getChats", () => whatsappService.getChats());
  handle("whatsapp:getMessages", (chatId) => whatsappService.getMessages(chatId));
  handle("whatsapp:getOlderMessages", (chatId, beforeId) => whatsappService.getOlderMessages(chatId, beforeId));
  handle("whatsapp:getMedia", (chatId, messageId) => whatsappService.getMedia(chatId, messageId));
  handle("whatsapp:sendMessage", (chatId, text) => whatsappService.sendMessage(chatId, text));
  handle("whatsapp:sendMedia", (chatId, data, mimeType, fileName, caption) => whatsappService.sendMedia(chatId, data, mimeType, fileName, caption));
  handle("whatsapp:getProfilePicture", (jid) => whatsappService.getProfilePicture(jid));
  handle("whatsapp:clearCreds", () => whatsappService.clearCreds());
  handle("whatsapp:clearDatabase", () => whatsappService.clearDatabase());
  instagramService.on("connected", () => broadcast("instagram:connected"));
  instagramService.on("disconnected", () => broadcast("instagram:disconnected"));
  instagramService.on("message", (msg) => broadcast("instagram:message", msg));
  instagramService.on("threadsUpdated", (threads) => broadcast("instagram:threadsUpdated", threads));
  handle("instagram:getStatus", () => instagramService.getStatus());
  handle("instagram:loginWithBrowser", () => instagramService.loginWithBrowser());
  handle("instagram:tryRestore", () => instagramService.tryRestore());
  handle("instagram:logout", () => instagramService.logout());
  handle("instagram:getThreads", () => instagramService.getThreads());
  handle("instagram:getCachedThreads", (folder) => instagramService.getCachedThreads(folder || "main"));
  handle("instagram:getMessages", (threadId) => instagramService.getMessages(threadId));
  handle("instagram:getMessagesPage", (threadId, cursor) => instagramService.getMessagesPage(threadId, cursor));
  handle("instagram:getThreadsPage", (folder, cursor) => instagramService.getThreadsPage(folder || "main", cursor));
  handle("instagram:searchThreads", (query) => instagramService.searchThreads(query));
  handle("instagram:sendMessage", (threadId, text) => instagramService.sendMessage(threadId, text));
  handle("app:reload", () => {
    electron.BrowserWindow.getAllWindows().forEach((w) => w.webContents.reloadIgnoringCache());
  });
  handle("app:clearTokens", async () => {
    try {
      await whatsappService.disconnect();
      await whatsappService.clearCreds();
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
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    handleRenderError({ kind: "load-failed", errorCode, errorDescription, url: validatedURL, isMainFrame });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    handleRenderError({ kind: "process-gone", reason: details.reason, exitCode: details.exitCode });
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const isInternalLog = /\[(?:DEBUG|NETWORK|RENDER|IPC)\]/.test(message);
    if (level < 3 || isInternalLog) return;
    if (/remote method|Instagram API|Failed to fetch|network/i.test(message)) {
      handleNetworkError({ kind: "renderer-network-error", message, line, source: sourceId });
      return;
    }
    handleRenderError({ kind: "console-error", message, line, source: sourceId });
  });
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
  whatsappService.connect().catch((error) => console.error("[WA] startup error:", error));
  instagramService.tryRestore().catch((error) => console.error("[IG] startup restore error:", error));
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
