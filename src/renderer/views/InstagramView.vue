<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import ChatList from '@/components/ChatList.vue'
import MessageView from '@/components/MessageView.vue'

const status = ref<'disconnected' | 'connected'>('disconnected')
const loading = ref(false)
const loadingThreads = ref(false)
const loadingMessages = ref(false)
const loadingMoreThreads = ref(false)
const loadingMoreMessages = ref(false)
const error = ref('')
const threads = ref<any[]>([])
const messages = ref<any[]>([])
const sending = ref(false)
const sendError = ref('')
const selectedThread = ref<string | null>(null)
const selectedThreadGraphqlId = ref<string | null>(null)
const selectedThreadName = ref('')
const threadsCursor = ref<string | null>(null)
const hasMoreThreads = ref(false)
const activeFolder = ref<'main' | 'pending' | 'hidden'>('main')
const messagesCursor = ref<string | null>(null)
const hasMoreMessages = ref(false)
const searchQuery = ref('')
const threadsBeforeSearch = ref<any[] | null>(null)
let searchRequestId = 0

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
  selectedThreadGraphqlId.value = null
  threadsCursor.value = null
  messagesCursor.value = null
  searchQuery.value = ''
  threadsBeforeSearch.value = null
}

async function loadThreads(folder = activeFolder.value) {
  loadingThreads.value = true
  try {
    try {
      const cached = await api.getCachedThreads(folder)
      if (folder === activeFolder.value && cached.length) {
        threads.value = cached
        loadingThreads.value = false
      }
    } catch {
      // A missing cache must not prevent the live request.
    }
    const page = await api.getThreadsPage(folder)
    if (folder === activeFolder.value) threads.value = page.threads
    threadsCursor.value = page.nextCursor
    hasMoreThreads.value = page.hasMore
  } catch (e: any) {
    error.value = e?.message || 'Não foi possível carregar as conversas do Instagram'
  } finally {
    loadingThreads.value = false
  }
}

async function switchFolder(folder: 'main' | 'pending' | 'hidden') {
  if (folder === activeFolder.value) return
  activeFolder.value = folder
  selectedThread.value = null
  selectedThreadGraphqlId.value = null
  messages.value = []
  messagesCursor.value = null
  hasMoreMessages.value = false
  await loadThreads(folder)
}

async function loadMoreThreads() {
  if (!threadsCursor.value || loadingMoreThreads.value) return
  loadingMoreThreads.value = true
  try {
    const page = await api.getThreadsPage(activeFolder.value, threadsCursor.value)
    const existing = new Set(threads.value.map(thread => thread.id))
    threads.value = [...threads.value, ...page.threads.filter(thread => !existing.has(thread.id))]
    threadsCursor.value = page.nextCursor
    hasMoreThreads.value = page.hasMore
  } finally {
    loadingMoreThreads.value = false
  }
}

async function searchThreads(query: string) {
  searchQuery.value = query
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    threads.value = threadsBeforeSearch.value || threads.value
    threadsBeforeSearch.value = null
    return
  }
  if (!threadsBeforeSearch.value) threadsBeforeSearch.value = [...threads.value]
  const requestId = ++searchRequestId
  const results = await api.searchThreads(normalizedQuery)
  if (requestId !== searchRequestId || searchQuery.value.trim() !== normalizedQuery) return
  threads.value = results
  threadsCursor.value = null
  hasMoreThreads.value = false
}

async function selectThread(threadId: string) {
  selectedThread.value = threadId
  const t = threads.value.find(th => th.id === threadId)
  selectedThreadGraphqlId.value = t?.graphqlId || threadId
  selectedThreadName.value = t?.name || threadId
  loadingMessages.value = true
  try {
    const page = await api.getMessagesPage(threadId)
    messages.value = page.messages
    messagesCursor.value = page.nextCursor
    hasMoreMessages.value = page.hasMore
  } finally {
    loadingMessages.value = false
  }
}

async function loadOlderMessages() {
  if (!selectedThread.value || !messagesCursor.value || loadingMoreMessages.value) return
  loadingMoreMessages.value = true
  try {
    const page = await api.getMessagesPage(selectedThread.value, messagesCursor.value)
    const existing = new Set(messages.value.map(message => message.id))
    messages.value = [...page.messages.filter(message => !existing.has(message.id)), ...messages.value]
    messagesCursor.value = page.nextCursor
    hasMoreMessages.value = page.hasMore
  } finally {
    loadingMoreMessages.value = false
  }
}

async function sendMessage(text: string) {
  if (!selectedThread.value) return
  sendError.value = ''
  sending.value = true
  try {
    await api.sendMessage(selectedThreadGraphqlId.value || selectedThread.value, text)
    messages.value = await api.getMessages(selectedThread.value)
  } catch (e: any) {
    sendError.value = e?.message || 'Não foi possível enviar a mensagem'
  } finally {
    sending.value = false
  }
}

function onThreadsUpdated(updated: any[]) {
  loadingThreads.value = false
  if (searchQuery.value.trim()) return
  if (activeFolder.value !== 'main') return
  const merged = new Map(threads.value.map(thread => [thread.id, thread]))
  for (const thread of updated.filter(thread => !thread.folder || thread.folder === 'main')) {
    merged.set(thread.id, { ...merged.get(thread.id), ...thread })
  }
  threads.value = [...merged.values()].sort((a, b) => Number(b.lastTimestamp || 0) - Number(a.lastTimestamp || 0))
}
function onMessage(msg: any) {
  if (msg.threadId === selectedThread.value) {
    api.getMessages(selectedThread.value!).then(m => { messages.value = m })
  }
}

onMounted(async () => {
  window.electronAPI.onEvent(`${prefix}:connected`, () => { status.value = 'connected'; loadingThreads.value = true; loadThreads() })
  window.electronAPI.onEvent(`${prefix}:disconnected`, () => {
    status.value = 'disconnected'
    loadingThreads.value = false
    loadingMessages.value = false
    threads.value = []
    messages.value = []
    selectedThread.value = null
    selectedThreadGraphqlId.value = null
    threadsCursor.value = null
    messagesCursor.value = null
    searchQuery.value = ''
    threadsBeforeSearch.value = null
  })
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
          <div class="folder-tabs">
            <button :class="{ active: activeFolder === 'main' }" @click="switchFolder('main')">Principal</button>
            <button :class="{ active: activeFolder === 'pending' }" @click="switchFolder('pending')">Solicitações</button>
            <button :class="{ active: activeFolder === 'hidden' }" @click="switchFolder('hidden')">Ocultas</button>
          </div>
          <div v-if="loadingThreads" class="list-loading">
          <span class="list-spinner"></span>
        </div>
        <ChatList
          v-else
          :chats="threads"
          platform="instagram"
          :has-more="hasMoreThreads"
          :loading-more="loadingMoreThreads"
          :selected-id="selectedThread ?? undefined"
          @select="selectThread"
          @load-more="loadMoreThreads"
          @search="searchThreads"
        />
      </div>
      <div v-if="selectedThread" class="chat-area">
        <p v-if="sendError" class="send-error">{{ sendError }}</p>
        <MessageView
          :messages="messages"
          :chat-name="selectedThreadName"
          :loading="loadingMessages"
          :sending="sending"
          :has-more="hasMoreMessages"
          :loading-more="loadingMoreMessages"
          :scroll-key="`instagram:${selectedThread}`"
          @send="sendMessage"
          @load-more="loadOlderMessages"
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

.folder-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid $border-color;
  background: $bg-secondary;
}

.folder-tabs button {
  flex: 1;
  min-width: 0;
  padding: 7px 5px;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-secondary;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.folder-tabs button:hover,
.folder-tabs button.active {
  border-color: $accent;
  background: $bg-accent-18;
  color: $accent;
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
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
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

.list-arc {
  width: 82%;
  height: 28px;
  border-bottom: 4px solid rgba($instagram, 0.58);
  border-radius: 0 0 50% 50% / 0 0 100% 100%;
  box-shadow: 0 4px 10px rgba($instagram, 0.42), 0 0 18px rgba($instagram, 0.18);
  animation: list-glow 1.1s ease-in-out infinite;
}

.list-spinner {
  @include spinner;
}

@keyframes list-glow {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.72; }
}

.send-error {
  margin: 8px 16px 0;
  color: $text-error;
  font-size: 12px;
}
</style>
