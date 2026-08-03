<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import QRLogin from '@/components/QRLogin.vue'
import ChatList from '@/components/ChatList.vue'
import MessageView from '@/components/MessageView.vue'

const status = ref('disconnected')
const chats = ref<any[]>([])
const messages = ref<any[]>([])
const loadingChats = ref(false)
const loadingMessages = ref(false)
const loadingMoreMessages = ref(false)
const hasMoreMessages = ref(true)
const sending = ref(false)
const sendError = ref('')
const selectedChat = ref<string | null>(null)
const selectedChatName = ref('')
let chatLoadPromise: Promise<void> | null = null
let messageRequestId = 0
let messagesRefreshTimer: ReturnType<typeof setTimeout> | null = null

const prefix = 'whatsapp'
const api = window.electronAPI.whatsapp

function onConnected() { status.value = 'connected'; loadChats() }
function onDisconnected() {
  status.value = 'disconnected'
  loadingChats.value = false
  loadingMessages.value = false
  chats.value = []
  messages.value = []
  selectedChat.value = null
}

async function loadChats() {
  if (chatLoadPromise) return chatLoadPromise

  loadingChats.value = true
  chatLoadPromise = (async () => {
    try {
      chats.value = await api.getChats()
    } finally {
      if (!(await api.getHistorySyncing())) loadingChats.value = false
    }
  })()

  try {
    await chatLoadPromise
  } finally {
    chatLoadPromise = null
  }
}

async function selectChat(chatId: string) {
  const requestId = ++messageRequestId
  selectedChat.value = chatId
  const chat = chats.value.find(c => c.id === chatId)
  selectedChatName.value = chat?.name || chat?.subject || chatId
  loadingMessages.value = true
  hasMoreMessages.value = true
  try {
    const loadedMessages = await api.getMessages(chatId)
    if (requestId === messageRequestId && selectedChat.value === chatId) messages.value = loadedMessages
  } finally {
    if (requestId === messageRequestId) loadingMessages.value = false
  }
}

async function loadOlderMessages() {
  if (!selectedChat.value || !messages.value.length || loadingMoreMessages.value) return
  const beforeId = messages.value[0].id || messages.value[0].key?.id
  if (!beforeId) return
  loadingMoreMessages.value = true
  try {
    const result = await api.getOlderMessages(selectedChat.value, beforeId)
    const existing = new Set(messages.value.map(message => message.id || message.key?.id))
    const older = result.messages.filter(message => !existing.has(message.id || message.key?.id))
    messages.value = [...older, ...messages.value].sort((a, b) => {
      const timestamp = (message: any) => {
        const value = message?.messageTimestamp ?? message?.timestamp
        if (value && typeof value === 'object' && typeof value.low === 'number') return value.low + (value.high || 0) * 4294967296
        return Number(value) || 0
      }
      return timestamp(a) - timestamp(b)
    })
    hasMoreMessages.value = result.hasMore
  } finally {
    loadingMoreMessages.value = false
  }
}

async function sendMessage(text: string) {
  if (!selectedChat.value) return
  sendError.value = ''
  sending.value = true
  try {
    await api.sendMessage(selectedChat.value, text)
    messages.value = await api.getMessages(selectedChat.value)
  } catch (e: any) {
    sendError.value = e?.message || 'Não foi possível enviar a mensagem'
  } finally {
    sending.value = false
  }
}

async function sendMedia(file: { data: Uint8Array; mimeType: string; fileName: string; caption: string }) {
  if (!selectedChat.value) return
  sendError.value = ''
  sending.value = true
  try {
    await api.sendMedia(selectedChat.value, file.data, file.mimeType, file.fileName, file.caption)
    messages.value = await api.getMessages(selectedChat.value)
  } catch (e: any) {
    sendError.value = e?.message || 'Não foi possível enviar a mídia'
  } finally {
    sending.value = false
  }
}

function loadMedia(message: any) {
  if (!selectedChat.value) return Promise.resolve(null)
  return api.getMedia(selectedChat.value, message.key?.id || message.id)
}

function onMessage(msg: any) {
  if (msg.key?.remoteJid === selectedChat.value) {
    api.getMessages(selectedChat.value!).then(m => { messages.value = m })
  }
}

function onChatsUpdated(updated: any[]) {
  chats.value = updated
  if (updated.length > 0) loadingChats.value = false
}

async function onMessagesUpdated(chatIds: string[]) {
  if (
    !selectedChat.value
    || loadingMessages.value
    || loadingMoreMessages.value
    || messages.value.length > 50
    || !chatIds.includes(selectedChat.value)
  ) return
  if (messagesRefreshTimer) clearTimeout(messagesRefreshTimer)
  messagesRefreshTimer = setTimeout(async () => {
    messagesRefreshTimer = null
    if (!selectedChat.value || loadingMessages.value || loadingMoreMessages.value || messages.value.length > 50) return
    const chatId = selectedChat.value
    const updatedMessages = await api.getMessages(chatId)
    if (selectedChat.value === chatId && !loadingMoreMessages.value) messages.value = updatedMessages
  }, 300)
}

function onHistorySync(syncing: boolean) {
  loadingChats.value = syncing
}

onMounted(async () => {
  window.electronAPI.onEvent(`${prefix}:connected`, onConnected)
  window.electronAPI.onEvent(`${prefix}:disconnected`, onDisconnected)
  window.electronAPI.onEvent(`${prefix}:message`, onMessage)
  window.electronAPI.onEvent(`${prefix}:chatsUpdated`, onChatsUpdated)
  window.electronAPI.onEvent(`${prefix}:messagesUpdated`, onMessagesUpdated)
  window.electronAPI.onEvent(`${prefix}:historySync`, onHistorySync)

  status.value = await api.getStatus()
  if (status.value === 'connected') {
    loadingChats.value = await api.getHistorySyncing()
    loadChats()
  }
})

onUnmounted(() => {
  if (messagesRefreshTimer) clearTimeout(messagesRefreshTimer)
  window.electronAPI.removeListener(`${prefix}:connected`)
  window.electronAPI.removeListener(`${prefix}:disconnected`)
  window.electronAPI.removeListener(`${prefix}:message`)
  window.electronAPI.removeListener(`${prefix}:chatsUpdated`)
  window.electronAPI.removeListener(`${prefix}:messagesUpdated`)
  window.electronAPI.removeListener(`${prefix}:historySync`)
})
</script>

<template>
  <div class="platform-view">
    <template v-if="status === 'connected'">
      <div class="connected-layout">
        <div v-if="loadingChats" class="sync-banner" role="status">
          <span class="sync-spinner"></span>
          <span>Sincronizando conversas...</span>
        </div>
        <div class="content-layout">
          <div class="sidebar-area">
            <ChatList
              :chats="chats"
              platform="whatsapp"
              :selected-id="selectedChat ?? undefined"
              :disabled="loadingChats"
              @select="selectChat"
            />
          </div>
          <div v-if="selectedChat" class="chat-area">
            <MessageView
              :messages="messages"
              :chat-name="selectedChatName"
              :loading="loadingMessages"
              :sending="sending"
              :error="sendError"
              :media-loader="loadMedia"
              :media-sender="sendMedia"
              :has-more="hasMoreMessages"
              :loading-more="loadingMoreMessages"
              :scroll-key="`whatsapp:${selectedChat}`"
              @send="sendMessage"
              @send-media="sendMedia"
              @load-more="loadOlderMessages"
            />
          </div>
          <div v-else class="empty-state">
            <p>Selecione uma conversa</p>
          </div>
          <div v-if="loadingChats" class="history-overlay" role="status" aria-live="polite">
            <div class="history-overlay-label">Carregando...</div>
            <div class="history-progress">
              <span class="history-progress-bar"></span>
            </div>
          </div>
        </div>
      </div>
    </template>
    <QRLogin v-else @connected="onConnected" />
  </div>
</template>

<style scoped lang="scss">
.platform-view {
  @include flex-fill;
}

.connected-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.content-layout {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.history-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 56px;
  background: rgba($bg-primary, 0.78);
  backdrop-filter: blur(3px);
  pointer-events: all;
}

.history-overlay-label {
  color: $text-primary;
  font-size: 15px;
  letter-spacing: 0.02em;
}

.history-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 4px;
  overflow: hidden;
  background: rgba($accent, 0.16);
}

.history-progress-bar {
  display: block;
  width: 32%;
  height: 100%;
  background: $accent;
  box-shadow: 0 0 14px rgba($accent, 0.8);
  animation: history-progress-slide 1.4s ease-in-out infinite;
}

@keyframes history-progress-slide {
  0% { transform: translateX(-110%); }
  50% { transform: translateX(210%); }
  100% { transform: translateX(330%); }
}

.chat-area {
  flex: 1;
  display: flex;
}

.empty-state {
  flex: 1;
  @include flex-center;
  color: $text-muted;
  font-size: 15px;
}

.sidebar-area {
  width: $chatlist-width;
  border-right: 1px solid $border-color;
  @include flex-column;
}

.sync-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba($accent, 0.25);
  background: rgba($accent, 0.08);
  color: $text-secondary;
  font-size: 12px;
}

.sync-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba($accent, 0.25);
  border-top-color: $accent;
  border-radius: $radius-full;
  animation: spin 0.8s linear infinite;
}

.list-arc {
  width: 82%;
  height: 28px;
  border-bottom: 4px solid rgba($accent, 0.58);
  border-radius: 0 0 50% 50% / 0 0 100% 100%;
  box-shadow: 0 4px 10px rgba($accent, 0.42), 0 0 18px rgba($accent, 0.18);
  animation: list-glow 1.1s ease-in-out infinite;
}

@keyframes list-glow {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.72; }
}
</style>
