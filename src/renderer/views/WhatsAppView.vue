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
const sending = ref(false)
const sendError = ref('')
const selectedChat = ref<string | null>(null)
const selectedChatName = ref('')

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
  loadingChats.value = true
  try {
    chats.value = await api.getChats()
  } finally {
    loadingChats.value = false
  }
}

async function selectChat(chatId: string) {
  selectedChat.value = chatId
  const chat = chats.value.find(c => c.id === chatId)
  selectedChatName.value = chat?.name || chat?.subject || chatId
  loadingMessages.value = true
  try {
    messages.value = await api.getMessages(chatId)
  } finally {
    loadingMessages.value = false
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

function onMessage(msg: any) {
  if (msg.key?.remoteJid === selectedChat.value) {
    api.getMessages(selectedChat.value!).then(m => { messages.value = m })
  }
}

function onChatsUpdated(updated: any[]) {
  loadingChats.value = false
  chats.value = updated
}

onMounted(async () => {
  window.electronAPI.onEvent(`${prefix}:connected`, onConnected)
  window.electronAPI.onEvent(`${prefix}:disconnected`, onDisconnected)
  window.electronAPI.onEvent(`${prefix}:message`, onMessage)
  window.electronAPI.onEvent(`${prefix}:chatsUpdated`, onChatsUpdated)

  status.value = await api.getStatus()
  if (status.value === 'connected') loadChats()
})

onUnmounted(() => {
  window.electronAPI.removeListener(`${prefix}:connected`)
  window.electronAPI.removeListener(`${prefix}:disconnected`)
  window.electronAPI.removeListener(`${prefix}:message`)
  window.electronAPI.removeListener(`${prefix}:chatsUpdated`)
})
</script>

<template>
  <div class="platform-view">
    <template v-if="status === 'connected'">
      <div class="sidebar-area">
        <div v-if="loadingChats" class="list-loading">
          <span class="list-spinner"></span>
        </div>
        <ChatList
          v-else
          :chats="chats"
          platform="whatsapp"
          :selected-id="selectedChat ?? undefined"
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
          @send="sendMessage"
        />
      </div>
      <div v-else class="empty-state">
        <p>Selecione uma conversa</p>
      </div>
    </template>
    <QRLogin v-else @connected="onConnected" />
  </div>
</template>

<style scoped lang="scss">
.platform-view {
  @include flex-fill;
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

.list-loading {
  flex: 1;
  @include flex-center;
}

.list-spinner {
  @include spinner;
}
</style>
