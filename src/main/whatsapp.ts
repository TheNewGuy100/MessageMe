import { EventEmitter } from 'events'
import QR from 'qrcode'
import { useSqliteAuthState } from './auth-sqlite'
import {
  storeDelete,
  storeGet,
  storeSet,
  waClearAll,
  waClearData,
  waListChats,
  waListMessages,
  waListPendingOutbox,
  waEnqueueOutbox,
  waRecoverOutbox,
  waUpdateOutbox,
  waUpsertChat,
  waUpsertMessage
} from './database'
import { debug } from './debug'

let makeWASocket: any, downloadMediaMessage: any, BufferJSON: any

async function loadBaileys() {
  const m = await import('@whiskeysockets/baileys')
  makeWASocket = m.default
  downloadMediaMessage = m.downloadMediaMessage
  BufferJSON = m.BufferJSON
}

export type WhatsappEvent = 'connecting' | 'qr' | 'connected' | 'disconnected' | 'message' | 'chatsUpdated' | 'error'

function makeLogger(label: string) {
  const noop = () => {}
  const log = (fn: string) => (msg: any, ...args: any[]) => {
    if (msg && typeof msg === 'object' && 'histNotification' in msg) {
      debug.browserLog(`[WA:${label}] ${fn}:`, msg, ...args)
      return
    }
    if (typeof msg === 'string') console.log(`[WA:${label}] ${fn}:`, msg, ...args)
    else console.log(`[WA:${label}] ${fn}:`, msg)
  }
  const child = () => makeLogger(label + '.c')
  return { info: log('info'), warn: log('warn'), error: log('error'), debug: noop, trace: noop, fatal: log('fatal'), child }
}

function timestampValue(value: any): number {
  if (value && typeof value === 'object' && typeof value.low === 'number') {
    return value.low + (value.high || 0) * 4294967296
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function chatTimestamp(chat: any): number {
  return Math.max(
    timestampValue(chat?.conversationTimestamp),
    timestampValue(chat?.lastMessage?.messageTimestamp),
    timestampValue(chat?.lastMessageTimestamp),
    timestampValue(chat?.lastTimestamp),
    timestampValue(chat?.timestamp)
  )
}

function messageTimestamp(message: any): number {
  const value = message?.messageTimestamp ?? message?.timestamp ?? message?.message?.messageTimestamp
  return timestampValue(value)
}

function sortMessages(messages: any[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const timestampDifference = messageTimestamp(a.message) - messageTimestamp(b.message)
      if (timestampDifference) return timestampDifference
      const idDifference = String(a.message.key?.id || a.message.id || '').localeCompare(String(b.message.key?.id || b.message.id || ''))
      return idDifference || a.index - b.index
    })
    .map(({ message }) => message)
}

function hasMessagePayload(message: any): boolean {
  if (!message?.message || typeof message.message !== 'object') return false
  return Object.keys(message.message).some(key => key !== 'protocolMessage' && key !== 'messageContextInfo')
}

function latestMessage(messages: any[]) {
  return sortMessages(messages.filter(hasMessagePayload)).at(-1)
}

function disconnectDetails(error: any) {
  if (!error) return null
  const output = error.output || {}
  const data = output.payload?.data ?? output.data ?? error.data
  return {
    name: error.name,
    message: error.message,
    statusCode: output.statusCode ?? error.statusCode,
    data: typeof data === 'string' || typeof data === 'number' ? data : undefined,
    stack: error.stack
  }
}

function contactKeys(value: any): string[] {
  if (!value) return []
  const key = String(value)
  const bare = key.split('@')[0]
  return [...new Set([key, bare].filter(Boolean))]
}

function isPlaceholderName(name: any, chatId: any): boolean {
  if (!name) return true
  const normalizedName = String(name).replace(/[^0-9]/g, '')
  const normalizedId = String(chatId || '').split('@')[0].replace(/[^0-9]/g, '')
  return Boolean(normalizedName && normalizedId && normalizedName === normalizedId)
}

class WhatsAppService extends EventEmitter {
  private sock: any = null
  private qrBase64: string | null = null
  private status: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
  private chats: any[] = []
  private contactNames: Map<string, string> = new Map()
  private messagesByChat: Map<string, any[]> = new Map()
  private initPromise: Promise<void> | null = null
  private saveCreds: (() => void) | null = null
  private reconnectTimer: any = null
  private connecting = false
  private qrTimeout: any = null
  private historySyncing = false
  private cacheLoaded = false
  private persistTimer: any = null
  private historyFetches = 0
  private historyCompleteTimer: any = null
  private historyStatusComplete = false
  private outboxRunning = false

  getStatus() { return this.status }
  getQRCode() { return this.qrBase64 }
  getHistorySyncing() { return this.historySyncing }
  getChats() { return this.sortedChats() }

  getMessages(chatId: string) {
    return sortMessages([...(this.messagesByChat.get(chatId) || [])].filter(hasMessagePayload)).slice(-50)
  }

  async getOlderMessages(chatId: string, beforeId: string) {
    const getSorted = () => sortMessages([...(this.messagesByChat.get(chatId) || [])].filter(hasMessagePayload))
    let messages = getSorted()
    let index = messages.findIndex(message => message.key?.id === beforeId)

    if (index <= 0 && this.sock && messages[0]?.key) {
      this.historyFetches++
      try {
        await this.sock.fetchMessageHistory(50, messages[0].key, messageTimestamp(messages[0]))
        await new Promise(resolve => setTimeout(resolve, 1200))
        messages = getSorted()
        index = messages.findIndex(message => message.key?.id === beforeId)
      } catch (error: any) {
        console.warn('[WA] não foi possível buscar mensagens antigas:', error?.message || error)
      } finally {
        this.historyFetches--
      }
    }

    if (index <= 0) return { messages: [], hasMore: false }
    const older = messages.slice(Math.max(0, index - 50), index)
    return { messages: older, hasMore: index - older.length > 0 }
  }

  async getMedia(chatId: string, messageId: string) {
    if (!downloadMediaMessage) await this.ensureBaileys()
    const message = this.messagesByChat.get(chatId)?.find(msg => msg.key?.id === messageId)
    const content = message?.message?.ephemeralMessage?.message
      || message?.message?.viewOnceMessage?.message
      || message?.message
    if (!content) return null

    const media = content.imageMessage
      ? { value: content.imageMessage, type: 'image', mime: 'image/jpeg' }
      : content.videoMessage
        ? { value: content.videoMessage, type: 'video', mime: 'video/mp4' }
        : content.audioMessage
          ? { value: content.audioMessage, type: 'audio', mime: 'audio/ogg' }
          : content.stickerMessage
            ? { value: content.stickerMessage, type: 'sticker', mime: 'image/webp' }
            : content.documentMessage
              ? { value: content.documentMessage, type: 'document', mime: 'application/octet-stream' }
              : null
    if (!media) return null

    try {
      const buffer = await downloadMediaMessage(message, 'buffer', {}, {
        logger: makeLogger('media'),
        reuploadRequest: async (staleMessage: any) => {
          const updatedMessage = await this.sock.updateMediaMessage(staleMessage)
          this.storeMessage(updatedMessage)
          this.persistCache()
          return updatedMessage
        }
      })
      const mime = media.value.mimetype || media.mime
      return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`
    } catch (error: any) {
      return null
    }
  }

  private storeMessage(msg: any) {
    const chatId = msg.key?.remoteJid
    if (!chatId || !hasMessagePayload(msg)) return
    const messageId = msg.key?.id || msg.id
    if (!messageId) return
    let msgs = this.messagesByChat.get(chatId)
    if (!msgs) { msgs = []; this.messagesByChat.set(chatId, msgs) }
    const idx = msgs.findIndex(m => (m.key?.id || m.id) === messageId)
    if (idx === -1) msgs.push(msg)
    else msgs[idx] = msg
    if (msgs.length > 5000) msgs.splice(0, msgs.length - 5000)
    waUpsertMessage(chatId, messageId, messageTimestamp(msg), JSON.stringify(msg, BufferJSON?.replacer))
  }

  private persistChats() {
    for (const chat of this.chats) {
      if (chat.id) waUpsertChat(chat.id, JSON.stringify(chat, BufferJSON?.replacer))
    }
  }

  private restoreCache() {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      const raw = storeGet('whatsapp', 'cache')
      const storedChats = waListChats()
      const storedMessages = waListMessages()
      if (storedChats.length) {
        this.chats = storedChats.map(row => JSON.parse(row.data, BufferJSON?.reviver))
      }
      if (storedMessages.length) {
        this.messagesByChat = new Map()
        for (const row of storedMessages) {
          const messages = this.messagesByChat.get(row.chat_id) || []
          messages.push(JSON.parse(row.data, BufferJSON?.reviver))
          this.messagesByChat.set(row.chat_id, messages)
        }
      }
      if (!storedChats.length && !storedMessages.length && raw) {
        const cache = JSON.parse(raw, BufferJSON?.reviver)
        this.chats = cache.chats || []
        this.messagesByChat = new Map(cache.messages || [])
      }
      for (const chat of this.chats) {
        const validLastMessage = latestMessage(this.messagesByChat.get(chat.id) || [])
        if (validLastMessage && !hasMessagePayload(chat.lastMessage)) {
          chat.lastMessage = validLastMessage
          chat.lastTimestamp = messageTimestamp(validLastMessage)
          chat.conversationTimestamp = messageTimestamp(validLastMessage)
        }
      }
      console.log('[WA] cache restaurado:', this.chats.length, 'chats')
    } catch (error) {
      console.warn('[WA] não foi possível restaurar cache:', error)
    }
  }

  private persistCache() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      try {
        storeSet('whatsapp', 'cache', JSON.stringify({
          chats: this.chats,
          messages: [...this.messagesByChat.entries()]
        }, BufferJSON?.replacer))
      } catch (error) {
        console.warn('[WA] não foi possível persistir cache:', error)
      }
    }, 1000)
  }

  private mergeChat(chat: any) {
    const contactName = contactKeys(chat.id)
      .map(key => this.contactNames.get(key))
      .find(Boolean)
    if (contactName && isPlaceholderName(chat.name, chat.id)) return { ...chat, name: contactName }
    return chat
  }

  private sortedChats() {
    return [...this.chats].sort((a, b) => chatTimestamp(b) - chatTimestamp(a))
  }

  private updateContacts(contacts: any[]) {
    for (const contact of contacts || []) {
      const name = contact.name || contact.notify || contact.verifiedName
      if (!contact.id || !name) continue
      const aliases = [contact.id, contact.lid, contact.phoneNumber, contact.pnJid]
        .flatMap(contactKeys)
      for (const alias of aliases) this.contactNames.set(alias, name)
      const chat = this.chats.find(item => aliases.some(alias => contactKeys(item.id).includes(alias)))
      if (chat && isPlaceholderName(chat.name, chat.id)) chat.name = name
    }
  }

  private ensureChatFromMessage(msg: any) {
    const chatId = msg.key?.remoteJid
    if (!chatId || chatId === 'status@broadcast' || !hasMessagePayload(msg)) return
    const timestamp = messageTimestamp(msg)
    const idx = this.chats.findIndex(chat => chat.id === chatId)
    if (idx === -1) {
      this.chats.push(this.mergeChat({
        id: chatId,
        name: msg.pushName,
        lastMessage: msg,
        lastTimestamp: timestamp,
        conversationTimestamp: timestamp
      }))
    } else if (timestamp >= chatTimestamp(this.chats[idx])) {
      this.chats[idx].lastMessage = msg
      this.chats[idx].lastTimestamp = timestamp
      this.chats[idx].conversationTimestamp = timestamp
      if (msg.pushName && isPlaceholderName(this.chats[idx].name, chatId)) {
        this.chats[idx].name = msg.pushName
      }
    } else if (msg.pushName && isPlaceholderName(this.chats[idx].name, chatId)) {
      this.chats[idx].name = msg.pushName
    }
  }

  async getProfilePicture(jid: string) {
    if (!this.sock) return null
    try {
      return await this.sock.profilePictureUrl(jid)
    } catch { return null }
  }

  async clearCreds() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    waClearAll()
    this.qrBase64 = null
    storeDelete('whatsapp', 'cache')
    this.chats = []
    this.messagesByChat.clear()
    this.cacheLoaded = false
  }

  async clearDatabase() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    waClearData()
    this.chats = []
    this.contactNames.clear()
    this.messagesByChat.clear()
    this.emit('chatsUpdated', [])
    this.emit('messagesUpdated', [])
  }

  private async sendOutboxRow(row: any) {
    if (!this.sock || this.status !== 'connected') throw new Error('WhatsApp não conectado')
    const attempts = Number(row.attempts || 0) + 1
    waUpdateOutbox(row.id, 'sending', attempts)
    try {
      const payload = JSON.parse(row.data)
      if (row.kind === 'text') {
        await this.sock.sendMessage(row.chat_id, { text: payload.text })
      } else if (row.kind === 'media') {
        const buffer = Buffer.from(payload.data, 'base64')
        const mime = String(payload.mimeType || '').toLowerCase()
        if (mime.startsWith('image/') && mime !== 'image/gif') {
          await this.sock.sendMessage(row.chat_id, { image: buffer, caption: payload.caption || undefined, mimetype: mime })
        } else if (mime.startsWith('video/') || mime === 'image/gif') {
          await this.sock.sendMessage(row.chat_id, {
            video: buffer,
            caption: payload.caption || undefined,
            mimetype: mime === 'image/gif' ? 'video/mp4' : mime,
            gifPlayback: String(payload.fileName || '').toLowerCase().endsWith('.gif')
          })
        } else if (mime.startsWith('audio/')) {
          await this.sock.sendMessage(row.chat_id, { audio: buffer, mimetype: mime, ptt: true })
        } else {
          throw new Error('Formato de mídia não suportado')
        }
      } else {
        throw new Error(`Tipo de envio desconhecido: ${row.kind}`)
      }
      waUpdateOutbox(row.id, 'sent', attempts)
    } catch (error: any) {
      const delay = Math.min(60000, 1000 * 2 ** Math.min(attempts, 6))
      waUpdateOutbox(row.id, 'pending', attempts, error?.message || String(error), Date.now() + delay)
      throw error
    }
  }

  private async processOutbox() {
    if (this.outboxRunning || !this.sock || this.status !== 'connected') return
    this.outboxRunning = true
    waRecoverOutbox()
    try {
      for (const row of waListPendingOutbox()) {
        if (!this.sock || this.status !== 'connected') break
        try {
          await this.sendOutboxRow(row)
        } catch (error) {
          console.warn('[WA] falha ao reenviar item da outbox:', error)
        }
      }
    } finally {
      this.outboxRunning = false
    }
  }

  async sendMessage(chatId: string, text: string) {
    const id = waEnqueueOutbox(chatId, 'text', JSON.stringify({ text }))
    await this.sendOutboxRow({ id, chat_id: chatId, kind: 'text', data: JSON.stringify({ text }), attempts: 0 })
  }

  async sendMedia(chatId: string, data: Uint8Array | ArrayBuffer, mimeType: string, fileName: string, caption = '') {
    const buffer = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
    const mime = mimeType.toLowerCase()
    if (!(mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/'))) {
      throw new Error('Formato de mídia não suportado')
    }
    const dataPayload = { data: buffer.toString('base64'), mimeType: mime, fileName, caption }
    const id = waEnqueueOutbox(chatId, 'media', JSON.stringify(dataPayload))
    await this.sendOutboxRow({ id, chat_id: chatId, kind: 'media', data: JSON.stringify(dataPayload), attempts: 0 })
  }

  private async ensureBaileys() {
    if (!this.initPromise) this.initPromise = loadBaileys()
    await this.initPromise
  }

  private setStatus(s: typeof this.status) {
    this.status = s
    this.emit(s as any)
  }

  private waitForHistoryQuiet() {
    if (!this.historyStatusComplete) return
    if (this.historyCompleteTimer) clearTimeout(this.historyCompleteTimer)
    this.historyCompleteTimer = setTimeout(() => {
      this.historyCompleteTimer = null
      this.historySyncing = false
      this.emit('historySync', false)
    }, 8000)
  }

  async connect() {
    await this.ensureBaileys()
    if (this.connecting || this.status === 'connected' || this.sock) return
    this.restoreCache()
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }

    this.connecting = true
    if (this.historyCompleteTimer) {
      clearTimeout(this.historyCompleteTimer)
      this.historyCompleteTimer = null
    }
    this.historySyncing = true
    this.historyStatusComplete = false
    this.emit('historySync', true)
    this.setStatus('connecting')

    console.log('[WA] connect() chamado')
    const { state, saveCreds } = await useSqliteAuthState()
    this.saveCreds = saveCreds

    // DEBUG: check creds integrity
    if (state?.creds?.noiseKey) {
      const nk = state.creds.noiseKey
      console.log('[WA] noiseKey.public type:', nk.public?.constructor?.name, 'isBuffer:', Buffer.isBuffer(nk.public))
      console.log('[WA] noiseKey.private type:', nk.private?.constructor?.name, 'isBuffer:', Buffer.isBuffer(nk.private))
    } else {
      console.log('[WA] WARNING: noiseKey is missing!')
    }

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: makeLogger('main'),
      qrTimeout: 30000,
      shouldSyncHistoryMessage: () => true
    })
    this.sock = socket

    socket.ev.on('creds.update', saveCreds)

    socket.ev.on('connection.update', async (update: any) => {
      if (this.sock !== socket) return
      const keys = Object.keys(update)
      const connectionError = disconnectDetails(update.lastDisconnect?.error)
      console.log('[WA] connection.update diagnostic:', {
        keys,
        connection: update.connection,
        qrPresent: Boolean(update.qr),
        isNewLogin: update.isNewLogin,
        receivedPendingNotifications: update.receivedPendingNotifications,
        isOnline: update.isOnline,
        hasLastDisconnect: Boolean(update.lastDisconnect),
        lastDisconnect: connectionError
      })
      console.log(
        '[WA] connection.update:',
        JSON.stringify(keys),
        update.qr ? 'qr' : '',
        update.connection || '',
        connectionError?.message || ''
      )

      if (update.qr) {
        // v7 RC14 prefixa com URL, mas o celular espera só os dados crus
        let qrData = update.qr
        const hashIdx = qrData.indexOf('#')
        if (hashIdx !== -1) {
          qrData = qrData.substring(hashIdx + 1)
          // remove o ultimo campo (platformId), que v6 não tinha
          const parts = qrData.split(',')
          if (parts.length === 5) qrData = parts.slice(0, 4).join(',')
        }
        console.log('[WA] QR CODE RECEBIDO')
        this.qrBase64 = await QR.toDataURL(qrData)
        this.emit('qr', this.qrBase64)
        if (this.qrTimeout) { clearTimeout(this.qrTimeout); this.qrTimeout = null }
      }

      if (update.connection === 'connecting') {
        this.setStatus('connecting')
      }

      if (update.connection === 'open') {
        console.log('[WA] CONECTADO!')
        this.connecting = false
        this.qrBase64 = null
        this.setStatus('connected')
        await this.loadChats()
        this.processOutbox().catch(error => console.warn('[WA] erro processando outbox:', error))
      }

      if (update.connection === 'close') {
        const disconnectError = update.lastDisconnect?.error
        const code = disconnectError?.output?.statusCode
        const numericCode = Number(code)
        const isRestartRequired = numericCode === 515
          || String(disconnectError?.message || '').toLowerCase().includes('restart required')
        console.log('[WA] desconectado, motivo:', code)
        console.log('[WA] restartRequired:', isRestartRequired, 'statusCode:', numericCode)
        console.log('[WA] disconnect diagnostic:', {
          code,
          numericCode,
          isRestartRequired,
          error: disconnectDetails(disconnectError)
        })
        const shouldReconnect = isRestartRequired
        this.connecting = false
        this.sock = null
        this.qrBase64 = null
        if (this.historyCompleteTimer) {
          clearTimeout(this.historyCompleteTimer)
          this.historyCompleteTimer = null
        }
        this.historySyncing = false
        this.historyStatusComplete = false

        if (shouldReconnect) {
          console.log('[WA] reinício solicitado pelo servidor, reconectando...')
          this.setStatus('connecting')
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.connect().catch(error => console.error('[WA] erro ao reiniciar conexão:', error))
          }, 500)
          return
        }

        this.setStatus('disconnected')

        const errorMessage = numericCode === 401
          ? 'A sessão do WhatsApp foi rejeitada. Limpe os tokens e leia um novo QR Code.'
          : `A conexão do WhatsApp foi encerrada${code ? ` (${code})` : ''}.`
        this.emit('error', errorMessage)

      }
    })

    socket.ev.on('messaging-history.set', ({ chats, contacts, messages, syncType, progress, isLatest, chunkOrder, peerDataRequestSessionId }: any) => {
      this.updateContacts(contacts || [])
      if (chats) {
        for (const rawChat of chats) {
          const chat = this.mergeChat(rawChat)
          const idx = this.chats.findIndex(c => c.id === chat.id)
          if (idx === -1) this.chats.push(chat)
        }
      }
      if (messages) {
        for (const msg of messages) {
          this.storeMessage(msg)
          this.ensureChatFromMessage(msg)
        }
      }
      this.persistChats()
      console.log('[WA] history sync:', {
        chats: chats?.length || 0,
        contacts: contacts?.length || 0,
        messages: messages?.length || 0,
        syncType,
        progress,
        isLatest,
        chunkOrder,
        peerDataRequestSessionId
      })
      this.persistCache()
      this.emit('chatsUpdated', this.sortedChats())
      this.emit('messagesUpdated', [...new Set((messages || []).map((message: any) => message.key?.remoteJid).filter(Boolean))])
      this.waitForHistoryQuiet()
    })

    socket.ev.on('messaging-history.status', (status: any) => {
      console.log('[WA] history status:', status.syncType, status.status, 'explicit:', status.explicit)
      if (status.status === 'complete' || status.status === 'paused') {
        this.historyStatusComplete = true
        this.waitForHistoryQuiet()
      }
    })

    socket.ev.on('chats.upsert', (chats: any[]) => {
      for (const rawChat of chats || []) {
        const chat = this.mergeChat(rawChat)
        const idx = this.chats.findIndex(c => c.id === chat.id)
        if (idx === -1) this.chats.push(chat)
        else {
          const previous = this.chats[idx]
          this.chats[idx] = { ...previous, ...chat }
          if (chat.lastMessage && !hasMessagePayload(chat.lastMessage) && hasMessagePayload(previous.lastMessage)) {
            this.chats[idx].lastMessage = previous.lastMessage
          }
        }
      }
      this.persistChats()
      this.emit('chatsUpdated', this.sortedChats())
      this.persistCache()
    })

    socket.ev.on('chats.update', (updates: any[]) => {
      for (const update of updates || []) {
        const idx = this.chats.findIndex(c => c.id === update.id)
        if (idx !== -1) {
          const previous = this.chats[idx]
          const merged = this.mergeChat(update)
          Object.assign(this.chats[idx], merged)
          if (merged.lastMessage && !hasMessagePayload(merged.lastMessage) && hasMessagePayload(previous.lastMessage)) {
            this.chats[idx].lastMessage = previous.lastMessage
          }
        }
      }
      this.persistChats()
      this.emit('chatsUpdated', this.sortedChats())
      this.persistCache()
    })

    socket.ev.on('contacts.upsert', (contacts: any[]) => {
      this.updateContacts(contacts || [])
      this.persistChats()
      this.emit('chatsUpdated', this.sortedChats())
      this.persistCache()
    })

    socket.ev.on('contacts.update', (updates: any[]) => {
      this.updateContacts(updates || [])
      this.persistChats()
      this.emit('chatsUpdated', this.sortedChats())
      this.persistCache()
    })

    socket.ev.on('chats.delete', (ids: string[]) => {
      if (this.historyFetches > 0) return
      this.chats = this.chats.filter(c => !ids.includes(c.id))
      this.persistChats()
      this.emit('chatsUpdated', this.chats)
      this.persistCache()
    })

    socket.ev.on('messages.upsert', async ({ messages }: any) => {
      for (const msg of messages) {
        this.storeMessage(msg)
        this.ensureChatFromMessage(msg)
        if (msg.key?.remoteJid) this.emit('message', msg)
      }
      this.persistChats()
      this.emit('chatsUpdated', this.sortedChats())
      this.persistCache()
    })

    this.qrTimeout = setTimeout(() => {
      if (this.connecting && !this.qrBase64) {
        console.log('[WA] TIMEOUT: QR não gerado após 30s')
        this.emit('error' as any, 'QR Code não foi gerado. Verifique sua conexão com a internet.')
        this.disconnect()
      }
    }, 30000)
  }

  private async loadChats() {
    if (!this.sock) return
    console.log('[WA] chats disponíveis:', this.chats.length)
      this.emit('chatsUpdated', this.sortedChats())
      this.persistCache()
  }

  async disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.qrTimeout) { clearTimeout(this.qrTimeout); this.qrTimeout = null }
    if (this.historyCompleteTimer) { clearTimeout(this.historyCompleteTimer); this.historyCompleteTimer = null }
    this.connecting = false
    this.sock?.end(new Error('manual disconnect'))
    this.sock = null
    this.chats = []
    this.contactNames.clear()
    this.messagesByChat.clear()
    this.historySyncing = false
    this.historyStatusComplete = false
    this.setStatus('disconnected')
  }
}

export const whatsappService = new WhatsAppService()
