import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { storeGet, storeSet, storeDelete } from './database'
import { debug } from './debug'

const IG_APP_ID = process.env.IG_APP_ID || '936619743392459'
const BASE = process.env.IG_BASE_URL || 'https://www.instagram.com'
const API = `${BASE}/api/v1`
const USER_AGENT = process.env.IG_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export type InstagramEvent = 'connected' | 'disconnected' | 'message' | 'threadsUpdated'

interface IgCookies {
  sessionid: string
  csrftoken: string
  ds_user_id: string
}

class InstagramService extends EventEmitter {
  private cookies: IgCookies | null = null
  private status: 'disconnected' | 'connected' = 'disconnected'
  private threads: any[] = []
  private pollTimer: any = null

  getStatus() { return this.status }
  getThreads() { return this.threads }

  private cookieString() {
    if (!this.cookies) return ''
    return `sessionid=${this.cookies.sessionid}; csrftoken=${this.cookies.csrftoken}; ds_user_id=${this.cookies.ds_user_id}`
  }

  private async igFetch(path: string, options: RequestInit = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`
    debug.log('[IG] fetch', options.method || 'GET', url)
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'X-IG-App-ID': IG_APP_ID,
      'X-CSRFToken': this.cookies?.csrftoken ?? '',
      'Cookie': this.cookieString(),
      'Origin': BASE,
      'Referer': `${BASE}/`,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Accept-Encoding': 'gzip, deflate, br'
    }

    if (options.body && !(options.body instanceof URLSearchParams)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers as any }, redirect: 'follow' })
    debug.log('[IG] response', res.status, res.statusText)
    if (!res.ok) {
      const text = await res.text()
      debug.log('[IG] error body', text)
      throw new Error(`Instagram API ${res.status}: ${text}`)
    }
    return res.json()
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
            this.cookies = { sessionid: sid.value, csrftoken: csrf.value, ds_user_id: uid.value }
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
    this.cookies = null
    this.status = 'disconnected'
    this.threads = []
    storeDelete('instagram', 'cookies')
    this.emit('disconnected')
  }

  async getMessages(threadId: string) {
    const data = await this.igFetch(`/direct_v2/threads/${threadId}/`)
    const thread = data.thread || data
    return (thread.items || []).map((item: any) => ({
      id: item.item_id || item.id,
      threadId,
      text: item.text || item?.visual_media?.media?.image_versions2?.candidates?.[0]?.url || '',
      senderId: item.user_id?.toString(),
      timestamp: item.timestamp,
      isMine: item.user_id?.toString() === this.cookies?.ds_user_id
    })).reverse()
  }

  async sendMessage(threadId: string, text: string) {
    const form = new URLSearchParams()
    form.append('text', text)
    form.append('thread_ids', `["${threadId}"]`)
    form.append('action', 'send_item')
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'X-IG-App-ID': IG_APP_ID,
      'X-CSRFToken': this.cookies?.csrftoken ?? '',
      'Cookie': this.cookieString(),
      'Origin': BASE,
      'Referer': `${BASE}/direct/inbox/`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    const res = await fetch(`${API}/direct_v2/threads/broadcast/text/`, {
      method: 'POST',
      body: form,
      headers,
      redirect: 'follow'
    })
    if (!res.ok) {
      const body = await res.text()
      debug.log('[IG] sendMessage response:', res.status, body)
      throw new Error(`Instagram API ${res.status}: ${body}`)
    }
  }

  private async startPolling() {
    await this.loadThreads()
    this.pollTimer = setInterval(() => this.loadThreads(), 15000)
  }

  private stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private async loadThreads() {
    if (!this.cookies) return
    try {
      const data = await this.igFetch('/direct_v2/inbox/?persistentBadging=true&limit=20')
      console.log('[IG] inbox response keys:', Object.keys(data))
      const inbox = data.inbox || data
      const threads = inbox.threads || []
      console.log('[IG] threads count:', threads.length)
      this.threads = threads.map((t: any) => ({
        id: t.thread_id || t.threadId || t.id,
        name: t.thread_title || t.users?.map((u: any) => u.username).join(', ') || 'Unknown',
        lastMessage: t.last_permanent_item?.text || t.last_item?.text || '',
        lastTimestamp: t.last_activity_at || t.last_item?.timestamp,
        unread: t.has_newer,
        avatarUrl: t.users?.[0]?.profile_pic_url || ''
      }))
      this.emit('threadsUpdated', this.threads)
    } catch (e) {
      debug.log('[IG] erro loadThreads:', e)
    }
  }
}

export const instagramService = new InstagramService()
