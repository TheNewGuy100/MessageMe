<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ChatList from '@/components/ChatList.vue'
import MessageView from '@/components/MessageView.vue'

const status = ref<'disconnected' | 'connected'>('disconnected')
const loading = ref(false)
const error = ref('')
const threads = ref<any[]>([])
const messages = ref<any[]>([])
const selectedThread = ref<string | null>(null)
const selectedThreadName = ref('')

const prefix = 'instagram'
const api = window.electronAPI.instagram

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    await api.loginWithBrowser()
    status.value = 'connected'
  } catch (e: any) {
    error.value = e.message || 'Erro ao conectar'
  } finally {
    loading.value = false
  }
}

async function handleLogout() {
  await api.logout()
  status.value = 'disconnected'
  threads.value = []
  messages.value = []
  selectedThread.value = null
}

async function loadThreads() { threads.value = await api.getThreads() }

async function selectThread(threadId: string) {
  selectedThread.value = threadId
  const t = threads.value.find(th => th.id === threadId)
  selectedThreadName.value = t?.name || threadId
  messages.value = await api.getMessages(threadId)
}

async function sendMessage(text: string) {
  if (!selectedThread.value) return
  await api.sendMessage(selectedThread.value, text)
  messages.value = await api.getMessages(selectedThread.value)
}

function onThreadsUpdated(updated: any[]) { threads.value = updated }
function onMessage(msg: any) {
  if (msg.threadId === selectedThread.value) {
    api.getMessages(selectedThread.value!).then(m => { messages.value = m })
  }
}

onMounted(async () => {
  window.electronAPI.onEvent(`${prefix}:connected`, () => { status.value = 'connected'; loadThreads() })
  window.electronAPI.onEvent(`${prefix}:disconnected`, () => { status.value = 'disconnected'; threads.value = []; messages.value = []; selectedThread.value = null })
  window.electronAPI.onEvent(`${prefix}:message`, onMessage)
  window.electronAPI.onEvent(`${prefix}:threadsUpdated`, onThreadsUpdated)

  await api.tryRestore()
  const s = await api.getStatus()
  if (s === 'connected') { status.value = 'connected'; loadThreads() }
})

onUnmounted(() => {
  window.electronAPI.removeListener(`${prefix}:connected`)
  window.electronAPI.removeListener(`${prefix}:disconnected`)
  window.electronAPI.removeListener(`${prefix}:message`)
  window.electronAPI.removeListener(`${prefix}:threadsUpdated`)
})
</script>

<template>
  <div class="platform-view">
    <div v-if="status === 'disconnected'" class="login-area">
      <div class="login-form">
        <h2>Instagram</h2>
        <p>Abra uma janela de login do Instagram</p>
        <p class="note">Uma janela do navegador vai abrir para você fazer login normalmente.<br>Funciona com qualquer tipo de conta (incluindo login via Facebook).</p>
        <p v-if="error" class="error">{{ error }}</p>
        <button @click="handleLogin" :disabled="loading">
          {{ loading ? 'Abrindo janela...' : 'Abrir login no navegador' }}
        </button>
      </div>
    </div>
    <div v-else class="content">
      <ChatList
        :chats="threads"
        :selected-id="selectedThread ?? undefined"
        @select="selectThread"
      />
      <div v-if="selectedThread" class="chat-area">
        <MessageView
          :messages="messages"
          :chat-name="selectedThreadName"
          @send="sendMessage"
        />
      </div>
      <div v-else class="empty-state">
        <p>Selecione uma conversa</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.platform-view {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.login-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 380px;
  padding: 32px;
  background: #1a1a1a;
  border-radius: 12px;
  border: 1px solid #2a2a2a;
  text-align: center;
}

.login-form h2 {
  margin-bottom: 4px;
}

.login-form p {
  color: #888;
  font-size: 13px;
}

.note {
  font-size: 12px !important;
  line-height: 1.5;
  color: #666 !important;
}

.login-form button {
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: #e1306c;
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
}

.login-form button:hover {
  background: #c92d61;
}

.login-form button:disabled {
  opacity: 0.4;
  cursor: default;
}

.error {
  color: #ff5252 !important;
  font-size: 12px;
}

.content {
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
