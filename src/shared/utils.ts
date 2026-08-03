function toMs(ts: number | string | undefined): number | null {
  if (ts == null) return null
  const num = typeof ts === 'object' && ts !== null && 'low' in ts
    ? Number((ts as any).low) + Number((ts as any).high || 0) * 4294967296
    : typeof ts === 'number' ? ts : Number(ts)
  if (!num) return null
  return num > 1e11 ? num : num * 1000
}

export function formatTime(ts: number | string | undefined): string {
  const ms = toMs(ts)
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

export function formatRelativeTime(ts: number | string | undefined): string {
  const ms = toMs(ts)
  if (!ms) return ''
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return rtf.format(-Math.max(1, seconds), 'second')
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  if (hours < 24) return rtf.format(-hours, 'hour')
  if (days < 7) return rtf.format(-days, 'day')
  if (days < 30) return rtf.format(-Math.floor(days / 7), 'week')
  return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
}

export function getName(chat: any): string {
  return chat.name || chat.notify || chat.verifiedName || chat.subject || chat.id?.split('@')[0]?.replace(/[^0-9]/g, '') || 'Unknown'
}

export function getText(msg: any): string {
  if (!msg) return ''
  if (typeof msg === 'string') return msg

  const content = msg.message?.ephemeralMessage?.message
    || msg.message?.viewOnceMessage?.message
    || msg.message?.viewOnceMessageV2?.message
    || msg.message
    || msg

  return content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || content.buttonsResponseMessage?.selectedDisplayText
    || content.listResponseMessage?.title
    || content.templateButtonReplyMessage?.selectedDisplayText
    || content.contactMessage?.displayName
    || content.contactsArrayMessage?.contacts?.map((contact: any) => contact.displayName).filter(Boolean).join(', ')
    || content.locationMessage?.name
    || content.locationMessage?.address
    || content.liveLocationMessage?.caption
    || content.pollCreationMessage?.name
    || content.productMessage?.product?.title
    || content.reactionMessage?.text
    || msg.text
    || ''
}

export function isMine(msg: any): boolean {
  return msg.key?.fromMe || msg.isMine
}
