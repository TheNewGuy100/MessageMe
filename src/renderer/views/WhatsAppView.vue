<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import QRLogin from '@/components/QRLogin.vue'
import ChatList from '@/components/ChatList.vue'
import MessageView from '@/components/MessageView.vue'

const status = ref('disconnected')
const chats = ref<any[]>([])
const messages = ref<any[]>([])
const selectedChat = ref<string | null>(null)
const selectedChatName = ref('')

const prefix = 'whatsapp'
const api = window.electronAPI.whatsapp

function onConnected() { status.value = 'connected'; loadChats() }
function onDisconnected() { status.value = 'disconnected'; chats.value = []; messages.value = []; selectedChat.value = null }

async function loadChats() { chats.value = await api.getChats() }

async function selectChat(chatId: string) {
  selectedChat.value = chatId
  const chat = chats.value.find(c => c.id === chatId)
  selectedChatName.value = chat?.name || chat?.subject || chatId
  messages.value = await api.getMessages(chatId)
}

async function sendMessage(text: string) {
  if (!selectedChat.value) return
  await api.sendMessage(selectedChat.value, text)
  messages.value = await api.getMessages(selectedChat.value)
}

function onMessage(msg: any) {
  if (msg.key?.remoteJid === selectedChat.value) {
    api.getMessages(selectedChat.value!).then(m => { messages.value = m })
  }
}

function onChatsUpdated(updated: any[]) { chats.value = updated }

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
    <template v-if="status === 'connected' && chats.length > 0">
      <ChatList
        :chats="chats"
        :selected-id="selectedChat ?? undefined"
        @select="selectChat"
      />
      <div v-if="selectedChat" class="chat-area">
        <MessageView
          :messages="messages"
          :chat-name="selectedChatName"
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

<style scoped>
.platform-view {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.chat-area {
  flex: 1;
  display: flex;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 15px;
}
</style>
