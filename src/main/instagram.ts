import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import {
  instagramClearThreads,
  instagramListThreads,
  instagramReplaceThreads,
  instagramUpsertThreads,
  storeGet,
  storeSet,
  storeDelete
} from './database'
import { debug } from './debug'
import { handleNetworkError } from '../shared/handlers/network-error'
import { handleRenderError } from '../shared/handlers/render-error'

const IG_APP_ID = process.env.IG_APP_ID || '936619743392459'
const BASE = process.env.IG_BASE_URL || 'https://www.instagram.com'
const API = `${BASE}/api/v1`
const MOBILE_BASE = process.env.IG_MOBILE_BASE_URL || 'https://i.instagram.com'
const MOBILE_API = `${MOBILE_BASE}/api/v1`
const USER_AGENT = process.env.IG_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function summarizeResponseBody(body: string, contentType: string) {
  if (contentType.toLowerCase().includes('text/html') || /<html[\s>]/i.test(body)) {
    return `[HTML omitido; ${body.length} caracteres]`
  }
  const compact = body.replace(/\s+/g, ' ').trim()
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact
}

export type InstagramEvent = 'connected' | 'disconnected' | 'message' | 'threadsUpdated'
export type InstagramFolder = 'main' | 'pending' | 'hidden'

interface IgCookies {
  sessionid: string
  csrftoken: string
  ds_user_id: string
  extra?: Record<string, string>
}

class InstagramService extends EventEmitter {
  private cookies: IgCookies | null = null
  private status: 'disconnected' | 'connected' = 'disconnected'
  private threads: any[] = []
  private pollTimer: any = null
  private webWindow: BrowserWindow | null = null
  private realtimeSocketIds = new Set<string>()
  private realtimeSeenMessageIds = new Set<string>()
  private realtimeAttached = false

  getStatus() { return this.status }
  getThreads() { return this.threads }

  getCachedThreads(folder: InstagramFolder) {
    return instagramListThreads(folder).map(row => JSON.parse(row.data))
  }

  private cookieString() {
    if (!this.cookies) return ''
    const cookies = {
      ...this.cookies.extra,
      sessionid: this.cookies.sessionid,
      csrftoken: this.cookies.csrftoken,
      ds_user_id: this.cookies.ds_user_id
    }
    return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ')
  }

  private async getWebWindow() {
    if (this.webWindow && !this.webWindow.isDestroyed()) return this.webWindow
    this.webWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    this.webWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      handleRenderError({ kind: 'instagram-window-load-failed', errorCode, errorDescription, url: validatedURL, isMainFrame })
    })
    this.webWindow.webContents.on('render-process-gone', (_event, details) => {
      handleRenderError({ kind: 'instagram-window-process-gone', reason: details.reason, exitCode: details.exitCode })
    })

    const devtools = this.webWindow.webContents.debugger
    try {
      devtools.attach('1.3')
      devtools.on('message', (_event: any, method: string, params: any) => {
        if (method === 'Network.webSocketCreated' && params.url?.includes('instagram.com')) {
          this.realtimeSocketIds.add(params.requestId)
          debug.log('[IG] realtime socket connected:', params.url)
        }
        if (method === 'Network.webSocketClosed') {
          this.realtimeSocketIds.delete(params.requestId)
        }
        if (method === 'Network.webSocketFrameReceived' && this.realtimeSocketIds.has(params.requestId)) {
          this.handleRealtimeFrame(params.response?.payloadData, params.response?.opcode)
        }
      })
      await devtools.sendCommand('Network.enable')
      this.realtimeAttached = true
    } catch (error: any) {
      debug.log('[IG] realtime monitor unavailable:', error?.message || error)
    }

    for (const [name, value] of Object.entries({
      ...this.cookies?.extra,
      sessionid: this.cookies?.sessionid,
      csrftoken: this.cookies?.csrftoken,
      ds_user_id: this.cookies?.ds_user_id
    })) {
      if (!value) continue
      await this.webWindow.webContents.session.cookies.set({ url: BASE, name, value: String(value) }).catch(() => {})
    }
    await this.webWindow.loadURL(`${BASE}/direct/inbox/`)
    return this.webWindow
  }

  private handleRealtimeFrame(payload: string, opcode: number) {
    if (!payload) return
    let parsed: any
    try {
      parsed = JSON.parse(payload.replace(/^for\s*\(;;\);/, ''))
    } catch {
      debug.log('[IG] realtime frame:', { opcode, size: payload.length, format: 'binary-or-non-json' })
      return
    }

    const candidates: any[] = []
    const visit = (value: any) => {
      if (!value || typeof value !== 'object') return
      if ((value.item_id || value.id) && (value.thread_id || value.threadId) && (value.timestamp || value.created_at)) {
        candidates.push(value)
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
      } else {
        for (const child of Object.values(value)) visit(child)
      }
    }
    visit(parsed)

    debug.log('[IG] realtime frame:', { opcode, size: payload.length, candidates: candidates.length })
    for (const item of candidates) {
      const threadId = item.thread_id || item.threadId
      const message = this.normalizeDirectItem(item, String(threadId))
      if (!message.id || this.realtimeSeenMessageIds.has(String(message.id))) continue
      this.realtimeSeenMessageIds.add(String(message.id))
      if (this.realtimeSeenMessageIds.size > 5000) {
        const oldest = this.realtimeSeenMessageIds.values().next().value
        if (oldest) this.realtimeSeenMessageIds.delete(oldest)
      }
      this.emit('message', message)
    }
  }

  private async igFetch(path: string, options: RequestInit = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`
    const requestBase = url.startsWith(MOBILE_BASE) ? MOBILE_BASE : BASE
    debug.log('[IG] fetch', options.method || 'GET', url)
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'X-IG-App-ID': IG_APP_ID,
      'X-CSRFToken': this.cookies?.csrftoken ?? '',
      'Cookie': this.cookieString(),
      'Origin': requestBase,
      'Referer': `${requestBase}/`,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Accept-Encoding': 'gzip, deflate, br'
    }

    if (options.body && !(options.body instanceof URLSearchParams)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    let res: Response
    try {
      res = await fetch(url, { ...options, headers: { ...headers, ...options.headers as any }, redirect: 'follow' })
    } catch (error: any) {
      handleNetworkError({ kind: 'request-failed', method: options.method || 'GET', url, message: error?.message || String(error) })
      throw new Error(`Falha de rede ao acessar o Instagram: ${error?.message || 'conexão recusada'}`)
    }
    debug.log('[IG] response', res.status, res.statusText)
    if (!res.ok) {
      const text = await res.text()
      const contentType = res.headers.get('content-type') || 'desconhecido'
      handleNetworkError({
        kind: 'http-error',
        method: options.method || 'GET',
        url,
        status: res.status,
        statusText: res.statusText,
        contentType,
        body: summarizeResponseBody(text, contentType)
      })
      throw new Error(`Instagram API ${res.status} ${res.statusText || 'erro HTTP'}`)
    }
    try {
      return await res.json()
    } catch (error: any) {
      const contentType = res.headers.get('content-type') || 'desconhecido'
      handleNetworkError({
        kind: 'invalid-response',
        method: options.method || 'GET',
        url,
        status: res.status,
        contentType,
        message: error?.message || 'resposta não é JSON'
      })
      throw new Error('O Instagram retornou uma resposta inválida (não-JSON)')
    }
  }

  async loginWithBrowser(): Promise<void> {
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        width: 480,
        height: 800,
        resizable: false,
        title: 'Login Instagram',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      win.loadURL(`${BASE}/accounts/login/`)

      const checkDone = async (url: string) => {
        if (url.includes('/direct/inbox/') || url === `${BASE}/` || url === BASE) {
          await new Promise(r => setTimeout(r, 1500))
          const allCookies = await win.webContents.session.cookies.get({ url: BASE })
          const sid = allCookies.find(c => c.name === 'sessionid')
          const csrf = allCookies.find(c => c.name === 'csrftoken')
          const uid = allCookies.find(c => c.name === 'ds_user_id')

          if (sid?.value && csrf?.value && uid?.value) {
            const coreCookies = new Set(['sessionid', 'csrftoken', 'ds_user_id'])
            this.cookies = {
              sessionid: sid.value,
              csrftoken: csrf.value,
              ds_user_id: uid.value,
              extra: Object.fromEntries(
                allCookies
                  .filter(cookie => !coreCookies.has(cookie.name))
                  .map(cookie => [cookie.name, cookie.value])
              )
            }
            storeSet('instagram', 'cookies', JSON.stringify(this.cookies))
            win.close()
            this.status = 'connected'
            this.emit('connected')
            this.startPolling()
            resolve()
          } else if (!url.includes('/accounts/')) {
            win.close()
            reject(new Error('Não foi possível obter os cookies de sessão'))
          }
        }
      }

      win.webContents.on('did-navigate', (_e, url) => checkDone(url))
      win.on('closed', () => {
        if (!this.cookies) reject(new Error('Janela de login fechada sem concluir'))
      })
    })
  }

  private async restoreSession(): Promise<boolean> {
    if (this.status === 'connected') return true
    const raw = storeGet('instagram', 'cookies')
    if (!raw) return false
    try {
      this.cookies = JSON.parse(raw)
      await this.igFetch('/direct_v2/inbox/?persistentBadging=true&limit=1')
      this.status = 'connected'
      this.emit('connected')
      this.startPolling()
      return true
    } catch (e: any) {
      if (e?.message?.startsWith('Instagram API 401') || e?.message?.startsWith('Instagram API 403')) {
        console.log('[IG] sessão inválida, limpando cookies')
        this.cookies = null
        storeDelete('instagram', 'cookies')
      } else {
        console.log('[IG] restore erro de rede/outro, mantendo cookies:', e?.message || e)
      }
    }
    this.cookies = null
    return false
  }

  async tryRestore() {
    await this.restoreSession()
  }

  async logout() {
    this.stopPolling()
    if (this.webWindow && !this.webWindow.isDestroyed()) this.webWindow.close()
    this.webWindow = null
    this.realtimeSocketIds.clear()
    this.realtimeSeenMessageIds.clear()
    this.realtimeAttached = false
    this.cookies = null
    this.status = 'disconnected'
    this.threads = []
    instagramClearThreads()
    storeDelete('instagram', 'cookies')
    this.emit('disconnected')
  }

  private normalizeDirectItem(item: any, threadId: string) {
    const media = item.visual_media?.media
      || item.media_share?.media
      || item.reel_share?.media
      || item.clip?.clip
      || item.media
    const videoUrl = media?.video_versions?.[0]?.url
    const imageUrl = media?.image_versions2?.candidates?.[0]?.url
    const audioUrl = item.voice_media?.media?.audio_src
      || item.audio_media?.audio_src
      || item.audio_media?.media?.audio_src
    const mediaUrl = videoUrl || imageUrl || audioUrl || ''
    const mediaType = videoUrl ? (media?.is_dash_eligible ? 'video' : 'video') : imageUrl ? 'image' : audioUrl ? 'audio' : ''

    return {
      id: item.item_id || item.id,
      threadId,
      text: item.text || item.caption?.text || '',
      senderId: item.user_id?.toString(),
      timestamp: item.timestamp,
      isMine: item.user_id?.toString() === this.cookies?.ds_user_id,
      mediaUrl,
      mediaType,
      thumbnailUrl: imageUrl || media?.image_versions2?.candidates?.[0]?.url || ''
    }
  }

  async getMessages(threadId: string) {
    const page = await this.getMessagesPage(threadId)
    return page.messages
  }

  async getMessagesPage(threadId: string, cursor?: string) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const data = await this.igFetch(`/direct_v2/threads/${threadId}/${suffix}`)
    const thread = data.thread || data
    const messages = (thread.items || []).map((item: any) => this.normalizeDirectItem(item, threadId)).reverse()
    const nextCursor = thread.oldest_cursor || thread.next_cursor || data.oldest_cursor || null
    return {
      messages,
      nextCursor,
      hasMore: Boolean(nextCursor && nextCursor !== cursor && (thread.has_older !== false && thread.has_older_items !== false))
    }
  }

  async getThreadsPage(folder: InstagramFolder = 'main', cursor?: string) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const endpoint = folder === 'pending'
      ? `${MOBILE_API}/direct_v2/pending_inbox/`
      : folder === 'hidden'
        ? `${MOBILE_API}/direct_v2/hidden_inbox/`
        : '/direct_v2/inbox/'
    const data = await this.igFetch(`${endpoint}?persistentBadging=true&limit=20${suffix}`)
    // Some Instagram responses include the regular inbox alongside the folder-specific payload.
    const inbox = folder === 'pending'
      ? data.pending_inbox || data.pendingInbox || data.inbox || data
      : folder === 'hidden'
        ? data.hidden_inbox || data.hiddenInbox || data.inbox || data
        : data.inbox || data
    debug.log('[IG] folder response:', {
      folder,
      keys: Object.keys(data || {}),
      inboxKeys: Object.keys(inbox || {}),
      threads: inbox?.threads?.length || 0
    })
    const threads = (inbox.threads || []).map((t: any) => ({
      id: t.thread_id || t.threadId || t.id,
      graphqlId: t.thread_v2_id || t.thread_igid || t.thread_pk || t.pk || t.thread_id || t.id,
      name: t.thread_title || t.users?.map((u: any) => u.username).join(', ') || 'Unknown',
      lastMessage: t.last_permanent_item?.text || t.last_item?.text || '',
      lastTimestamp: t.last_activity_at || t.last_item?.timestamp,
      unread: t.has_newer,
      avatarUrl: t.users?.[0]?.profile_pic_url || '',
      folder
    }))
    if (cursor) instagramUpsertThreads(folder, threads)
    else instagramReplaceThreads(folder, threads)
    const nextCursor = inbox.oldest_cursor || inbox.next_cursor || data.oldest_cursor || null
    return {
      threads,
      nextCursor,
      hasMore: Boolean(nextCursor && nextCursor !== cursor && (inbox.has_older_threads !== false && inbox.has_older !== false))
    }
  }

  async searchThreads(query: string) {
    const offsets = encodeURIComponent('{"message_content":0}')
    const resultTypes = encodeURIComponent('["message_content"]')
    const data = await this.igFetch(`/direct_v2/search_secondary/?offsets=${offsets}&query=${encodeURIComponent(query)}&result_types=${resultTypes}`)
    const results = data.message_content || data.results || data.items || []
    return results.map((result: any) => {
      const thread = result.thread || result.thread_info || result
      const item = result.item || result.message || result.last_item || result
      const users = thread.users || result.users || []
      return {
        id: thread.thread_id || thread.threadId || thread.id || result.thread_id,
        graphqlId: thread.thread_v2_id || thread.thread_igid || thread.thread_pk || thread.pk || thread.thread_id,
        name: thread.thread_title || users.map((user: any) => user.username).join(', ') || result.thread_title || 'Unknown',
        lastMessage: item.text || result.text || '',
        lastTimestamp: item.timestamp || result.timestamp,
        unread: thread.has_newer,
        avatarUrl: users[0]?.profile_pic_url || ''
      }
    }).filter((thread: any) => thread.id)
  }

  async sendMessage(threadId: string, text: string) {
    const window = await this.getWebWindow()
    let result: { status: number; body: string }
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
      `, true)
    } catch (error: any) {
      handleRenderError({ kind: 'instagram-send-render-failed', message: error?.message || String(error) })
      throw new Error(`Falha no renderer do Instagram: ${error?.message || 'não foi possível executar o envio'}`)
    }
    const { status, body } = result
    debug.log('[IG] sendMessage response:', status)
    if (status < 200 || status >= 300) {
      handleNetworkError({
        kind: 'send-http-error',
        method: 'POST',
        url: `${BASE}/api/graphql`,
        status,
        body: summarizeResponseBody(body, 'text/plain')
      })
      throw new Error(`Instagram API ${status} ao enviar mensagem`)
    }
    try {
      const data = JSON.parse(body)
      if (data.errors?.length || !data.data?.xig_direct_text_send_with_slide_messaging_response) {
        throw new Error(`Instagram API 400: ${body}`)
      }
    } catch (e: any) {
      handleNetworkError({ kind: 'send-invalid-response', message: e?.message || String(e) })
      throw e
    }
  }

  private async startPolling() {
    this.stopPolling()
    await this.loadThreads()
    this.getWebWindow().catch(error => debug.log('[IG] realtime startup failed:', error?.message || error))
    this.pollTimer = setInterval(() => this.loadThreads(), 15000)
  }

  private stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private async loadThreads() {
    if (!this.cookies) return
    try {
    const page = await this.getThreadsPage('main')
      this.threads = page.threads
      console.log('[IG] threads count:', this.threads.length)
      this.emit('threadsUpdated', this.threads)
    } catch (e) {
      debug.log('[IG] erro loadThreads:', e)
    }
  }
}

export const instagramService = new InstagramService()
