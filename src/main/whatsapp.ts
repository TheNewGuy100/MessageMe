import { EventEmitter } from 'events'
import QR from 'qrcode'
import { useSqliteAuthState } from './auth-sqlite'
import { waClearAll } from './database'

let makeWASocket: any, DisconnectReason: any

async function loadBaileys() {
  const m = await import('@whiskeysockets/baileys')
  makeWASocket = m.default
  DisconnectReason = m.DisconnectReason
}

export type WhatsappEvent = 'connecting' | 'qr' | 'connected' | 'disconnected' | 'message' | 'chatsUpdated' | 'error'

function makeLogger(label: string) {
  const noop = () => {}
  const log = (fn: string) => (msg: any, ...args: any[]) => {
    if (typeof msg === 'string') console.log(`[WA:${label}] ${fn}:`, msg, ...args)
    else console.log(`[WA:${label}] ${fn}:`, msg)
  }
  const child = () => makeLogger(label + '.c')
  return { info: log('info'), warn: log('warn'), error: log('error'), debug: noop, trace: noop, fatal: log('fatal'), child }
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

  getStatus() { return this.status }
  getQRCode() { return this.qrBase64 }
  getChats() { return this.chats }

  getMessages(chatId: string) {
    return (this.messagesByChat.get(chatId) || []).slice(-50)
  }

  private storeMessage(msg: any) {
    const chatId = msg.key?.remoteJid
    if (!chatId) return
    let msgs = this.messagesByChat.get(chatId)
    if (!msgs) { msgs = []; this.messagesByChat.set(chatId, msgs) }
    const idx = msgs.findIndex(m => m.key?.id === msg.key?.id)
    if (idx === -1) msgs.push(msg)
    else msgs[idx] = msg
    if (msgs.length > 100) msgs.splice(0, msgs.length - 100)
  }

  private mergeChat(chat: any) {
    const contactName = this.contactNames.get(chat.id)
    if (contactName && !chat.name) return { ...chat, name: contactName }
    return chat
  }

  async getProfilePicture(jid: string) {
    if (!this.sock) return null
    try {
      return await this.sock.profilePictureUrl(jid)
    } catch { return null }
  }

  async clearCreds() {
    waClearAll()
  }

  async sendMessage(chatId: string, text: string) {
    if (!this.sock) throw new Error('WhatsApp não conectado')
    await this.sock.sendMessage(chatId, { text })
  }

  private async ensureBaileys() {
    if (!this.initPromise) this.initPromise = loadBaileys()
    await this.initPromise
  }

  private setStatus(s: typeof this.status) {
    this.status = s
    this.emit(s as any)
  }

  async connect() {
    await this.ensureBaileys()
    if (this.connecting) return
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }

    this.connecting = true
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

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: makeLogger('main'),
      qrTimeout: 30000,
      shouldSyncHistoryMessage: () => true
    })

    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('connection.update', async (update: any) => {
      const keys = Object.keys(update)
      console.log('[WA] connection.update:', JSON.stringify(keys), update.qr ? 'qr' : '', update.connection || '', JSON.stringify(update.lastDisconnect?.error?.message))

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

      if (update.connection === 'open') {
        console.log('[WA] CONECTADO!')
        this.connecting = false
        this.qrBase64 = null
        this.setStatus('connected')
        await this.loadChats()
      }

      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode
        console.log('[WA] desconectado, motivo:', code)
        const shouldReconnect = !(code === DisconnectReason.loggedOut || code === 401)
        this.connecting = false
        this.sock = null
        this.qrBase64 = null
        this.setStatus('disconnected')

        if (shouldReconnect) {
          console.log('[WA] reconectando em 5s...')
          this.reconnectTimer = setTimeout(() => this.connect(), 5000)
        }
      }
    })

    this.sock.ev.on('messaging-history.set', ({ chats, messages }: any) => {
      if (chats) {
        for (const rawChat of chats) {
          const chat = this.mergeChat(rawChat)
          const idx = this.chats.findIndex(c => c.id === chat.id)
          if (idx === -1) this.chats.push(chat)
        }
      }
      if (messages) {
        for (const msg of messages) this.storeMessage(msg)
      }
      this.emit('chatsUpdated', this.chats)
    })

    this.sock.ev.on('chats.upsert', (chats: any[]) => {
      for (const rawChat of chats || []) {
        const chat = this.mergeChat(rawChat)
        const idx = this.chats.findIndex(c => c.id === chat.id)
        if (idx === -1) this.chats.push(chat)
        else this.chats[idx] = { ...this.chats[idx], ...chat }
      }
      this.emit('chatsUpdated', this.chats)
    })

    this.sock.ev.on('chats.update', (updates: any[]) => {
      for (const update of updates || []) {
        const idx = this.chats.findIndex(c => c.id === update.id)
        if (idx !== -1) Object.assign(this.chats[idx], this.mergeChat(update))
      }
      this.emit('chatsUpdated', this.chats)
    })

    this.sock.ev.on('contacts.upsert', (contacts: any[]) => {
      for (const contact of contacts || []) {
        const name = contact.name || contact.notify || contact.verifiedName
        if (!contact.id || !name) continue
        this.contactNames.set(contact.id, name)
        const chat = this.chats.find(item => item.id === contact.id)
        if (chat && !chat.name) chat.name = name
      }
      this.emit('chatsUpdated', this.chats)
    })

    this.sock.ev.on('contacts.update', (updates: any[]) => {
      for (const contact of updates || []) {
        const name = contact.name || contact.notify || contact.verifiedName
        if (!contact.id || !name) continue
        this.contactNames.set(contact.id, name)
        const chat = this.chats.find(item => item.id === contact.id)
        if (chat && !chat.name) chat.name = name
      }
      this.emit('chatsUpdated', this.chats)
    })

    this.sock.ev.on('chats.delete', (ids: string[]) => {
      this.chats = this.chats.filter(c => !ids.includes(c.id))
      this.emit('chatsUpdated', this.chats)
    })

    this.sock.ev.on('messages.upsert', async ({ messages }: any) => {
      for (const msg of messages) {
        this.storeMessage(msg)
        if (msg.key?.remoteJid) this.emit('message', msg)
      }
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
    this.emit('chatsUpdated', this.chats)
  }

  async disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.qrTimeout) { clearTimeout(this.qrTimeout); this.qrTimeout = null }
    this.connecting = false
    this.sock?.end(new Error('manual disconnect'))
    this.sock = null
    this.chats = []
    this.contactNames.clear()
    this.messagesByChat.clear()
    this.setStatus('disconnected')
  }
}

export const whatsappService = new WhatsAppService()
