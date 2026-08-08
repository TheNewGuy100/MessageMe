import { app, BrowserWindow, nativeImage, WebContentsView, shell } from 'electron'
import { deflateSync } from 'zlib'
import { join } from 'path'
import { appendFileSync } from 'fs'
import { clearAutomationLogs as clearStoredAutomationLogs, findContactIdByConversation, getAppSetting, insertAutomationLog, insertContactEvent, listAutomationFlows, listAutomationLogs, listProcessedMessageIds, listConversationStates, markProcessedMessage, resetAutomationRuntime as resetStoredAutomationRuntime, setAppSetting, upsertContact, upsertContactConversation, upsertConversationState } from './database'
import { AutomationController } from './automation/controller'

const DEFAULT_SIDEBAR_WIDTH = 200
export const OFFICIAL_VIEWS_HEADER_HEIGHT = 52
const MIN_SINGLE_VIEW_WIDTH = 900
const MIN_SPLIT_VIEW_WIDTH = 1200
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const INSTAGRAM_ROUTES = {
  inbox: 'https://www.instagram.com/direct/inbox/',
  requests: 'https://www.instagram.com/direct/requests/',
  hidden: 'https://www.instagram.com/direct/requests/hidden/'
}
const AUTOMATION_DEBUG_LOG = join(process.cwd(), 'automation-debug.log')

const INSTALL_INSTAGRAM_SOCKET_CAPTURE = `(() => {
  if (window.__messageManagerSocketCaptureInstalledV7) return true
  const NativeWebSocket = window.WebSocket
  const inspect = value => {
    const report = text => {
      const printable = String(text || '').replace(/[^\\x20-\\x7E\\r\\n]+/g, ' ').replace(/\\s+/g, ' ').trim()
      if (!/(message_id|thread_fbid|text_body|request_id|lightspeed)/i.test(printable)) return
       console.debug('__message-manager-ws__ ' + (typeof text === 'string' ? text : printable))
    }
    if (typeof value === 'string') {
      report(value)
      try {
          const envelope = JSON.parse(value)
          if (typeof envelope?.payload === 'string') {
            const encodedPayload = envelope.payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - envelope.payload.length % 4) % 4)
          const binary = atob(encodedPayload)
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
          const decodedCandidates = [new TextDecoder().decode(bytes)]
          for (let offset = 1; offset < Math.min(bytes.length, 32); offset++) decodedCandidates.push(new TextDecoder().decode(bytes.slice(offset)))
          const decoded = decodedCandidates.find(candidate => candidate.includes('"message_id"')) || ''
          const messageId = decoded.match(/"message_id":"([^"]+)"/)?.[1] || decoded.match(/mid\.\$[A-Za-z0-9._-]+/)?.[0]
           if (messageId) {
             const rawTextBody = decoded.match(/"text_body":"([^"]*)"/)?.[1] || ''
             let textBody = rawTextBody
             try { textBody = JSON.parse('"' + rawTextBody + '"') } catch {}
             const socketMessage = {
               messageId,
               threadFbid: decoded.match(/"thread_fbid":"([^"]+)"/)?.[1] || '',
               senderFbid: decoded.match(/"sender_fbid":"([^"]+)"/)?.[1] || '',
               textBody,
               timestamp: decoded.match(/"timestamp_ms":"([^"]+)"/)?.[1] || ''
             }
             window.__messageManagerLastSocketMessage = socketMessage
             report(JSON.stringify({
               decoded: true,
               ...socketMessage
             }))
          }
        }
      } catch {}
    } else if (value instanceof ArrayBuffer) {
      report(new TextDecoder().decode(value))
    } else if (value instanceof Blob) {
      value.arrayBuffer().then(buffer => report(new TextDecoder().decode(buffer))).catch(() => {})
    }
  }
  const WrappedWebSocket = function(...args) {
    const socket = new NativeWebSocket(...args)
    socket.addEventListener('message', event => inspect(event.data))
    return socket
  }
  WrappedWebSocket.prototype = NativeWebSocket.prototype
  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket)
  window.WebSocket = WrappedWebSocket
  window.__messageManagerSocketCaptureInstalledV7 = true
  return true
})()`

const INSTALL_INSTAGRAM_CONTACT_CAPTURE = `(() => {
  if (window.__messageManagerContactCaptureInstalled) return true
  const save = payload => {
    try {
      const thread = payload?.data?.get_slide_thread_nullable?.as_ig_direct_thread
      const user = thread?.users?.find(item => item?.id && item.id !== thread.viewer_id) || thread?.users?.[0]
      if (!thread || !user?.id) return
       window.__messageManagerLastContact = {
         conversationId: String(thread.thread_igid || thread.thread_fbid || thread.id || ''),
        accountId: String(thread.viewer_id || thread.viewer?.id || ''),
        externalId: String(user.id),
        username: user.username || '',
        fullName: user.full_name || '',
         profilePicUrl: user.profile_pic_url || ''
       }
       const incomingMessages = (thread.slide_messages?.edges || [])
         .map(edge => edge?.node)
         .filter(message => message?.message_id && String(message.sender_fbid || '') !== String(thread.viewer_id || ''))
         .sort((left, right) => Number(right.timestamp_ms || 0) - Number(left.timestamp_ms || 0))
       window.__messageManagerLastMessageId = String(incomingMessages[0]?.message_id || incomingMessages[0]?.id || '') || null
       window.__messageManagerContactResolve?.(window.__messageManagerLastContact)
    } catch {}
  }
  const originalFetch = window.fetch
  window.fetch = async (...args) => {
    const response = await originalFetch(...args)
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
    if (url.includes('/api/graphql') || url.includes('/graphql')) response.clone().json().then(save).catch(() => {})
    return response
  }
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__messageManagerUrl = String(url || '')
    return originalOpen.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.send = function(...args) {
    if (this.__messageManagerUrl?.includes('/api/graphql') || this.__messageManagerUrl?.includes('/graphql')) {
      this.addEventListener('load', () => {
        try { save(JSON.parse(this.responseText)) } catch {}
      })
    }
    return originalSend.apply(this, args)
  }
  window.__messageManagerContactCaptureInstalled = true
  return true
})()`

function writeAutomationDebug(event: string, data: Record<string, unknown> = {}) {
  try {
    appendFileSync(AUTOMATION_DEBUG_LOG, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`, 'utf8')
  } catch {
    // Diagnostics must never interrupt message processing.
  }
}
const createInstagramAutoReplyScript = (text: string, prime: boolean, allowProcessed: boolean, flows: Array<{ id: string; keywords: string[]; response: string; fallbackResponse: string; completed: boolean; conditions: Array<{ keywords: string[]; response: string; completed: boolean }> }>, processedMessageIds: string[], knownStates: Record<string, string>, automaticReplies: Array<{ message: string; start?: string; end?: string }>, activeFlowStates: Record<string, { flowId: string; updatedAt: string }>, completedFlowStates: Record<string, boolean>) => `(() => {
  const fallbackReply = ${JSON.stringify(text)}
  const flows = ${JSON.stringify(flows)}
  const automaticReplies = ${JSON.stringify(automaticReplies)}
  const processedMessageIds = new Set(${JSON.stringify(processedMessageIds)})
  const knownStates = ${JSON.stringify(knownStates)}
  const activeFlowStates = ${JSON.stringify(activeFlowStates)}
  const completedFlowStates = ${JSON.stringify(completedFlowStates)}
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
       let reply = fallbackReply
       let selectedFlowId = null
       let completed = false
      const visibleName = row.querySelector('span[title]')?.getAttribute('title') || ''
      const profileLink = row.querySelector('a[aria-label^="Open the profile page of"]')
      const profileLabel = profileLink?.getAttribute('aria-label') || ''
      const username = profileLabel.replace(/^Open the profile page of\\s*/i, '').trim()
      const name = visibleName || username
      const profile = profileLink?.getAttribute('href') || username || name

       window.__messageManagerLastContact = null
       window.__messageManagerLastMessageId = null
       window.__messageManagerContactPromise = new Promise(resolve => { window.__messageManagerContactResolve = resolve })
       row.click()
       await sleep(800)
       await Promise.race([window.__messageManagerContactPromise, sleep(1500)])
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
       const capturedContact = window.__messageManagerLastContact
       const capturedMessageId = window.__messageManagerLastMessageId
       const socketMessage = window.__messageManagerLastSocketMessage
        const threadId = location.pathname.match(/\\/direct\\/t\\/([^/?]+)/i)?.[1]
        const messageText = (lastMessage.textContent || '').replace(/\\s+/g, ' ').trim()
        const normalizedMessage = messageText.toLocaleLowerCase()
        const socketMessageMatches = socketMessage && (!socketMessage.textBody || normalizedMessage.includes(String(socketMessage.textBody).toLocaleLowerCase()))
        const conversationId = capturedContact?.conversationId
          ? 'thread:' + capturedContact.conversationId
          : socketMessageMatches && socketMessage.threadFbid
            ? 'thread:' + socketMessage.threadFbid
          : threadId
            ? 'thread:' + decodeURIComponent(threadId)
         : senderProfile.getAttribute('href') || profile || username || name
       if (!conversationId) {
         diagnostic.skippedState++
         returnToInbox()
         continue
       }
       const messageTime = lastMessage.querySelector('abbr[aria-label]')?.getAttribute('aria-label') || ''
       const messageElementId = lastMessage.getAttribute('data-message-id') || lastMessage.querySelector('[data-message-id]')?.getAttribute('data-message-id') || ''
       const flowState = activeFlowStates[conversationId]
       const flowStateIsActive = flowState && flowState.flowId && Date.now() - Date.parse(flowState.updatedAt) < 3 * 60 * 60 * 1000
       const lockedFlow = flowStateIsActive ? flows.find(flow => flow.id === flowState.flowId) : null
       const matchesTrigger = flows.some(flow => flow.keywords.some(keyword => normalizedMessage.includes(keyword)))
       const matchesCondition = Boolean(lockedFlow?.conditions.some(item => item.keywords.some(keyword => normalizedMessage.includes(keyword))))
       const completedConversation = Boolean(completedFlowStates[conversationId])
       const canRetryProcessed = completedConversation || matchesTrigger || matchesCondition
       const messageIdentity = (socketMessageMatches && socketMessage.messageId) || capturedMessageId || messageElementId || messageText + '|' + messageTime + '|' + (knownStates[conversationId] || '')
       const key = conversationId + '|' + messageIdentity
       if (processedMessageIds.has(key) && !allowProcessedOnce && !canRetryProcessed) {
         diagnostic.skippedProcessed++
         returnToInbox()
         continue
       }
       if (flowStateIsActive) {
         if (lockedFlow) {
           selectedFlowId = lockedFlow.id
           diagnostic.lockedFlow = true
           const condition = lockedFlow.conditions.find(item => item.keywords.some(keyword => normalizedMessage.includes(keyword)))
           reply = condition?.response || lockedFlow.fallbackResponse || lockedFlow.response
           completed = condition?.completed ?? lockedFlow.completed
         }
       } else {
         reply = scheduledReply || fallbackReply
         for (const flow of flows) {
           if (flow.keywords.some(keyword => normalizedMessage.includes(keyword))) {
             reply = flow.response
             selectedFlowId = flow.id
             completed = flow.completed
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
           completed = fallbackFlow.completed
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
       return { status: 'sent', conversation: name || 'Conversa sem nome', conversationId, incomingText: messageText, contact: capturedContact || null, ownState: 'Você: ' + reply, flowId: selectedFlowId, completed, rearm: completedConversation && !selectedFlowId, messageId: key, states: observedStates, diagnostic }
    }
    return { status: 'idle', states: observedStates, diagnostic }
  }
  return run()
})()`
const INSTAGRAM_HEADER_SCRIPT = `(() => {
  const headerId = 'message-manager-instagram-header'
  const routes = {
    inbox: '/direct/inbox/',
    requests: '/direct/requests/',
    hidden: '/direct/requests/hidden/'
  }
  const currentPath = () => window.location.pathname.replace(/\\/$/, '')

  let header = document.getElementById(headerId)
  if (!header) {
    header = document.createElement('div')
    header.id = headerId
    header.innerHTML = [
      ['inbox', 'Conversas'],
      ['requests', 'Solicitações'],
      ['hidden', 'Ocultas']
    ].map(([key, label]) => '<button type="button" data-route="' + key + '"><span>' + label + '</span><strong data-count-for="' + key + '"></strong></button>').join('')
    document.body.prepend(header)

    const style = document.createElement('style')
    style.id = headerId + '-style'
    style.textContent = [
      '#' + headerId + ' { position: relative; z-index: 2147483647; flex: 0 0 44px; display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 14px; box-sizing: border-box; background: #111b21; border-bottom: 1px solid #2a3942; font-family: Arial, sans-serif; }',
      '#' + headerId + ' button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #3b4a54; border-radius: 7px; padding: 7px 12px; background: #202c33; color: #d1d7db; cursor: pointer; font: 600 12px Arial, sans-serif; }',
      '#' + headerId + ' strong { display: none; min-width: 16px; height: 16px; align-items: center; justify-content: center; border-radius: 999px; padding: 0 4px; background: #e53935; color: #fff; font: 800 10px Arial, sans-serif; }',
      '#' + headerId + ' button:hover, #' + headerId + ' button[data-active="true"] { border-color: #25d366; background: #183d2b; color: #e9edef; }'
    ].join('')
    document.documentElement.appendChild(style)

    header.querySelectorAll('button[data-route]').forEach(button => {
      button.addEventListener('click', () => {
        const route = routes[button.getAttribute('data-route')]
        if (route && window.location.pathname !== route) window.location.assign(route)
      })
    })
  }

  header.querySelectorAll('button[data-route]').forEach(button => {
    const key = button.getAttribute('data-route')
    button.setAttribute('data-active', String(
      key === 'inbox' ? currentPath() === '/direct/inbox' :
      key === 'requests' ? currentPath() === '/direct/requests' :
      currentPath() === '/direct/requests/hidden'
    ))
  })
})()`

const UPDATE_INSTAGRAM_HEADER_SCRIPT = (inbox: number, requests: number, hidden: number) => `(() => {
  const counts = { inbox: ${inbox}, requests: ${requests}, hidden: ${hidden} }
  document.querySelectorAll('#message-manager-instagram-header [data-count-for]').forEach(badge => {
    const count = counts[badge.getAttribute('data-count-for')]
    badge.textContent = count > 99 ? '99+' : String(count || '')
    badge.style.display = count > 0 ? 'inline-flex' : 'none'
  })
})()`
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
})()`

const PREPARE_PROBE_SCRIPT = `(() => {
  const containers = [...document.querySelectorAll('body *')]
    .filter(element => {
      const style = getComputedStyle(element)
      return element.scrollHeight > element.clientHeight + 80 && /(auto|scroll)/.test(style.overflowY)
    })
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
  for (const container of containers.slice(0, 3)) container.scrollTop = container.scrollHeight
})()`

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
})()`

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const result = Buffer.allocUnsafe(4)
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
  return result
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  return Buffer.concat([length, typeBuffer, data, crc32(Buffer.concat([typeBuffer, data]))])
}

function createTaskbarBadge(count: number) {
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  const label = count > 99 ? '99+' : String(count)
  const glyphWidth = 3
  const glyphGap = 1
  const textWidth = label.length * glyphWidth + (label.length - 1) * glyphGap
  const textX = Math.floor((size - textWidth) / 2)
  const textY = 5

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5)
      if (distance > 7.5) continue
      const offset = (y * size + x) * 4
      pixels[offset] = 229
      pixels[offset + 1] = 57
      pixels[offset + 2] = 53
      pixels[offset + 3] = 255
    }
  }

  for (let character = 0; character < label.length; character++) {
    const glyph = DIGITS[label[character]]
    const startX = textX + character * (glyphWidth + glyphGap)
    for (let y = 0; y < glyph.length; y++) {
      for (let x = 0; x < glyph[y].length; x++) {
        if (glyph[y][x] !== '1') continue
        const pixelX = startX + x
        const pixelY = textY + y
        const offset = (pixelY * size + pixelX) * 4
        pixels[offset] = 255
        pixels[offset + 1] = 255
        pixels[offset + 2] = 255
        pixels[offset + 3] = 255
      }
    }
  }

  const scanlines = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    scanlines[y * (size * 4 + 1)] = 0
    pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

export type OfficialViewMode = 'instagram' | 'whatsapp' | 'both'
export type AutomationLog = {
  id: string
  at: string
  platform: 'instagram'
  conversation: string
  action: 'reply'
  status: 'sent' | 'failed'
  detail: string
}

class OfficialViews {
  private window: BrowserWindow | null = null
  private instagram: WebContentsView | null = null
  private instagramHeader: WebContentsView | null = null
  private instagramProbe: WebContentsView | null = null
  private instagramAutomationProbe: WebContentsView | null = null
  private whatsapp: WebContentsView | null = null
  private visible = false
  private sidebarWidth = DEFAULT_SIDEBAR_WIDTH
  private zoomPercent = 100
  private audioVolume = 100
  private viewMode: OfficialViewMode = 'both'
  private unreadTimer: ReturnType<typeof setInterval> | null = null
  private unreadRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private automationTimer: ReturnType<typeof setInterval> | null = null
  private unreadPolling = false
  private instagramProbeBusy = false
  private automationEnabled = false
  private automationGlobalEnabled = false
  private automationText = ''
  private automaticReplies: Array<{ message: string; start?: string; end?: string }> = []
  private automationPrimed = false
  private automationBusy = false
  private automationKnownStates: Record<string, string> = {}
  private automationAllowProcessedOnce = false
  private lastAutomationDiagnostic = ''
  private unreadCount = -1
  private whatsappUnreadCount = 0
  private instagramCounts = { inbox: 0, requests: 0, hidden: 0 }
  private automationLogs: AutomationLog[] = []
  private lastInstagramSocketMessage: { messageId: string; threadFbid: string; senderFbid: string; textBody: string } | null = null
  private readonly automationController = new AutomationController()

  isVisible() {
    return this.visible
  }

  attach(window: BrowserWindow) {
    this.window = window
    this.automationController.register({ platform: 'instagram', run: () => this.runInstagramAutomation() })
    this.automationController.register({ platform: 'whatsapp', run: () => this.runWhatsAppAutomation() })
    this.automationGlobalEnabled = getAppSetting('automation-global-enabled') === 'true'
    this.automationEnabled = getAppSetting('automation-enabled') === 'true'
    this.automationText = getAppSetting('automation-text') || ''
    try {
      const savedReplies = JSON.parse(getAppSetting('automatic-replies') || '[]') as Array<{ message?: string; start?: string; end?: string }>
      this.automaticReplies = Array.isArray(savedReplies) ? savedReplies.filter(reply => reply.message?.trim()).map(reply => ({ message: reply.message!.trim(), start: reply.start, end: reply.end })) : []
    } catch {
      this.automaticReplies = []
    }
    window.on('resize', () => this.resize())
    window.on('closed', () => {
      this.window = null
      this.instagram = null
      this.instagramHeader = null
      if (this.instagramProbe && !this.instagramProbe.webContents.isDestroyed()) this.instagramProbe.webContents.close()
      this.instagramProbe = null
      if (this.instagramAutomationProbe && !this.instagramAutomationProbe.webContents.isDestroyed()) this.instagramAutomationProbe.webContents.close()
      this.instagramAutomationProbe = null
      this.whatsapp = null
      this.visible = false
      this.stopUnreadPolling()
      this.updateTaskbarBadge(0)
    })
    this.syncAutomationState()
  }

  async toggle() {
    if (this.visible) {
      this.hide()
      return false
    }
    await this.show()
    return true
  }

  reload() {
    for (const view of [this.instagram, this.whatsapp]) {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.reloadIgnoringCache()
      }
    }
  }

  setSidebarWidth(width: number) {
    this.sidebarWidth = Math.max(64, Math.min(320, Math.round(width)))
    this.resize()
  }

  setZoom(percent: number) {
    this.zoomPercent = Math.max(50, Math.min(150, Math.round(percent)))
    for (const view of [this.instagram, this.whatsapp]) {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.setZoomFactor(this.zoomPercent / 100)
      }
    }
  }

  setAudioVolume(volume: number) {
    this.audioVolume = Math.max(0, Math.min(100, Math.round(volume)))
    for (const view of [this.instagram, this.whatsapp]) {
      this.applyAudioVolume(view)
    }
  }

  getAudioVolume() {
    return this.audioVolume
  }

  private applyAudioVolume(view: WebContentsView | null) {
    if (!view || view.webContents.isDestroyed()) return
    view.webContents.setAudioMuted(this.audioVolume === 0)
    const hideInstagramControls = view === this.instagram
    const hideWhatsAppControls = view === this.whatsapp
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
    })()`, true).catch(() => {})
  }

  setViewMode(mode: OfficialViewMode) {
    this.viewMode = mode === 'instagram' || mode === 'whatsapp' ? mode : 'both'
    if (!this.window || this.window.isDestroyed()) return

    this.window.setMinimumSize(this.viewMode === 'both' ? MIN_SPLIT_VIEW_WIDTH : MIN_SINGLE_VIEW_WIDTH, 600)
    if (!this.visible) return
    for (const view of [this.instagramHeader, this.instagram, this.whatsapp]) {
      if (view) this.window.contentView.removeChildView(view)
    }
    if (this.viewMode !== 'whatsapp' && this.instagramHeader) this.window.contentView.addChildView(this.instagramHeader)
    if (this.viewMode === 'instagram' && this.instagram) this.window.contentView.addChildView(this.instagram)
    if (this.viewMode === 'whatsapp' && this.whatsapp) this.window.contentView.addChildView(this.whatsapp)
    if (this.viewMode === 'both') {
      if (this.instagram) this.window.contentView.addChildView(this.instagram)
      if (this.whatsapp) this.window.contentView.addChildView(this.whatsapp)
    }
    this.resize()
  }

  getUnreadCount() {
    return Math.max(0, this.unreadCount)
  }

  getWhatsAppUnreadCount() {
    return Math.max(0, this.whatsappUnreadCount)
  }

  getInstagramCounts() {
    return this.instagramCounts
  }

  getAutomationStatus() {
    const configured = this.hasConfiguredAutomation()
    return {
      enabled: this.automationGlobalEnabled && configured,
      configured,
      globalEnabled: this.automationGlobalEnabled,
      running: this.automationBusy
    }
  }

  getAutomationLogs() {
    return listAutomationLogs()
  }

  clearAutomationLogs() {
    this.automationLogs = []
    clearStoredAutomationLogs()
    this.broadcastAutomationLogs()
  }

  resetAutomationRuntime() {
    resetStoredAutomationRuntime()
    this.automationKnownStates = {}
    this.automationPrimed = false
    this.lastAutomationDiagnostic = ''
  }

  setInstagramAutomation(enabled: boolean, text: string, automaticReplies: Array<{ message: string; start?: string; end?: string }> = []) {
    this.automationEnabled = Boolean(enabled)
    this.automationText = text.trim()
    this.automaticReplies = automaticReplies.filter(reply => reply.message.trim()).map(reply => ({ message: reply.message.trim(), start: reply.start, end: reply.end }))
    setAppSetting('automation-enabled', String(this.automationEnabled))
    setAppSetting('automation-text', this.automationText)
    setAppSetting('automatic-replies', JSON.stringify(this.automaticReplies))
    this.automationPrimed = false
    this.automationKnownStates = {}
    writeAutomationDebug('config', { enabled: this.automationEnabled, hasText: Boolean(this.automationText), automaticReplies: this.automaticReplies.length })
    this.syncAutomationState()
  }

  setGlobalAutomation(enabled: boolean) {
    this.automationGlobalEnabled = Boolean(enabled)
    setAppSetting('automation-global-enabled', String(this.automationGlobalEnabled))
    this.automationPrimed = false
    this.automationKnownStates = {}
    this.automationAllowProcessedOnce = this.automationGlobalEnabled
    writeAutomationDebug('global-toggle', { enabled: this.automationGlobalEnabled })
    this.syncAutomationState()
  }

  refreshAutomationStatus() {
    this.syncAutomationState()
  }

  private syncAutomationState() {
    const active = this.automationGlobalEnabled && this.hasConfiguredAutomation()
    if (active && !this.automationTimer) {
      this.automationTimer = setInterval(() => void this.automationController.run(), 2000)
      void this.automationController.run()
    } else if (!active && this.automationTimer) {
      clearInterval(this.automationTimer)
      this.automationTimer = null
    }
    this.sendAutomationStatus(false)
  }

  private hasConfiguredAutomation() {
    return (this.automationEnabled && (Boolean(this.automationText) || this.automaticReplies.length > 0)) || listAutomationFlows().some(flow => flow.enabled)
  }

  navigateInstagram(section: 'inbox' | 'requests' | 'hidden') {
    if (!this.instagram || this.instagram.webContents.isDestroyed()) return
    void this.instagram.webContents.loadURL(INSTAGRAM_ROUTES[section])
    this.scheduleUnreadPoll(800)
  }

  private createView(url: string) {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      shell.openExternal(target)
      return { action: 'deny' }
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault()
        if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()
        else view.webContents.openDevTools({ mode: 'detach' })
      }
    })
    if (url.includes('web.whatsapp.com')) {
      view.webContents.setUserAgent(CHROME_USER_AGENT)
      const webContents = view.webContents
      webContents.session.setPermissionRequestHandler((requestingContents, permission, callback) => {
        const isWhatsApp = requestingContents === webContents && requestingContents.getURL().includes('web.whatsapp.com')
        callback(isWhatsApp && (permission === 'media' || permission === 'notifications'))
      })
      webContents.session.setPermissionCheckHandler((requestingContents, permission) => {
        const isWhatsApp = requestingContents === webContents && requestingContents.getURL().includes('web.whatsapp.com')
        return isWhatsApp && (permission === 'media' || permission === 'notifications')
      })
    }
    this.applyAudioVolume(view)
    if (url.includes('instagram.com')) {
      view.webContents.on('did-finish-load', () => this.scheduleUnreadPoll(600))
      view.webContents.on('did-navigate-in-page', () => this.scheduleUnreadPoll(400))
    }
    view.webContents.setZoomFactor(this.zoomPercent / 100)
    void view.webContents.loadURL(url)
    return view
  }

  private createInstagramHeader() {
    const header = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    header.webContents.on('did-finish-load', () => {
      header.webContents.send('instagram:counts', this.instagramCounts)
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void header.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}?instagram-header=1`)
    } else {
      void header.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query: { 'instagram-header': '1' } })
    }
    return header
  }

  private createInstagramProbe() {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    view.webContents.on('dom-ready', () => {
      void view.webContents.executeJavaScript(INSTALL_INSTAGRAM_SOCKET_CAPTURE, true).catch(() => {})
    })
    view.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('__message-manager-ws__ ')) {
        const rawPayload = message.slice('__message-manager-ws__ '.length)
        writeAutomationDebug('socket-candidate', { payload: rawPayload.slice(0, 500) })
        try {
          const envelopeStart = rawPayload.indexOf('{')
          const envelope = JSON.parse(rawPayload.slice(envelopeStart).replace(/^;\s*/, '')) as { payload?: string }
          if (envelope.payload) {
            const decoded = Buffer.from(envelope.payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
            const messageId = decoded.match(/"message_id":"([^"]+)"/)?.[1] || decoded.match(/mid\.\$[A-Za-z0-9._-]+/)?.[0]
            const threadFbid = decoded.match(/"thread_fbid":"([^"]+)"/)?.[1]
            const senderFbid = decoded.match(/"sender_fbid":"([^"]+)"/)?.[1]
            const rawTextBody = decoded.match(/"text_body":"([^"]*)"/)?.[1] || ''
            if (messageId && threadFbid && senderFbid) {
              let textBody = rawTextBody
              try { textBody = JSON.parse('"' + rawTextBody + '"') } catch {}
              this.lastInstagramSocketMessage = { messageId, threadFbid, senderFbid, textBody }
              writeAutomationDebug('socket-message-decoded', { messageId, threadFbid, senderFbid, textBody })
            } else {
              writeAutomationDebug('socket-decode-miss', { decodedLength: decoded.length, hasMessageId: decoded.includes('message_id'), hasThread: decoded.includes('thread_fbid'), preview: decoded.slice(0, 200) })
            }
          }
        } catch (error) {
          writeAutomationDebug('socket-decode-error', { message: String(error) })
        }
      }
    })
    return view
  }

  private async getInstagramAutomationProbe() {
    this.instagramAutomationProbe ??= this.createInstagramProbe()
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.contentView.addChildView(this.instagramAutomationProbe)
        this.instagramAutomationProbe.setBounds({ x: -1600, y: -900, width: 1200, height: 800 })
      } catch {
        // The probe may already be attached.
      }
    }
    const webContents = this.instagramAutomationProbe.webContents
    if (webContents.getURL() !== INSTAGRAM_ROUTES.inbox) {
      try {
        writeAutomationDebug('probe-load', { url: INSTAGRAM_ROUTES.inbox })
        await webContents.loadURL(INSTAGRAM_ROUTES.inbox)
        await this.waitForAutomationInbox(webContents)
      } catch {
        return null
      }
    }
    return this.instagramAutomationProbe
  }

  private async waitForAutomationInbox(webContents: Electron.WebContents) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ready = await webContents.executeJavaScript(`document.querySelectorAll('[role="button"] img[alt="user-profile-picture"]').length > 0`, true).catch(() => false)
      if (ready) return
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  async show() {
    if (!this.window || this.window.isDestroyed()) return
    this.instagram ??= this.createView('https://www.instagram.com/direct/inbox/')
    this.instagramHeader ??= this.createInstagramHeader()
    this.instagramProbe ??= this.createInstagramProbe()
    this.applyAudioVolume(this.instagram)
    this.whatsapp ??= this.createView('https://web.whatsapp.com/')
    this.applyAudioVolume(this.whatsapp)
    this.window.contentView.addChildView(this.instagramHeader)
    this.window.contentView.addChildView(this.instagram)
    this.window.contentView.addChildView(this.whatsapp)
    this.visible = true
    this.setViewMode(this.viewMode)
    this.resize()
    this.startUnreadPolling()
  }

  private hide() {
    if (!this.window || this.window.isDestroyed()) return
    if (this.instagram) this.window.contentView.removeChildView(this.instagram)
    if (this.instagramHeader) this.window.contentView.removeChildView(this.instagramHeader)
    if (this.whatsapp) this.window.contentView.removeChildView(this.whatsapp)
    this.visible = false
      this.stopUnreadPolling()
      if (this.automationTimer) clearInterval(this.automationTimer)
      this.automationTimer = null
    this.updateTaskbarBadge(0)
  }

  private startUnreadPolling() {
    if (this.unreadTimer) return
    void this.pollUnread()
    this.unreadTimer = setInterval(() => void this.pollUnread(), 5000)
  }

  private stopUnreadPolling() {
    if (this.unreadTimer) clearInterval(this.unreadTimer)
    if (this.unreadRefreshTimer) clearTimeout(this.unreadRefreshTimer)
    this.unreadTimer = null
    this.unreadRefreshTimer = null
    this.unreadPolling = false
  }

  private scheduleUnreadPoll(delay: number) {
    if (!this.visible || this.unreadRefreshTimer) return
    this.unreadRefreshTimer = setTimeout(() => {
      this.unreadRefreshTimer = null
      void this.pollUnread()
    }, delay)
  }

  private async pollUnread() {
    if (this.unreadPolling) return
    this.unreadPolling = true
    try {
      const [instagramTotal, whatsappCount] = await Promise.all([
        this.pollInstagramProbe(),
        this.countUnread(this.whatsapp)
      ])
      this.whatsappUnreadCount = whatsappCount
      this.updateTaskbarBadge(instagramTotal + whatsappCount)
    } finally {
      this.unreadPolling = false
    }
  }

  private async countUnread(view: WebContentsView | null) {
    if (!view || view.webContents.isDestroyed() || !view.webContents.getURL()) return 0
    try {
      return Number(await view.webContents.executeJavaScript(UNREAD_SCRIPT, true)) || 0
    } catch {
      return 0
    }
  }

  private async runInstagramAutomation() {
    if (this.automationBusy || !this.automationGlobalEnabled || !this.hasConfiguredAutomation()) return
    this.automationBusy = true
    this.sendAutomationStatus(true)
    writeAutomationDebug('cycle-start')
    try {
      const automationProbe = await this.getInstagramAutomationProbe()
      if (!automationProbe || automationProbe.webContents.isDestroyed()) return
      await automationProbe.webContents.executeJavaScript(INSTALL_INSTAGRAM_CONTACT_CAPTURE, true).catch(() => false)
      await automationProbe.webContents.executeJavaScript(`(() => {
        const notification = document.querySelector('[aria-label*="nova notificação" i], [aria-label*="new notification" i]')
        const inboxLink = document.querySelector('a[href="/direct/inbox/"]')
        if (notification && inboxLink) inboxLink.click()
      })()`, true).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 350))
      const flows = listAutomationFlows()
        .filter(flow => flow.enabled)
        .map(flow => {
          try {
             const definition = JSON.parse(flow.definition) as { nodes?: Array<{ id: string; type?: string; text?: string; keywords?: string; parentId?: string }>; edges?: Array<{ from: string; to: string }>; fallbackNodeId?: string | null; trigger?: { keywords?: string[] }; actions?: Array<{ type?: string; text?: string }> }
             const fallbackNode = definition.nodes?.find(node => node.id === definition.fallbackNodeId) || definition.nodes?.find(node => node.type === 'fallback')
             const messageNodes = definition.nodes?.filter(node => node.type === 'message' && node.text?.trim()) || []
             const messageNode = messageNodes.find(node => !node.parentId) || messageNodes[0]
             const edges = definition.edges || []
             const endNodeIds = new Set((definition.nodes || []).filter(node => node.type === 'end').map(node => node.id))
             const conditions = (definition.nodes || []).filter(node => node.type === 'condition').map(condition => {
               const child = messageNodes.find(node => node.parentId === condition.id || edges.some(edge => edge.from === condition.id && edge.to === node.id))
               const responseEdges = edges.filter(edge => edge.from === child?.id)
               return {
                 keywords: (condition.keywords || '').split(',').map(keyword => keyword.trim().toLocaleLowerCase()).filter(Boolean),
                 response: child?.text?.trim() || '',
                 completed: Boolean(child && (responseEdges.length === 0 || responseEdges.some(edge => endNodeIds.has(edge.to))))
               }
             }).filter(condition => condition.keywords.length > 0 && condition.response)
             const responseEdges = edges.filter(edge => edge.from === messageNode?.id)
             return {
               id: flow.id,
               keywords: (definition.trigger?.keywords || []).map(keyword => keyword.toLocaleLowerCase()).filter(Boolean),
               response: definition.actions?.find(action => action.type === 'reply')?.text?.trim() || messageNode?.text?.trim() || '',
               fallbackResponse: fallbackNode?.text?.trim() || '',
               completed: Boolean(messageNode && conditions.length === 0 && (responseEdges.length === 0 || responseEdges.some(edge => endNodeIds.has(edge.to)))),
               conditions
             }
           } catch {
             return { id: flow.id, keywords: [], response: '', fallbackResponse: '', completed: false, conditions: [] }
           }
         })
        .filter(flow => (flow.keywords.length > 0 && flow.response) || flow.fallbackResponse)
       writeAutomationDebug('flows-loaded', { flows: flows.map(flow => ({ id: flow.id, keywords: flow.keywords, conditions: flow.conditions.length, responseLength: flow.response.length, fallbackLength: flow.fallbackResponse.length })) })
       const instagramAccountId = getAppSetting('instagram-account-id') || ''
       const processedMessageIds = listProcessedMessageIds('instagram', instagramAccountId)
       const now = Date.now()
       const conversationStates = listConversationStates('instagram', instagramAccountId)
       for (const state of conversationStates) {
         if (state.state === 'awaiting_reply' && now - Date.parse(state.updatedAt) >= 3 * 60 * 60 * 1000) {
           upsertConversationState({ platform: state.platform, accountId: state.accountId, conversationId: state.conversationId, flowId: state.flowId, currentState: 'completed', variables: state.variables })
         }
       }
        const activeFlowStates = Object.fromEntries(listConversationStates('instagram', instagramAccountId).filter(state => state.state === 'awaiting_reply' && state.flowId && now - Date.parse(state.updatedAt) < 3 * 60 * 60 * 1000).map(state => [state.conversationId, { flowId: state.flowId!, updatedAt: state.updatedAt }]))
        const completedFlowStates = Object.fromEntries(listConversationStates('instagram', instagramAccountId).filter(state => state.state === 'completed').map(state => [state.conversationId, true]))
        const socketState = this.lastInstagramSocketMessage && activeFlowStates[`thread:${this.lastInstagramSocketMessage.threadFbid}`]
        if (socketState && this.lastInstagramSocketMessage?.senderFbid) activeFlowStates[`thread:${this.lastInstagramSocketMessage.senderFbid}`] = socketState
        if (this.lastInstagramSocketMessage?.senderFbid && completedFlowStates[`thread:${this.lastInstagramSocketMessage.threadFbid}`]) completedFlowStates[`thread:${this.lastInstagramSocketMessage.senderFbid}`] = true
        const result = await automationProbe.webContents.executeJavaScript(createInstagramAutoReplyScript(this.automationText, !this.automationPrimed, this.automationAllowProcessedOnce, flows, processedMessageIds, this.automationKnownStates, this.automaticReplies, activeFlowStates, completedFlowStates), true) as { status?: string; conversation?: string; conversationId?: string; incomingText?: string; contact?: { conversationId?: string; accountId?: string; externalId?: string; username?: string; fullName?: string; profilePicUrl?: string }; ownState?: string; flowId?: string | null; completed?: boolean; rearm?: boolean; messageId?: string; states?: Record<string, string>; diagnostic?: { url?: string; markers?: number; skippedState?: number; skippedProcessed?: number; skippedReply?: number } }
        const socketMessage = this.lastInstagramSocketMessage
        if (result.status === 'sent' && result.incomingText && socketMessage && socketMessage.textBody && result.incomingText.toLocaleLowerCase().includes(socketMessage.textBody.toLocaleLowerCase())) {
          result.conversationId = `thread:${socketMessage.threadFbid}`
          result.messageId = `${result.conversationId}|${socketMessage.messageId}`
        }
       this.automationKnownStates = { ...this.automationKnownStates, ...(result.states || {}) }
      this.automationPrimed = true
      this.automationAllowProcessedOnce = false
       writeAutomationDebug('cycle-result', {
         status: result.status,
         diagnostic: result.diagnostic,
          conversation: result.conversation || null,
          conversationId: result.conversationId || null,
          flowId: result.flowId || null,
          messageId: result.messageId || null,
          incomingText: result.incomingText || null,
          contactExternalId: result.contact?.externalId || null,
          contactAccountId: result.contact?.accountId || null
      })
      if (result.status === 'idle' && result.diagnostic) {
        const diagnostic = `${result.diagnostic.url || 'sem URL'}|${result.diagnostic.rows || 0}|${result.diagnostic.markers || 0}|${result.diagnostic.skippedState || 0}|${result.diagnostic.skippedProcessed || 0}|${result.diagnostic.skippedReply || 0}`
        if (diagnostic !== this.lastAutomationDiagnostic) {
          this.lastAutomationDiagnostic = diagnostic
          this.addAutomationLog({
            conversation: 'Monitor do Instagram',
            action: 'reply',
            status: 'failed',
            detail: `Nenhuma resposta: ${result.diagnostic.rows || 0} conversas, ${result.diagnostic.markers || 0} não lidas, ${result.diagnostic.eligible || 0} elegíveis, ${result.diagnostic.skippedState || 0} estado, ${result.diagnostic.skippedProcessed || 0} processadas, ${result.diagnostic.skippedReply || 0} sem resposta`
          })
        }
      }
        if (result?.status === 'sent') {
         const resultAccountId = result.contact?.accountId || instagramAccountId
         if (result.contact?.accountId) setAppSetting('instagram-account-id', result.contact.accountId)
         if (result.conversationId && result.ownState) this.automationKnownStates[result.conversationId] = result.ownState
         if (result.messageId) markProcessedMessage('instagram', result.messageId, resultAccountId)
           let contactId = result.conversationId ? findContactIdByConversation('instagram', resultAccountId, result.conversationId) : undefined
           if (result.contact?.externalId && result.conversationId) {
            contactId = upsertContact({
              id: crypto.randomUUID(),
              platform: 'instagram',
              accountId: resultAccountId,
              externalId: result.contact.externalId,
              username: result.contact.username,
              fullName: result.contact.fullName,
              profilePicUrl: result.contact.profilePicUrl,
              metadata: JSON.stringify({ threadId: result.contact.conversationId || result.conversationId })
            })
            upsertContactConversation({
              platform: 'instagram',
              accountId: resultAccountId,
              conversationId: result.conversationId,
              contactId,
              state: result.flowId ? (result.completed ? 'completed' : 'awaiting_reply') : 'new'
            })
           }
           if (contactId && result.conversationId) {
             if (result.messageId && result.incomingText) {
               insertContactEvent({ id: `${result.messageId}:in`, contactId, platform: 'instagram', conversationId: result.conversationId, eventType: 'message', direction: 'inbound', content: result.incomingText, metadata: JSON.stringify({ messageId: result.messageId }) })
               insertContactEvent({ id: `${result.messageId}:out`, contactId, platform: 'instagram', conversationId: result.conversationId, eventType: result.flowId ? 'flow_reply' : 'automatic_reply', direction: 'outbound', content: result.ownState?.replace(/^Você:\s*/, '') || null, metadata: JSON.stringify({ flowId: result.flowId || null, messageId: result.messageId }) })
            } else {
              writeAutomationDebug('contact-events-skipped', { reason: 'missing-message-data', messageId: result.messageId || null, incomingText: result.incomingText || null, conversationId: result.conversationId })
            }
           } else {
             writeAutomationDebug('contact-events-skipped', { reason: 'missing-contact-data', messageId: result.messageId || null, incomingText: result.incomingText || null, conversationId: result.conversationId || null, externalId: result.contact?.externalId || null })
           }
         if (result.conversationId && result.flowId) {
             upsertConversationState({
               platform: 'instagram',
               accountId: resultAccountId,
               conversationId: result.conversationId,
            flowId: result.flowId,
             currentState: result.completed ? 'completed' : 'awaiting_reply'
           })
         } else if (result.conversationId && result.rearm) {
             upsertConversationState({
               platform: 'instagram',
               accountId: resultAccountId,
               conversationId: result.conversationId,
             currentState: 'new'
           })
         }
        this.addAutomationLog({
          conversation: result.conversation || 'Conversa sem nome',
          action: 'reply',
          status: 'sent',
          detail: 'Resposta automática enviada'
        })
      }
    } catch (error: any) {
      writeAutomationDebug('cycle-error', { message: String(error?.message || error), stack: String(error?.stack || '') })
      this.addAutomationLog({
        conversation: 'Instagram',
        action: 'reply',
        status: 'failed',
        detail: 'Falha ao executar a automação'
      })
    } finally {
      this.automationBusy = false
      this.sendAutomationStatus(false)
    }
  }

  private async runWhatsAppAutomation() {
    if (!this.whatsapp || this.whatsapp.webContents.isDestroyed()) return
    writeAutomationDebug('whatsapp-automation', { status: 'adapter-not-implemented' })
  }

  private addAutomationLog(log: Omit<AutomationLog, 'id' | 'at' | 'platform'>) {
    this.automationLogs.unshift({
      ...log,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      platform: 'instagram'
    })
    if (this.automationLogs.length > 200) this.automationLogs.length = 200
    insertAutomationLog(this.automationLogs[0])
    this.broadcastAutomationLogs()
  }

  private broadcastAutomationLogs() {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('app:automation-logs', this.automationLogs)
    })
  }

  private sendAutomationStatus(running: boolean) {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send('app:automation-status', {
      enabled: this.automationGlobalEnabled && this.hasConfiguredAutomation(),
      globalEnabled: this.automationGlobalEnabled,
      configured: this.hasConfiguredAutomation(),
      running
    })
  }

  private async pollInstagramProbe() {
    if (this.instagramProbeBusy || !this.instagramProbe || this.instagramProbe.webContents.isDestroyed()) {
      return this.instagramCounts.inbox + this.instagramCounts.requests + this.instagramCounts.hidden
    }

    this.instagramProbeBusy = true
    try {
      const visibleUrl = this.instagram?.webContents.getURL() || ''
      const visibleSection = visibleUrl.includes('/direct/requests/hidden')
        ? 'hidden'
        : visibleUrl.includes('/direct/requests')
          ? 'requests'
          : visibleUrl.includes('/direct/')
            ? 'inbox'
            : null

      const inbox = visibleSection === 'inbox'
        ? await this.countUnread(this.instagram)
        : await this.loadProbeRoute(INSTAGRAM_ROUTES.inbox)
          ? await this.countUnread(this.instagramProbe)
          : this.instagramCounts.inbox
      const requests = visibleSection === 'requests'
        ? await this.readRequestCount(this.instagram, 'requests')
        : await this.loadProbeRoute(INSTAGRAM_ROUTES.requests)
          ? await this.readRequestCount(this.instagramProbe, 'requests')
          : this.instagramCounts.requests
      const hidden = visibleSection === 'hidden'
        ? await this.readRequestCount(this.instagram, 'hidden')
        : await this.loadProbeRoute(INSTAGRAM_ROUTES.hidden)
          ? await this.readRequestCount(this.instagramProbe, 'hidden')
          : this.instagramCounts.hidden

      this.instagramCounts = { inbox, requests, hidden }
      if (this.instagramHeader && !this.instagramHeader.webContents.isDestroyed()) {
        this.instagramHeader.webContents.send('instagram:counts', this.instagramCounts)
      }
      return inbox + requests + hidden
    } finally {
      this.instagramProbeBusy = false
    }
  }

  private async loadProbeRoute(url: string) {
    if (!this.instagramProbe || this.instagramProbe.webContents.isDestroyed()) return false
    try {
      if (this.instagramProbe.webContents.getURL() !== url) await this.instagramProbe.webContents.loadURL(url)
      await new Promise(resolve => setTimeout(resolve, 600))
      await this.instagramProbe.webContents.executeJavaScript(PREPARE_PROBE_SCRIPT, true)
      await new Promise(resolve => setTimeout(resolve, 500))
      return true
    } catch {
      return false
    }
  }

  private async readRequestCount(view: WebContentsView | null, section: 'requests' | 'hidden') {
    if (!view || view.webContents.isDestroyed()) return 0
    try {
      const result = await view.webContents.executeJavaScript(INSTAGRAM_REQUESTS_SCRIPT, true) as { requests?: number; hidden?: number; rows?: number }
      const labeledCount = Number(result?.[section]) || 0
      const blueDotCount = await this.countUnread(view)
      return Math.max(labeledCount, blueDotCount, Number(result?.rows) || 0)
    } catch {
      return 0
    }
  }

  private updateTaskbarBadge(count: number) {
    if (count === this.unreadCount) return
    this.unreadCount = count
    app.setBadgeCount(count)
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('app:unread-count', count)
    }

    if (!this.window || this.window.isDestroyed() || process.platform !== 'win32') return
    if (count === 0) {
      this.window.setOverlayIcon(null, '')
      return
    }

    const label = count > 99 ? '99+' : String(count)
    this.window.setOverlayIcon(nativeImage.createFromBuffer(createTaskbarBadge(count)), `${label} conversas não lidas`)
  }

  private resize() {
    if (!this.visible || !this.window) return
    const { width, height } = this.window.getContentBounds()
    const contentWidth = Math.max(0, width - this.sidebarWidth)
    const contentHeight = Math.max(0, height - OFFICIAL_VIEWS_HEADER_HEIGHT)
    const instagramHeaderHeight = 44
    const instagramBounds = { y: OFFICIAL_VIEWS_HEADER_HEIGHT + instagramHeaderHeight, height: Math.max(0, contentHeight - instagramHeaderHeight) }
    const standardBounds = { y: OFFICIAL_VIEWS_HEADER_HEIGHT, height: contentHeight }
    if (this.viewMode === 'instagram' && this.instagram) {
      this.instagramHeader?.setBounds({ x: this.sidebarWidth, y: OFFICIAL_VIEWS_HEADER_HEIGHT, width: contentWidth, height: instagramHeaderHeight })
      this.instagram.setBounds({ ...instagramBounds, x: this.sidebarWidth, width: contentWidth })
      return
    }
    if (this.viewMode === 'whatsapp' && this.whatsapp) {
      this.whatsapp.setBounds({ ...standardBounds, x: this.sidebarWidth, width: contentWidth })
      return
    }
    if (!this.instagram || !this.whatsapp) return
    const panelWidth = Math.floor(contentWidth / 2)
    this.instagramHeader?.setBounds({ x: this.sidebarWidth, y: OFFICIAL_VIEWS_HEADER_HEIGHT, width: panelWidth, height: instagramHeaderHeight })
    this.instagram.setBounds({ ...instagramBounds, x: this.sidebarWidth, width: panelWidth })
    this.whatsapp.setBounds({ ...standardBounds, x: this.sidebarWidth + panelWidth, width: contentWidth - panelWidth })
  }
}

export const officialViews = new OfficialViews()
