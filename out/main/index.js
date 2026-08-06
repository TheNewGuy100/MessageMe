"use strict";
const electron = require("electron");
const path = require("path");
const zlib = require("zlib");
const fs = require("fs");
const Database = require("better-sqlite3");
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
let db = null;
function getAppSetting(key) {
  const row = getDb().prepare("SELECT value FROM store WHERE namespace = ? AND key = ?").get("app", key);
  return row?.value;
}
function setAppSetting(key, value) {
  getDb().prepare("INSERT OR REPLACE INTO store (namespace, key, value) VALUES (?, ?, ?)").run("app", key, value);
}
function getDb() {
  if (db) return db;
  const directory = path.join(electron.app.getPath("userData"), "data");
  fs.mkdirSync(directory, { recursive: true });
  db = new Database(path.join(directory, "message-manager.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (namespace, key)
    );

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'instagram',
      conversation_id TEXT,
      message TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_date
      ON scheduled_messages (scheduled_at, status);

    CREATE TABLE IF NOT EXISTS automation_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_states (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL,
      flow_id TEXT,
      state TEXT NOT NULL DEFAULT 'new',
      variables TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id, conversation_id)
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS automation_logs (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      platform TEXT NOT NULL,
      conversation TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_automation_logs_at
      ON automation_logs (at DESC);
  `);
  return db;
}
function listScheduledMessages() {
  return getDb().prepare(`
    SELECT id, platform, conversation_id AS conversationId, message,
      scheduled_at AS scheduledAt, status, created_at AS createdAt, updated_at AS updatedAt
    FROM scheduled_messages
    ORDER BY scheduled_at ASC
  `).all();
}
function insertScheduledMessage(item) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  getDb().prepare(`
    INSERT INTO scheduled_messages
      (id, platform, conversation_id, message, scheduled_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      platform = excluded.platform,
      conversation_id = excluded.conversation_id,
      message = excluded.message,
      scheduled_at = excluded.scheduled_at,
      updated_at = excluded.updated_at
  `).run(item.id, item.platform || "instagram", item.conversationId || null, item.message, item.at, item.createdAt || now, now);
}
function deleteScheduledMessage(id) {
  getDb().prepare("DELETE FROM scheduled_messages WHERE id = ?").run(id);
}
function listAutomationFlows() {
  return getDb().prepare(`
    SELECT id, name, enabled, priority, definition,
      created_at AS createdAt, updated_at AS updatedAt
    FROM automation_flows ORDER BY priority DESC, created_at ASC
  `).all().map((flow) => ({ ...flow, enabled: Boolean(flow.enabled) }));
}
function upsertAutomationFlow(flow) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  getDb().prepare(`
    INSERT INTO automation_flows (id, name, enabled, priority, definition, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      enabled = excluded.enabled,
      priority = excluded.priority,
      definition = excluded.definition,
      updated_at = excluded.updated_at
  `).run(flow.id, flow.name, flow.enabled ? 1 : 0, flow.priority || 0, flow.definition, flow.createdAt || now, now);
}
function deleteAutomationFlow(id) {
  getDb().prepare("DELETE FROM automation_flows WHERE id = ?").run(id);
}
function listConversationStates(platform, accountId = "") {
  return getDb().prepare(`
    SELECT platform, account_id AS accountId, conversation_id AS conversationId,
      flow_id AS flowId, state, variables, updated_at AS updatedAt
    FROM conversation_states
    WHERE platform = ? AND account_id = ?
  `).all(platform, accountId);
}
function upsertConversationState(state) {
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  getDb().prepare(`
    INSERT INTO conversation_states
      (platform, account_id, conversation_id, flow_id, state, variables, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, account_id, conversation_id) DO UPDATE SET
      flow_id = excluded.flow_id,
      state = excluded.state,
      variables = excluded.variables,
      updated_at = excluded.updated_at
  `).run(state.platform, state.accountId || "", state.conversationId, state.flowId || null, state.currentState, state.variables || "{}", updatedAt);
}
function listProcessedMessageIds(platform, accountId = "") {
  return getDb().prepare(`
    SELECT message_id FROM processed_messages
    WHERE platform = ? AND account_id = ?
    ORDER BY processed_at DESC LIMIT 1000
  `).all(platform, accountId).map((row) => row.message_id);
}
function markProcessedMessage(platform, messageId, accountId = "") {
  getDb().prepare(`
    INSERT OR IGNORE INTO processed_messages (platform, account_id, message_id, processed_at)
    VALUES (?, ?, ?, ?)
  `).run(platform, accountId, messageId, (/* @__PURE__ */ new Date()).toISOString());
  getDb().prepare(`
    DELETE FROM processed_messages
    WHERE platform = ? AND account_id = ?
      AND message_id NOT IN (
        SELECT message_id FROM processed_messages
        WHERE platform = ? AND account_id = ?
        ORDER BY processed_at DESC LIMIT 1000
      )
  `).run(platform, accountId, platform, accountId);
}
function resetAutomationRuntime() {
  getDb().exec("DELETE FROM processed_messages; DELETE FROM conversation_states;");
}
function listAutomationLogs() {
  return getDb().prepare(`
    SELECT id, at, platform, conversation, action, status, detail
    FROM automation_logs ORDER BY at DESC LIMIT 200
  `).all();
}
function insertAutomationLog(log) {
  getDb().prepare(`
    INSERT OR REPLACE INTO automation_logs
      (id, at, platform, conversation, action, status, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(log.id, log.at, log.platform, log.conversation, log.action, log.status, log.detail);
  getDb().prepare(`
    DELETE FROM automation_logs
    WHERE id NOT IN (SELECT id FROM automation_logs ORDER BY at DESC LIMIT 200)
  `).run();
}
function clearAutomationLogs() {
  getDb().prepare("DELETE FROM automation_logs").run();
}
class AutomationController {
  adapters = /* @__PURE__ */ new Map();
  running = false;
  register(adapter) {
    this.adapters.set(adapter.platform, adapter);
  }
  isRunning() {
    return this.running;
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (const adapter of this.adapters.values()) await adapter.run();
    } finally {
      this.running = false;
    }
  }
}
const DEFAULT_SIDEBAR_WIDTH = 200;
const OFFICIAL_VIEWS_HEADER_HEIGHT = 52;
const MIN_SINGLE_VIEW_WIDTH = 900;
const MIN_SPLIT_VIEW_WIDTH = 1200;
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const INSTAGRAM_ROUTES = {
  inbox: "https://www.instagram.com/direct/inbox/",
  requests: "https://www.instagram.com/direct/requests/",
  hidden: "https://www.instagram.com/direct/requests/hidden/"
};
const AUTOMATION_DEBUG_LOG = path.join(process.cwd(), "automation-debug.log");
function writeAutomationDebug(event, data = {}) {
  try {
    fs.appendFileSync(AUTOMATION_DEBUG_LOG, `${(/* @__PURE__ */ new Date()).toISOString()} ${event} ${JSON.stringify(data)}
`, "utf8");
  } catch {
  }
}
const createInstagramAutoReplyScript = (text, prime, allowProcessed, flows, processedMessageIds, knownStates, automaticReplies, activeFlowStates) => `(() => {
  const fallbackReply = ${JSON.stringify(text)}
  const flows = ${JSON.stringify(flows)}
  const automaticReplies = ${JSON.stringify(automaticReplies)}
  const processedMessageIds = new Set(${JSON.stringify(processedMessageIds)})
  const knownStates = ${JSON.stringify(knownStates)}
  const activeFlowStates = ${JSON.stringify(activeFlowStates)}
  const primeOnly = ${prime}
  const allowProcessedOnce = ${allowProcessed}
  const ownPrefix = /(?:^|\\s)(você|voce|you|tu|tú|vos)\\s*:/i
  const markers = [...document.querySelectorAll('[data-visualcompletion="ignore"]')]
    .filter(element => /^(unread|não lida|nao lida|no leída|no leida)$/i.test((element.textContent || '').trim()))
  const observedStates = {}
  const diagnostic = { url: location.href, rows: 0, markers: markers.length, eligible: 0, skippedState: 0, skippedProcessed: 0, skippedReply: 0, automaticReplies: automaticReplies.length, activeAutomaticReply: false, lockedFlow: false }
  const getPreview = row => {
    const unreadPattern = /^(unread|não lida|nao lida|no leída|no leida)$/i
    const previews = [...row.querySelectorAll('[data-visualcompletion="ignore"]')]
      .map(element => (element.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(text => text && !unreadPattern.test(text))
    return previews[0] || ''
  }

  for (const row of document.querySelectorAll('[role="button"]')) {
    if (row.querySelectorAll('img[alt="user-profile-picture"]').length !== 1) continue
    const name = row.querySelector('span[title]')?.getAttribute('title') || ''
    const profileLink = row.querySelector('a[aria-label^="Open the profile page of"]')
    const profileLabel = profileLink?.getAttribute('aria-label') || ''
    const username = profileLabel.replace(/^Open the profile page of\\s*/i, '').trim()
    const profile = profileLink?.getAttribute('href') || username || name
    observedStates[profile] = getPreview(row)
  }
  diagnostic.rows = Object.keys(observedStates).length

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  const isWithinSchedule = schedule => {
    if (!schedule?.start || !schedule?.end) return true
    const current = new Date()
    const now = current.getHours() * 60 + current.getMinutes()
    const [startHour, startMinute] = schedule.start.split(':').map(Number)
    const [endHour, endMinute] = schedule.end.split(':').map(Number)
    const start = startHour * 60 + startMinute
    const end = endHour * 60 + endMinute
    return start <= end ? now >= start && now < end : now >= start || now < end
  }
  const getScheduledAutomaticReply = () => automaticReplies.find(reply => reply.message && isWithinSchedule(reply))?.message || ''
  const returnToInbox = () => {
    const inboxLink = document.querySelector('a[href="/direct/inbox/"]')
    if (inboxLink) inboxLink.click()
    else window.location.assign('/direct/inbox/')
  }
  const run = async () => {
    for (const marker of markers) {
      const row = marker.closest('[role="button"]')
      if (!row) continue
      if (row.querySelectorAll('img[alt="user-profile-picture"]').length !== 1) continue
      diagnostic.eligible++
      const preview = getPreview(row)
      if (ownPrefix.test(preview)) continue
      const scheduledReply = getScheduledAutomaticReply()
      diagnostic.activeAutomaticReply = Boolean(scheduledReply)
      let reply = scheduledReply || fallbackReply
      let selectedFlowId = null
      const visibleName = row.querySelector('span[title]')?.getAttribute('title') || ''
      const profileLink = row.querySelector('a[aria-label^="Open the profile page of"]')
      const profileLabel = profileLink?.getAttribute('aria-label') || ''
      const username = profileLabel.replace(/^Open the profile page of\\s*/i, '').trim()
      const name = visibleName || username
      const profile = profileLink?.getAttribute('href') || username || name

      row.click()
      await sleep(800)
      const header = document.querySelector('[data-pagelet="IGDInboxHeaderOffMsys"]')
      if (!header || header.querySelectorAll('img[alt="user-profile-picture"]').length !== 1) {
        returnToInbox()
        continue
      }
      const messageGroups = [...document.querySelectorAll('[data-pagelet="IGDMessagesList"] [role="group"]')]
      const lastMessage = messageGroups[messageGroups.length - 1]
      const senderProfile = lastMessage?.querySelector('a[aria-label^="Open the profile page of"]')
      if (!lastMessage || !senderProfile) {
        diagnostic.skippedState++
        returnToInbox()
        continue
      }
      const messageText = (lastMessage.textContent || '').replace(/s+/g, ' ').trim()
      const messageTime = lastMessage.querySelector('abbr[aria-label]')?.getAttribute('aria-label') || ''
      const key = profile + '|' + messageText + '|' + messageTime
      if (processedMessageIds.has(key) && !allowProcessedOnce) {
        diagnostic.skippedProcessed++
        returnToInbox()
        continue
      }
      const flowState = activeFlowStates[profile]
      const flowStateIsActive = flowState && flowState.flowId && Date.now() - Date.parse(flowState.updatedAt) < 3 * 60 * 60 * 1000
      const normalizedMessage = messageText.toLocaleLowerCase()
      if (flowStateIsActive) {
        const lockedFlow = flows.find(flow => flow.id === flowState.flowId)
        if (lockedFlow) {
          reply = lockedFlow.response
          selectedFlowId = lockedFlow.id
          diagnostic.lockedFlow = true
        }
      } else {
        for (const flow of flows) {
          if (flow.keywords.some(keyword => normalizedMessage.includes(keyword))) {
            reply = flow.response
            selectedFlowId = flow.id
            diagnostic.matchedFlow = true
            break
          }
        }
      }
      if (!selectedFlowId) {
        const fallbackFlow = flows.find(flow => flow.fallbackResponse)
        if (fallbackFlow) {
          reply = fallbackFlow.fallbackResponse
          selectedFlowId = fallbackFlow.id
        }
      }
      if (!reply || !reply.trim()) {
        diagnostic.skippedReply++
        returnToInbox()
        continue
      }
      const composer = document.querySelector('[data-pagelet="IGDComposerForCannes"] [contenteditable="true"][role="textbox"][data-lexical-editor="true"]')
      if (!composer) {
        returnToInbox()
        continue
      }
      composer.focus()
      document.execCommand('insertText', false, reply)
      await sleep(100)
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
      await sleep(250)
      returnToInbox()
       return { status: 'sent', conversation: name || 'Conversa sem nome', conversationId: profile, ownState: 'Você: ' + reply, flowId: selectedFlowId, completed: Boolean(flows.find(flow => flow.id === selectedFlowId)?.completed), messageId: key, states: observedStates, diagnostic }
    }
    return { status: 'idle', states: observedStates, diagnostic }
  }
  return run()
})()`;
const UNREAD_SCRIPT = `(() => {
  const selectors = [
    '[data-testid="icon-unread-count"]',
    '[data-testid="icon-unread"]',
    '[aria-label*="unread" i]',
    '[aria-label*="não lida" i]',
    '[aria-label*="no leída" i]',
    '[aria-label*="no leído" i]'
  ]
  const containers = new Set()
  const addContainer = element => {
    const item = element.closest('[role="listitem"], [role="gridcell"], [data-testid*="chat"], [data-testid*="thread"]') || element
    containers.add(item)
  }
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      addContainer(element)
    }
  }

  for (const element of document.querySelectorAll('[data-visualcompletion="ignore"]')) {
    const text = (element.textContent || '').trim().toLowerCase()
    if (/^(unread|não lida|nao lida|no leída|no leida)$/.test(text)) addContainer(element)
  }

  // Instagram uses a small blue dot for unread conversations without a number.
  const blueDot = element => {
    const style = getComputedStyle(element)
    const color = style.backgroundColor.replace(/\\s/g, '')
    const width = element.getBoundingClientRect().width
    const height = element.getBoundingClientRect().height
    return /rgb\\(0,149,246\\)|rgb\\(0,150,246\\)|#0095f6/i.test(color) && width >= 4 && width <= 14 && height >= 4 && height <= 14 && style.borderRadius !== '0px'
  }
  const bluePseudoDot = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo)
    const width = Number.parseFloat(style.width)
    const height = Number.parseFloat(style.height)
    const color = style.backgroundColor.replace(/\\s/g, '')
    return /rgb\\(0,149,246\\)|rgb\\(0,150,246\\)|#0095f6/i.test(color) && width >= 4 && width <= 14 && height >= 4 && height <= 14 && style.borderRadius !== '0px'
  }
  for (const element of document.querySelectorAll('div, span')) {
    if (blueDot(element) || bluePseudoDot(element, '::before') || bluePseudoDot(element, '::after')) addContainer(element)
  }
  return containers.size
})()`;
const PREPARE_PROBE_SCRIPT = `(() => {
  const containers = [...document.querySelectorAll('body *')]
    .filter(element => {
      const style = getComputedStyle(element)
      return element.scrollHeight > element.clientHeight + 80 && /(auto|scroll)/.test(style.overflowY)
    })
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
  for (const container of containers.slice(0, 3)) container.scrollTop = container.scrollHeight
})()`;
const INSTAGRAM_REQUESTS_SCRIPT = `(() => {
  const requestPattern = /(?:solicitaç(?:ão|ões)|solicitud(?:es)?|message requests?|hidden requests?|solicitações ocultas|solicitudes ocultas)/i
  const numberPattern = /(?:^|\\s|\\()([0-9]{1,3})(?:\\s|$|\\))/
  const targets = new Set()

  for (const element of document.querySelectorAll('a, button, [role="button"], [aria-label]')) {
    const text = [element.textContent || '', element.getAttribute('aria-label') || ''].join(' ').trim()
    if (!requestPattern.test(text)) continue
    targets.add(element.closest('a, button, [role="button"]') || element)
  }

  const counts = { requests: 0, hidden: 0, rows: 0 }
  for (const target of targets) {
    const candidates = [target, ...target.querySelectorAll('[aria-label], [data-testid], span')]
    let count = 0
    for (const candidate of candidates) {
      const text = [candidate.textContent || '', candidate.getAttribute('aria-label') || ''].join(' ').trim()
      const match = text.match(numberPattern)
      if (match) count = Math.max(count, Number(match[1]))
      if (candidate.matches('[data-testid*="unread" i], [aria-label*="unread" i], [aria-label*="não lida" i]')) count = Math.max(count, 1)
    }
    const text = target.textContent || ''
    if (/hidden|ocult|oculta|ocultas/i.test(text)) counts.hidden += count
    else counts.requests += count
  }

  const requestRows = new Set()
  for (const element of document.querySelectorAll('button, [role="button"]')) {
    const text = (element.textContent || '').trim()
    if (!/(confirmar|confirm|aceitar|accept|excluir|delete|remover|remove|recusar|decline)/i.test(text)) continue
    requestRows.add(element.closest('[role="listitem"], [role="row"]') || element.parentElement?.parentElement || element.parentElement)
  }
  counts.rows = requestRows.size
  return counts
})()`;
const DIGITS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"]
};
function crc32(buffer) {
  let crc = 4294967295;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  const result = Buffer.allocUnsafe(4);
  result.writeUInt32BE((crc ^ 4294967295) >>> 0, 0);
  return result;
}
function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, typeBuffer, data, crc32(Buffer.concat([typeBuffer, data]))]);
}
function createTaskbarBadge(count) {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  const label = count > 99 ? "99+" : String(count);
  const glyphWidth = 3;
  const glyphGap = 1;
  const textWidth = label.length * glyphWidth + (label.length - 1) * glyphGap;
  const textX = Math.floor((size - textWidth) / 2);
  const textY = 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5);
      if (distance > 7.5) continue;
      const offset = (y * size + x) * 4;
      pixels[offset] = 229;
      pixels[offset + 1] = 57;
      pixels[offset + 2] = 53;
      pixels[offset + 3] = 255;
    }
  }
  for (let character = 0; character < label.length; character++) {
    const glyph = DIGITS[label[character]];
    const startX = textX + character * (glyphWidth + glyphGap);
    for (let y = 0; y < glyph.length; y++) {
      for (let x = 0; x < glyph[y].length; x++) {
        if (glyph[y][x] !== "1") continue;
        const pixelX = startX + x;
        const pixelY = textY + y;
        const offset = (pixelY * size + pixelX) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = 255;
      }
    }
  }
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    scanlines[y * (size * 4 + 1)] = 0;
    pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
class OfficialViews {
  window = null;
  instagram = null;
  instagramHeader = null;
  instagramProbe = null;
  instagramAutomationProbe = null;
  whatsapp = null;
  visible = false;
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  zoomPercent = 100;
  audioVolume = 100;
  viewMode = "both";
  unreadTimer = null;
  unreadRefreshTimer = null;
  automationTimer = null;
  unreadPolling = false;
  instagramProbeBusy = false;
  automationEnabled = false;
  automationGlobalEnabled = false;
  automationText = "";
  automaticReplies = [];
  automationPrimed = false;
  automationBusy = false;
  automationKnownStates = {};
  automationAllowProcessedOnce = false;
  lastAutomationDiagnostic = "";
  unreadCount = -1;
  whatsappUnreadCount = 0;
  instagramCounts = { inbox: 0, requests: 0, hidden: 0 };
  automationLogs = [];
  automationController = new AutomationController();
  isVisible() {
    return this.visible;
  }
  attach(window) {
    this.window = window;
    this.automationController.register({ platform: "instagram", run: () => this.runInstagramAutomation() });
    this.automationController.register({ platform: "whatsapp", run: () => this.runWhatsAppAutomation() });
    this.automationGlobalEnabled = getAppSetting("automation-global-enabled") === "true";
    this.automationEnabled = getAppSetting("automation-enabled") === "true";
    this.automationText = getAppSetting("automation-text") || "";
    try {
      const savedReplies = JSON.parse(getAppSetting("automatic-replies") || "[]");
      this.automaticReplies = Array.isArray(savedReplies) ? savedReplies.filter((reply) => reply.message?.trim()).map((reply) => ({ message: reply.message.trim(), start: reply.start, end: reply.end })) : [];
    } catch {
      this.automaticReplies = [];
    }
    window.on("resize", () => this.resize());
    window.on("closed", () => {
      this.window = null;
      this.instagram = null;
      this.instagramHeader = null;
      if (this.instagramProbe && !this.instagramProbe.webContents.isDestroyed()) this.instagramProbe.webContents.close();
      this.instagramProbe = null;
      if (this.instagramAutomationProbe && !this.instagramAutomationProbe.webContents.isDestroyed()) this.instagramAutomationProbe.webContents.close();
      this.instagramAutomationProbe = null;
      this.whatsapp = null;
      this.visible = false;
      this.stopUnreadPolling();
      this.updateTaskbarBadge(0);
    });
    this.syncAutomationState();
  }
  async toggle() {
    if (this.visible) {
      this.hide();
      return false;
    }
    await this.show();
    return true;
  }
  reload() {
    for (const view of [this.instagram, this.whatsapp]) {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.reloadIgnoringCache();
      }
    }
  }
  setSidebarWidth(width) {
    this.sidebarWidth = Math.max(64, Math.min(320, Math.round(width)));
    this.resize();
  }
  setZoom(percent) {
    this.zoomPercent = Math.max(50, Math.min(150, Math.round(percent)));
    for (const view of [this.instagram, this.whatsapp]) {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.setZoomFactor(this.zoomPercent / 100);
      }
    }
  }
  setAudioVolume(volume) {
    this.audioVolume = Math.max(0, Math.min(100, Math.round(volume)));
    for (const view of [this.instagram, this.whatsapp]) {
      this.applyAudioVolume(view);
    }
  }
  getAudioVolume() {
    return this.audioVolume;
  }
  applyAudioVolume(view) {
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.setAudioMuted(this.audioVolume === 0);
    const hideInstagramControls = view === this.instagram;
    const hideWhatsAppControls = view === this.whatsapp;
    void view.webContents.executeJavaScript(`(() => {
      const volume = ${this.audioVolume / 100}
      const apply = media => {
        media.volume = volume
        media.muted = volume === 0
        media.controls = false
      }
      const hideControls = () => {
        if (${hideInstagramControls}) {
          let style = document.getElementById('message-manager-hide-audio-controls')
          if (!style) {
            style = document.createElement('style')
            style.id = 'message-manager-hide-audio-controls'
            style.textContent = 'video::-webkit-media-controls-volume-control-container, video::-webkit-media-controls-mute-button, [role="slider"][aria-valuemin="0"][aria-valuemax="100"] { display: none !important; }'
            document.documentElement.appendChild(style)
          }
          const audioPattern = /volume|audio|sound|mute|unmute|som|silenc/i
          document.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid], [data-tooltip-content]').forEach(control => {
            const label = [
              control.getAttribute('aria-label') || '',
              control.getAttribute('title') || '',
              control.getAttribute('data-testid') || '',
              control.getAttribute('data-tooltip-content') || ''
            ].join(' ')
            if (audioPattern.test(label)) control.style.display = 'none'
          })
        }
        if (${hideWhatsAppControls}) {
          const volumeBar = document.querySelector('[data-testid="volume-bar-container"]')
          const volumeControl = volumeBar?.parentElement
          if (volumeControl) volumeControl.style.display = 'none'
          document.querySelectorAll('[data-testid="video-volume"], [data-testid="volume-bar-container"], input[aria-label="Volume"]').forEach(control => {
            control.style.display = 'none'
          })
        }
      }
      const applyAll = () => {
        document.querySelectorAll('audio, video').forEach(apply)
        hideControls()
      }
      document.querySelectorAll('audio, video').forEach(apply)
      window.__messageManagerAudioApply = applyAll
      if (!window.__messageManagerAudioObserver) {
        window.__messageManagerAudioObserver = new MutationObserver(() => {
          window.__messageManagerAudioApply?.()
        })
        window.__messageManagerAudioObserver.observe(document.documentElement, { childList: true, subtree: true })
      }
      applyAll()
    })()`, true).catch(() => {
    });
  }
  setViewMode(mode) {
    this.viewMode = mode === "instagram" || mode === "whatsapp" ? mode : "both";
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setMinimumSize(this.viewMode === "both" ? MIN_SPLIT_VIEW_WIDTH : MIN_SINGLE_VIEW_WIDTH, 600);
    if (!this.visible) return;
    for (const view of [this.instagramHeader, this.instagram, this.whatsapp]) {
      if (view) this.window.contentView.removeChildView(view);
    }
    if (this.viewMode !== "whatsapp" && this.instagramHeader) this.window.contentView.addChildView(this.instagramHeader);
    if (this.viewMode === "instagram" && this.instagram) this.window.contentView.addChildView(this.instagram);
    if (this.viewMode === "whatsapp" && this.whatsapp) this.window.contentView.addChildView(this.whatsapp);
    if (this.viewMode === "both") {
      if (this.instagram) this.window.contentView.addChildView(this.instagram);
      if (this.whatsapp) this.window.contentView.addChildView(this.whatsapp);
    }
    this.resize();
  }
  getUnreadCount() {
    return Math.max(0, this.unreadCount);
  }
  getWhatsAppUnreadCount() {
    return Math.max(0, this.whatsappUnreadCount);
  }
  getInstagramCounts() {
    return this.instagramCounts;
  }
  getAutomationStatus() {
    const configured = this.hasConfiguredAutomation();
    return {
      enabled: this.automationGlobalEnabled && configured,
      configured,
      globalEnabled: this.automationGlobalEnabled,
      running: this.automationBusy
    };
  }
  getAutomationLogs() {
    return listAutomationLogs();
  }
  clearAutomationLogs() {
    this.automationLogs = [];
    clearAutomationLogs();
    this.broadcastAutomationLogs();
  }
  resetAutomationRuntime() {
    resetAutomationRuntime();
    this.automationKnownStates = {};
    this.automationPrimed = false;
    this.lastAutomationDiagnostic = "";
  }
  setInstagramAutomation(enabled2, text, automaticReplies = []) {
    this.automationEnabled = Boolean(enabled2);
    this.automationText = text.trim();
    this.automaticReplies = automaticReplies.filter((reply) => reply.message.trim()).map((reply) => ({ message: reply.message.trim(), start: reply.start, end: reply.end }));
    setAppSetting("automation-enabled", String(this.automationEnabled));
    setAppSetting("automation-text", this.automationText);
    setAppSetting("automatic-replies", JSON.stringify(this.automaticReplies));
    this.automationPrimed = false;
    this.automationKnownStates = {};
    writeAutomationDebug("config", { enabled: this.automationEnabled, hasText: Boolean(this.automationText), automaticReplies: this.automaticReplies.length });
    this.syncAutomationState();
  }
  setGlobalAutomation(enabled2) {
    this.automationGlobalEnabled = Boolean(enabled2);
    setAppSetting("automation-global-enabled", String(this.automationGlobalEnabled));
    this.automationPrimed = false;
    this.automationKnownStates = {};
    this.automationAllowProcessedOnce = this.automationGlobalEnabled;
    writeAutomationDebug("global-toggle", { enabled: this.automationGlobalEnabled });
    this.syncAutomationState();
  }
  refreshAutomationStatus() {
    this.syncAutomationState();
  }
  syncAutomationState() {
    const active = this.automationGlobalEnabled && this.hasConfiguredAutomation();
    if (active && !this.automationTimer) {
      this.automationTimer = setInterval(() => void this.automationController.run(), 2e3);
      void this.automationController.run();
    } else if (!active && this.automationTimer) {
      clearInterval(this.automationTimer);
      this.automationTimer = null;
    }
    this.sendAutomationStatus(false);
  }
  hasConfiguredAutomation() {
    return this.automationEnabled && (Boolean(this.automationText) || this.automaticReplies.length > 0) || listAutomationFlows().some((flow) => flow.enabled);
  }
  navigateInstagram(section) {
    if (!this.instagram || this.instagram.webContents.isDestroyed()) return;
    void this.instagram.webContents.loadURL(INSTAGRAM_ROUTES[section]);
    this.scheduleUnreadPoll(800);
  }
  createView(url) {
    const view = new electron.WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    });
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      electron.shell.openExternal(target);
      return { action: "deny" };
    });
    view.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "i") {
        event.preventDefault();
        if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools();
        else view.webContents.openDevTools({ mode: "detach" });
      }
    });
    if (url.includes("web.whatsapp.com")) {
      view.webContents.setUserAgent(CHROME_USER_AGENT);
      const webContents = view.webContents;
      webContents.session.setPermissionRequestHandler((requestingContents, permission, callback) => {
        const isWhatsApp = requestingContents === webContents && requestingContents.getURL().includes("web.whatsapp.com");
        callback(isWhatsApp && (permission === "media" || permission === "notifications"));
      });
      webContents.session.setPermissionCheckHandler((requestingContents, permission) => {
        const isWhatsApp = requestingContents === webContents && requestingContents.getURL().includes("web.whatsapp.com");
        return isWhatsApp && (permission === "media" || permission === "notifications");
      });
    }
    this.applyAudioVolume(view);
    if (url.includes("instagram.com")) {
      view.webContents.on("did-finish-load", () => this.scheduleUnreadPoll(600));
      view.webContents.on("did-navigate-in-page", () => this.scheduleUnreadPoll(400));
    }
    view.webContents.setZoomFactor(this.zoomPercent / 100);
    void view.webContents.loadURL(url);
    return view;
  }
  createInstagramHeader() {
    const header = new electron.WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    });
    header.webContents.on("did-finish-load", () => {
      header.webContents.send("instagram:counts", this.instagramCounts);
    });
    if (process.env.ELECTRON_RENDERER_URL) {
      void header.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}?instagram-header=1`);
    } else {
      void header.webContents.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { "instagram-header": "1" } });
    }
    return header;
  }
  createInstagramProbe() {
    return new electron.WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    });
  }
  async getInstagramAutomationProbe() {
    this.instagramAutomationProbe ??= this.createInstagramProbe();
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.contentView.addChildView(this.instagramAutomationProbe);
        this.instagramAutomationProbe.setBounds({ x: -1600, y: -900, width: 1200, height: 800 });
      } catch {
      }
    }
    const webContents = this.instagramAutomationProbe.webContents;
    if (webContents.getURL() !== INSTAGRAM_ROUTES.inbox) {
      try {
        writeAutomationDebug("probe-load", { url: INSTAGRAM_ROUTES.inbox });
        await webContents.loadURL(INSTAGRAM_ROUTES.inbox);
        await this.waitForAutomationInbox(webContents);
      } catch {
        return null;
      }
    }
    return this.instagramAutomationProbe;
  }
  async waitForAutomationInbox(webContents) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ready = await webContents.executeJavaScript(`document.querySelectorAll('[role="button"] img[alt="user-profile-picture"]').length > 0`, true).catch(() => false);
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async show() {
    if (!this.window || this.window.isDestroyed()) return;
    this.instagram ??= this.createView("https://www.instagram.com/direct/inbox/");
    this.instagramHeader ??= this.createInstagramHeader();
    this.instagramProbe ??= this.createInstagramProbe();
    this.applyAudioVolume(this.instagram);
    this.whatsapp ??= this.createView("https://web.whatsapp.com/");
    this.applyAudioVolume(this.whatsapp);
    this.window.contentView.addChildView(this.instagramHeader);
    this.window.contentView.addChildView(this.instagram);
    this.window.contentView.addChildView(this.whatsapp);
    this.visible = true;
    this.setViewMode(this.viewMode);
    this.resize();
    this.startUnreadPolling();
  }
  hide() {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.instagram) this.window.contentView.removeChildView(this.instagram);
    if (this.instagramHeader) this.window.contentView.removeChildView(this.instagramHeader);
    if (this.whatsapp) this.window.contentView.removeChildView(this.whatsapp);
    this.visible = false;
    this.stopUnreadPolling();
    if (this.automationTimer) clearInterval(this.automationTimer);
    this.automationTimer = null;
    this.updateTaskbarBadge(0);
  }
  startUnreadPolling() {
    if (this.unreadTimer) return;
    void this.pollUnread();
    this.unreadTimer = setInterval(() => void this.pollUnread(), 5e3);
  }
  stopUnreadPolling() {
    if (this.unreadTimer) clearInterval(this.unreadTimer);
    if (this.unreadRefreshTimer) clearTimeout(this.unreadRefreshTimer);
    this.unreadTimer = null;
    this.unreadRefreshTimer = null;
    this.unreadPolling = false;
  }
  scheduleUnreadPoll(delay) {
    if (!this.visible || this.unreadRefreshTimer) return;
    this.unreadRefreshTimer = setTimeout(() => {
      this.unreadRefreshTimer = null;
      void this.pollUnread();
    }, delay);
  }
  async pollUnread() {
    if (this.unreadPolling) return;
    this.unreadPolling = true;
    try {
      const [instagramTotal, whatsappCount] = await Promise.all([
        this.pollInstagramProbe(),
        this.countUnread(this.whatsapp)
      ]);
      this.whatsappUnreadCount = whatsappCount;
      this.updateTaskbarBadge(instagramTotal + whatsappCount);
    } finally {
      this.unreadPolling = false;
    }
  }
  async countUnread(view) {
    if (!view || view.webContents.isDestroyed() || !view.webContents.getURL()) return 0;
    try {
      return Number(await view.webContents.executeJavaScript(UNREAD_SCRIPT, true)) || 0;
    } catch {
      return 0;
    }
  }
  async runInstagramAutomation() {
    if (this.automationBusy || !this.automationGlobalEnabled || !this.hasConfiguredAutomation()) return;
    this.automationBusy = true;
    this.sendAutomationStatus(true);
    writeAutomationDebug("cycle-start");
    try {
      const automationProbe = await this.getInstagramAutomationProbe();
      if (!automationProbe || automationProbe.webContents.isDestroyed()) return;
      await automationProbe.webContents.executeJavaScript(`(() => {
        const notification = document.querySelector('[aria-label*="nova notificação" i], [aria-label*="new notification" i]')
        const inboxLink = document.querySelector('a[href="/direct/inbox/"]')
        if (notification && inboxLink) inboxLink.click()
      })()`, true).catch(() => {
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const flows = listAutomationFlows().filter((flow) => flow.enabled).map((flow) => {
        try {
          const definition = JSON.parse(flow.definition);
          const fallbackNode = definition.nodes?.find((node) => node.id === definition.fallbackNodeId) || definition.nodes?.find((node) => node.type === "fallback");
          const messageNode = definition.nodes?.find((node) => node.type === "message" && node.text?.trim());
          const responseEdges = (definition.edges || []).filter((edge) => edge.from === messageNode?.id);
          const endNodeIds = new Set((definition.nodes || []).filter((node) => node.type === "end").map((node) => node.id));
          return {
            id: flow.id,
            keywords: (definition.trigger?.keywords || []).map((keyword) => keyword.toLocaleLowerCase()).filter(Boolean),
            response: definition.actions?.find((action) => action.type === "reply")?.text?.trim() || messageNode?.text?.trim() || "",
            fallbackResponse: fallbackNode?.text?.trim() || "",
            completed: Boolean(messageNode && (responseEdges.length === 0 || responseEdges.some((edge) => endNodeIds.has(edge.to))))
          };
        } catch {
          return { id: flow.id, keywords: [], response: "", fallbackResponse: "", completed: false };
        }
      }).filter((flow) => flow.keywords.length > 0 && flow.response || flow.fallbackResponse);
      writeAutomationDebug("flows-loaded", { flows: flows.map((flow) => ({ id: flow.id, keywords: flow.keywords, responseLength: flow.response.length, fallbackLength: flow.fallbackResponse.length })) });
      const processedMessageIds = listProcessedMessageIds("instagram");
      const activeFlowStates = Object.fromEntries(listConversationStates("instagram").filter((state) => state.state === "awaiting_reply" && state.flowId && Date.now() - Date.parse(state.updatedAt) < 3 * 60 * 60 * 1e3).map((state) => [state.conversationId, { flowId: state.flowId, updatedAt: state.updatedAt }]));
      const result = await automationProbe.webContents.executeJavaScript(createInstagramAutoReplyScript(this.automationText, !this.automationPrimed, this.automationAllowProcessedOnce, flows, processedMessageIds, this.automationKnownStates, this.automaticReplies, activeFlowStates), true);
      this.automationKnownStates = result.states || this.automationKnownStates;
      this.automationPrimed = true;
      this.automationAllowProcessedOnce = false;
      writeAutomationDebug("cycle-result", {
        status: result.status,
        diagnostic: result.diagnostic,
        conversation: result.conversation || null,
        flowId: result.flowId || null
      });
      if (result.status === "idle" && result.diagnostic) {
        const diagnostic = `${result.diagnostic.url || "sem URL"}|${result.diagnostic.rows || 0}|${result.diagnostic.markers || 0}|${result.diagnostic.skippedState || 0}|${result.diagnostic.skippedProcessed || 0}|${result.diagnostic.skippedReply || 0}`;
        if (diagnostic !== this.lastAutomationDiagnostic) {
          this.lastAutomationDiagnostic = diagnostic;
          this.addAutomationLog({
            conversation: "Monitor do Instagram",
            action: "reply",
            status: "failed",
            detail: `Nenhuma resposta: ${result.diagnostic.rows || 0} conversas, ${result.diagnostic.markers || 0} não lidas, ${result.diagnostic.eligible || 0} elegíveis, ${result.diagnostic.skippedState || 0} estado, ${result.diagnostic.skippedProcessed || 0} processadas, ${result.diagnostic.skippedReply || 0} sem resposta`
          });
        }
      }
      if (result?.status === "sent") {
        if (result.conversationId && result.ownState) this.automationKnownStates[result.conversationId] = result.ownState;
        if (result.messageId) markProcessedMessage("instagram", result.messageId);
        if (result.conversationId) {
          upsertConversationState({
            platform: "instagram",
            conversationId: result.conversationId,
            flowId: result.flowId,
            currentState: result.completed ? "completed" : "awaiting_reply"
          });
        }
        this.addAutomationLog({
          conversation: result.conversation || "Conversa sem nome",
          action: "reply",
          status: "sent",
          detail: "Resposta automática enviada"
        });
      }
    } catch {
      writeAutomationDebug("cycle-error");
      this.addAutomationLog({
        conversation: "Instagram",
        action: "reply",
        status: "failed",
        detail: "Falha ao executar a automação"
      });
    } finally {
      this.automationBusy = false;
      this.sendAutomationStatus(false);
    }
  }
  async runWhatsAppAutomation() {
    if (!this.whatsapp || this.whatsapp.webContents.isDestroyed()) return;
    writeAutomationDebug("whatsapp-automation", { status: "adapter-not-implemented" });
  }
  addAutomationLog(log) {
    this.automationLogs.unshift({
      ...log,
      id: crypto.randomUUID(),
      at: (/* @__PURE__ */ new Date()).toISOString(),
      platform: "instagram"
    });
    if (this.automationLogs.length > 200) this.automationLogs.length = 200;
    insertAutomationLog(this.automationLogs[0]);
    this.broadcastAutomationLogs();
  }
  broadcastAutomationLogs() {
    electron.BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send("app:automation-logs", this.automationLogs);
    });
  }
  sendAutomationStatus(running) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("app:automation-status", {
      enabled: this.automationGlobalEnabled && this.hasConfiguredAutomation(),
      globalEnabled: this.automationGlobalEnabled,
      configured: this.hasConfiguredAutomation(),
      running
    });
  }
  async pollInstagramProbe() {
    if (this.instagramProbeBusy || !this.instagramProbe || this.instagramProbe.webContents.isDestroyed()) {
      return this.instagramCounts.inbox + this.instagramCounts.requests + this.instagramCounts.hidden;
    }
    this.instagramProbeBusy = true;
    try {
      const visibleUrl = this.instagram?.webContents.getURL() || "";
      const visibleSection = visibleUrl.includes("/direct/requests/hidden") ? "hidden" : visibleUrl.includes("/direct/requests") ? "requests" : visibleUrl.includes("/direct/") ? "inbox" : null;
      const inbox = visibleSection === "inbox" ? await this.countUnread(this.instagram) : await this.loadProbeRoute(INSTAGRAM_ROUTES.inbox) ? await this.countUnread(this.instagramProbe) : this.instagramCounts.inbox;
      const requests = visibleSection === "requests" ? await this.readRequestCount(this.instagram, "requests") : await this.loadProbeRoute(INSTAGRAM_ROUTES.requests) ? await this.readRequestCount(this.instagramProbe, "requests") : this.instagramCounts.requests;
      const hidden = visibleSection === "hidden" ? await this.readRequestCount(this.instagram, "hidden") : await this.loadProbeRoute(INSTAGRAM_ROUTES.hidden) ? await this.readRequestCount(this.instagramProbe, "hidden") : this.instagramCounts.hidden;
      this.instagramCounts = { inbox, requests, hidden };
      if (this.instagramHeader && !this.instagramHeader.webContents.isDestroyed()) {
        this.instagramHeader.webContents.send("instagram:counts", this.instagramCounts);
      }
      return inbox + requests + hidden;
    } finally {
      this.instagramProbeBusy = false;
    }
  }
  async loadProbeRoute(url) {
    if (!this.instagramProbe || this.instagramProbe.webContents.isDestroyed()) return false;
    try {
      if (this.instagramProbe.webContents.getURL() !== url) await this.instagramProbe.webContents.loadURL(url);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await this.instagramProbe.webContents.executeJavaScript(PREPARE_PROBE_SCRIPT, true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    } catch {
      return false;
    }
  }
  async readRequestCount(view, section) {
    if (!view || view.webContents.isDestroyed()) return 0;
    try {
      const result = await view.webContents.executeJavaScript(INSTAGRAM_REQUESTS_SCRIPT, true);
      const labeledCount = Number(result?.[section]) || 0;
      const blueDotCount = await this.countUnread(view);
      return Math.max(labeledCount, blueDotCount, Number(result?.rows) || 0);
    } catch {
      return 0;
    }
  }
  updateTaskbarBadge(count) {
    if (count === this.unreadCount) return;
    this.unreadCount = count;
    electron.app.setBadgeCount(count);
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("app:unread-count", count);
    }
    if (!this.window || this.window.isDestroyed() || process.platform !== "win32") return;
    if (count === 0) {
      this.window.setOverlayIcon(null, "");
      return;
    }
    const label = count > 99 ? "99+" : String(count);
    this.window.setOverlayIcon(electron.nativeImage.createFromBuffer(createTaskbarBadge(count)), `${label} conversas não lidas`);
  }
  resize() {
    if (!this.visible || !this.window) return;
    const { width, height } = this.window.getContentBounds();
    const contentWidth = Math.max(0, width - this.sidebarWidth);
    const contentHeight = Math.max(0, height - OFFICIAL_VIEWS_HEADER_HEIGHT);
    const instagramHeaderHeight = 44;
    const instagramBounds = { y: OFFICIAL_VIEWS_HEADER_HEIGHT + instagramHeaderHeight, height: Math.max(0, contentHeight - instagramHeaderHeight) };
    const standardBounds = { y: OFFICIAL_VIEWS_HEADER_HEIGHT, height: contentHeight };
    if (this.viewMode === "instagram" && this.instagram) {
      this.instagramHeader?.setBounds({ x: this.sidebarWidth, y: OFFICIAL_VIEWS_HEADER_HEIGHT, width: contentWidth, height: instagramHeaderHeight });
      this.instagram.setBounds({ ...instagramBounds, x: this.sidebarWidth, width: contentWidth });
      return;
    }
    if (this.viewMode === "whatsapp" && this.whatsapp) {
      this.whatsapp.setBounds({ ...standardBounds, x: this.sidebarWidth, width: contentWidth });
      return;
    }
    if (!this.instagram || !this.whatsapp) return;
    const panelWidth = Math.floor(contentWidth / 2);
    this.instagramHeader?.setBounds({ x: this.sidebarWidth, y: OFFICIAL_VIEWS_HEADER_HEIGHT, width: panelWidth, height: instagramHeaderHeight });
    this.instagram.setBounds({ ...instagramBounds, x: this.sidebarWidth, width: panelWidth });
    this.whatsapp.setBounds({ ...standardBounds, x: this.sidebarWidth + panelWidth, width: contentWidth - panelWidth });
  }
}
const officialViews = new OfficialViews();
const dialogWindows = /* @__PURE__ */ new Set();
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
  handle("app:reload", () => {
    officialViews.reload();
  });
  handle("app:setSidebarWidth", (width) => officialViews.setSidebarWidth(width));
  handle("app:setZoom", (percent) => officialViews.setZoom(percent));
  handle("app:setAudioVolume", (volume) => officialViews.setAudioVolume(volume));
  handle("app:getAudioVolume", () => officialViews.getAudioVolume());
  handle("app:setViewMode", (mode) => officialViews.setViewMode(mode));
  handle("app:navigateInstagram", (section) => officialViews.navigateInstagram(section));
  handle("app:getUnreadCount", () => officialViews.getUnreadCount());
  handle("app:getWhatsAppUnreadCount", () => officialViews.getWhatsAppUnreadCount());
  handle("app:getInstagramCounts", () => officialViews.getInstagramCounts());
  handle("app:setInstagramAutomation", (enabled2, text, automaticReplies) => officialViews.setInstagramAutomation(enabled2, text, automaticReplies));
  handle("app:setGlobalAutomation", (enabled2) => officialViews.setGlobalAutomation(enabled2));
  handle("app:getAutomationStatus", () => officialViews.getAutomationStatus());
  handle("app:getAutomationLogs", () => officialViews.getAutomationLogs());
  handle("app:clearAutomationLogs", () => officialViews.clearAutomationLogs());
  handle("app:resetAutomationRuntime", () => officialViews.resetAutomationRuntime());
  handle("app:getScheduledMessages", () => listScheduledMessages());
  handle("app:createScheduledMessage", (item) => insertScheduledMessage(item));
  handle("app:deleteScheduledMessage", (id) => deleteScheduledMessage(id));
  handle("app:getAutomationFlows", () => listAutomationFlows());
  handle("app:saveAutomationFlow", (flow) => {
    upsertAutomationFlow(flow);
    officialViews.refreshAutomationStatus();
  });
  handle("app:deleteAutomationFlow", (id) => deleteAutomationFlow(id));
  handle("app:openDialog", (type) => {
    const existingDialog = [...dialogWindows][0];
    if (existingDialog && !existingDialog.isDestroyed()) {
      existingDialog.show();
      existingDialog.focus();
      return;
    }
    const parent = electron.BrowserWindow.getAllWindows().find((window) => !dialogWindows.has(window));
    if (!parent || parent.isDestroyed()) return;
    const parentBounds = parent.getContentBounds();
    const dialogWidth = Math.max(440, Math.round(parentBounds.width * 0.8));
    const dialogHeight = Math.max(420, Math.round(parentBounds.height * 0.8));
    const dialogWindow = new electron.BrowserWindow({
      parent,
      width: dialogWidth,
      height: dialogHeight,
      minWidth: 440,
      minHeight: 420,
      frame: false,
      show: false,
      resizable: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    dialogWindows.add(dialogWindow);
    dialogWindow.once("ready-to-show", () => {
      dialogWindow?.center();
      dialogWindow?.show();
    });
    dialogWindow.on("closed", () => {
      dialogWindows.delete(dialogWindow);
    });
    if (process.env.ELECTRON_RENDERER_URL) {
      void dialogWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?dialog=${type}`);
    } else {
      void dialogWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { dialog: type } });
    }
  });
  handle("app:closeDialog", () => {
    const focusedWindow = electron.BrowserWindow.getFocusedWindow();
    if (focusedWindow && dialogWindows.has(focusedWindow)) focusedWindow.close();
  });
  handle("debug:getEnabled", () => debug.enabled);
  debug.onToggle((enabled2) => {
    broadcast("debug:toggle", enabled2);
  });
}
function handleRenderError(details) {
  debug.renderError(details);
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
  officialViews.attach(mainWindow);
  void officialViews.show();
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
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
