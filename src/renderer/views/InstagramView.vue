<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ChatList from '@/components/ChatList.vue'
import MessageView from '@/components/MessageView.vue'

const status = ref<'disconnected' | 'connected'>('disconnected')
const loading = ref(false)
const loadingThreads = ref(false)
const error = ref('')
const threads = ref<any[]>([])
const messages = ref<any[]>([])
const sending = ref(false)
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

async function loadThreads() {
  loadingThreads.value = true
  threads.value = await api.getThreads()
  loadingThreads.value = false
}

async function selectThread(threadId: string) {
  selectedThread.value = threadId
  const t = threads.value.find(th => th.id === threadId)
  selectedThreadName.value = t?.name || threadId
  messages.value = await api.getMessages(threadId)
}

async function sendMessage(text: string) {
  if (!selectedThread.value) return
  sending.value = true
  try {
    await api.sendMessage(selectedThread.value, text)
    messages.value = await api.getMessages(selectedThread.value)
  } finally {
    sending.value = false
  }
}

function onThreadsUpdated(updated: any[]) {
  loadingThreads.value = false
  threads.value = updated
}
function onMessage(msg: any) {
  if (msg.threadId === selectedThread.value) {
    api.getMessages(selectedThread.value!).then(m => { messages.value = m })
  }
}

onMounted(async () => {
  window.electronAPI.onEvent(`${prefix}:connected`, () => { status.value = 'connected'; loadingThreads.value = true; loadThreads() })
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
      <div class="sidebar-area">
        <div v-if="loadingThreads && threads.length === 0" class="list-loading">
          <span class="list-spinner"></span>
        </div>
        <ChatList
          v-else
          :chats="threads"
          :selected-id="selectedThread ?? undefined"
          @select="selectThread"
        />
      </div>
      <div v-if="selectedThread" class="chat-area">
        <MessageView
          :messages="messages"
          :chat-name="selectedThreadName"
          :sending="sending"
          @send="sendMessage"
        />
      </div>
      <div v-else class="empty-state">
        <p>Selecione uma conversa</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.platform-view {
  @include flex-fill;
}

.login-area {
  flex: 1;
  @include flex-center;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 380px;
  padding: 32px;
  background: $bg-secondary;
  border-radius: $radius-lg;
  border: 1px solid $border-color;
  text-align: center;
}

.login-form h2 { margin-bottom: 4px; }

.login-form p {
  color: $text-secondary;
  font-size: 13px;
}

.note {
  font-size: 12px !important;
  line-height: 1.5;
  color: $text-muted !important;
}

.login-form button {
  padding: 10px;
  border: none;
  border-radius: $radius-md;
  background: $instagram;
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
}

.login-form button:hover { background: $instagram-hover; }
.login-form button:disabled { opacity: 0.4; cursor: default; }

.error {
  color: $text-error !important;
  font-size: 12px !important;
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
