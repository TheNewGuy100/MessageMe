<script setup lang="ts">
import { nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { formatTime, getText, isMine } from '@shared/utils'

const props = defineProps<{
  messages: any[]
  chatName: string
  loading?: boolean
  sending?: boolean
  error?: string
  mediaLoader?: (message: any) => Promise<string | null>
  mediaSender?: (file: { data: Uint8Array; mimeType: string; fileName: string; caption: string }) => Promise<void>
  hasMore?: boolean
  loadingMore?: boolean
  scrollKey?: string
}>()

const emit = defineEmits<{
  send: [text: string]
  'send-media': [file: { data: Uint8Array; mimeType: string; fileName: string; caption: string }]
  'load-more': []
}>()
const inputText = ref('')
const mediaUrls = ref<Record<string, string>>({})
const mediaLoading = ref<Record<string, boolean>>({})
const mediaErrors = ref<Record<string, boolean>>({})
const loadingMedia = new Set<string>()
const messagesContainer = ref<HTMLElement | null>(null)
let pendingScrollHeight: number | null = null
let loadMorePending = false
let stayAtBottom = true
let needsRestore = true
let hasMounted = false
let skipInitialActivation = false

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value && props.messages.length) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      stayAtBottom = true
      if (props.scrollKey) sessionStorage.setItem(`message-scroll-v3:${props.scrollKey}`, String(messagesContainer.value.scrollTop))
    }
  })
}

function restoreScrollPosition() {
  if (!props.scrollKey) {
    needsRestore = false
    return false
  }
  const saved = sessionStorage.getItem(`message-scroll-v3:${props.scrollKey}`)
  if (saved === null) {
    needsRestore = false
    return false
  }
  needsRestore = false
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = Number(saved)
      stayAtBottom = messagesContainer.value.scrollHeight - messagesContainer.value.scrollTop - messagesContainer.value.clientHeight <= 120
    }
  })
  return true
}

function restoreAfterActivation() {
  if (!hasMounted) {
    hasMounted = true
    needsRestore = false
    if (!props.loading && props.messages.length) scrollToBottom()
    return
  }
  needsRestore = true
  if (props.loading || !props.messages.length) return
  nextTick(() => {
    if (!props.loading && !restoreScrollPosition() && stayAtBottom) scrollToBottom()
  })
}

function handleMediaLoad() {
  if (stayAtBottom) scrollToBottom()
}

function messageId(message: any) {
  return message.id || message.key?.id || ''
}

function mediaKind(message: any) {
  if (message.mediaType) return message.mediaType
  const content = message.message?.ephemeralMessage?.message
    || message.message?.viewOnceMessage?.message
    || message.message
  if (content?.imageMessage) return 'image'
  if (content?.videoMessage) return content.videoMessage.gifPlayback ? 'gif' : 'video'
  if (content?.audioMessage) return 'audio'
  if (content?.stickerMessage) return 'sticker'
  if (content?.documentMessage) return 'document'
  return ''
}

function mediaSource(message: any) {
  return mediaUrls.value[messageId(message)] || message.mediaUrl || ''
}

function isRenderable(message: any) {
  return Boolean(getText(message) || mediaKind(message))
}

function hasMessageText(message: any) {
  return Boolean(getText(message).trim())
}

function linkPreview(message: any) {
  return message.message?.extendedTextMessage?.contextInfo?.externalAdReply
}

watch(() => props.messages, async (messages) => {
  if (!props.mediaLoader) return
  for (const message of messages || []) {
    const id = messageId(message)
    if (!id || !mediaKind(message) || mediaUrls.value[id] || loadingMedia.has(id)) continue
    loadingMedia.add(id)
    mediaLoading.value[id] = true
    mediaErrors.value[id] = false
    try {
      const url = await props.mediaLoader(message)
      if (url) {
        mediaUrls.value[id] = url
        if (stayAtBottom) scrollToBottom()
      } else {
        mediaErrors.value[id] = true
      }
    } catch {
      mediaErrors.value[id] = true
    } finally {
      mediaLoading.value[id] = false
      loadingMedia.delete(id)
    }
  }
}, { immediate: true })

watch(() => props.messages, () => {
  const container = messagesContainer.value
  const preservePosition = Boolean(container && !stayAtBottom && pendingScrollHeight === null)
  const previousHeight = container?.scrollHeight || 0
  const previousTop = container?.scrollTop || 0
  if (pendingScrollHeight !== null) {
    const previousHeight = pendingScrollHeight
    pendingScrollHeight = null
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop += messagesContainer.value.scrollHeight - previousHeight
      }
    })
  } else if (preservePosition) {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = previousTop + messagesContainer.value.scrollHeight - previousHeight
      }
    })
  } else if (!props.loading && !props.loadingMore) {
    if (needsRestore) {
      if (!restoreScrollPosition() && stayAtBottom) scrollToBottom()
    } else if (stayAtBottom) {
      scrollToBottom()
    }
  }
}, { deep: true })
watch(() => props.loadingMore, (loading) => {
  if (!loading) loadMorePending = false
})
watch(() => props.loading, (loading, previousLoading) => {
  if (previousLoading && !loading) {
    if (needsRestore) {
      if (!restoreScrollPosition() && stayAtBottom) scrollToBottom()
    } else if (stayAtBottom) {
      scrollToBottom()
    }
  }
})
watch(() => props.sending, (sending, previousSending) => {
  if (previousSending && !sending) scrollToBottom()
})
watch(() => props.scrollKey, () => {
  stayAtBottom = true
  needsRestore = true
})

onMounted(restoreAfterActivation)
onMounted(() => { skipInitialActivation = true })
onActivated(() => {
  if (skipInitialActivation) {
    skipInitialActivation = false
    return
  }
  restoreAfterActivation()
})

function handleMessagesScroll(event: Event) {
  const element = event.currentTarget as HTMLElement
  stayAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 120
  if (props.scrollKey && props.messages.length) sessionStorage.setItem(`message-scroll-v3:${props.scrollKey}`, String(element.scrollTop))
  if (event.isTrusted && element.scrollTop <= 80 && props.hasMore && !props.loadingMore && !loadMorePending) {
    loadMorePending = true
    pendingScrollHeight = element.scrollHeight
    emit('load-more')
  }
}

function handleSend() {
  const text = inputText.value.trim()
  if (!text) return
  emit('send', text)
  inputText.value = ''
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.mediaSender || props.sending || props.loading) return

  emit('send-media', {
    data: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type || 'application/octet-stream',
    fileName: file.name,
    caption: inputText.value.trim()
  })
  inputText.value = ''
}
</script>

<template>
  <div class="message-view">
    <div class="header">
      <span class="name">{{ chatName }}</span>
    </div>

    <div ref="messagesContainer" class="messages" @scroll="handleMessagesScroll">
      <div v-if="loading" class="conversation-loading">
        <span class="conversation-spinner"></span>
      </div>
      <div v-if="loadingMore" class="history-loading" aria-label="Carregando mensagens antigas">
        <span class="history-arc"></span>
      </div>
      <template
        v-for="msg in messages"
        :key="msg.id || msg.key?.id"
      >
        <div v-if="isRenderable(msg)" v-show="!loading" :class="['message', { mine: isMine(msg) }]">
          <div :class="['bubble', {
            'media-only-bubble': mediaKind(msg) && !hasMessageText(msg),
            'media-caption-bubble': mediaKind(msg) && hasMessageText(msg)
          }]">
            <div v-if="mediaLoader && mediaKind(msg) && mediaLoading[messageId(msg)]" class="media-loading">
              <span class="media-spinner"></span>
              <span>Carregando mídia...</span>
            </div>
            <div v-else-if="mediaLoader && mediaKind(msg) && mediaErrors[messageId(msg)]" class="media-unavailable">
              Mídia indisponível
            </div>
            <img
            v-if="mediaSource(msg) && (mediaKind(msg) === 'image' || mediaKind(msg) === 'sticker')"
            :src="mediaSource(msg)"
            class="media-image"
            @load="handleMediaLoad"
          />
            <video
            v-else-if="mediaSource(msg) && (mediaKind(msg) === 'video' || mediaKind(msg) === 'gif')"
            :src="mediaSource(msg)"
            class="media-video"
            controls
            :autoplay="mediaKind(msg) === 'gif'"
            :loop="mediaKind(msg) === 'gif'"
            :muted="mediaKind(msg) === 'gif'"
            @loadedmetadata="handleMediaLoad"
          />
            <audio v-else-if="mediaSource(msg) && mediaKind(msg) === 'audio'" :src="mediaSource(msg)" controls @loadedmetadata="handleMediaLoad" />
            <a
              v-else-if="mediaSource(msg) && mediaKind(msg) === 'document'"
              :href="mediaSource(msg)"
              download
              class="document-link"
            >Baixar arquivo</a>
            <a
              v-if="linkPreview(msg)?.url"
              :href="linkPreview(msg).url"
              target="_blank"
              rel="noreferrer"
              class="link-preview"
            >
              <strong>{{ linkPreview(msg).title || linkPreview(msg).sourceUrl }}</strong>
              <span v-if="linkPreview(msg).description">{{ linkPreview(msg).description }}</span>
            </a>
            <p>{{ getText(msg) }}</p>
            <span class="time">{{ formatTime(msg.messageTimestamp || msg.timestamp) }}</span>
          </div>
        </div>
      </template>
    </div>

    <div class="input-area">
      <label v-if="mediaSender" class="attach-button" :class="{ disabled: sending || loading }" title="Enviar foto, vídeo, GIF ou áudio">
        <input
          type="file"
          accept="image/*,video/*,audio/*"
          :disabled="sending || loading"
          @change="handleFileSelected"
        />
        <span>+</span>
      </label>
      <input
        v-model="inputText"
        type="text"
        placeholder="Digite uma mensagem..."
        @keydown.enter="handleSend"
      />
      <button @click="handleSend" :disabled="!inputText.trim() || sending || loading">
        <span v-if="sending" class="spinner"></span>
        <span v-else>Enviar</span>
      </button>
    </div>
    <p v-if="error" class="send-error">{{ error }}</p>
  </div>
</template>

<style scoped lang="scss">
.message-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
  @include flex-column;
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid $border-color;
  font-weight: 600;
  font-size: 15px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  @include flex-column;
  gap: 6px;
  position: relative;
}

.conversation-loading {
  flex: 1;
  @include flex-center;
}

.conversation-spinner {
  @include spinner;
}

.history-loading {
  position: absolute;
  top: -30px;
  left: -16px;
  z-index: 2;
  width: calc(100% + 32px);
  height: 28px;
  pointer-events: none;
}

.history-arc {
  display: block;
  width: 82%;
  height: 28px;
  margin: 0 auto;
  border: 0;
  border-bottom: 4px solid rgba($accent, 0.58);
  border-radius: 0 0 50% 50% / 0 0 100% 100%;
  background: transparent;
  box-shadow: 0 4px 10px rgba($accent, 0.42), 0 0 18px rgba($accent, 0.18);
  animation: history-glow 1.1s ease-in-out infinite;
}

@keyframes history-glow {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.72; }
}

.message { display: flex; }
.message.mine { justify-content: flex-end; }

.bubble {
  @include bubble-message;
}

.bubble.media-only-bubble {
  padding: 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
}

.media-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
  min-height: 44px;
  color: $text-secondary;
  font-size: 12px;
}

.media-unavailable {
  color: $text-muted;
  font-size: 12px;
}

.media-spinner {
  @include spinner(16px, 2px, $accent, rgba($accent, 0.18));
}

.mine .bubble {
  background: $bg-accent-20;
  border-bottom-right-radius: 4px;
}

.mine .media-only-bubble {
  background: transparent;
  border-radius: 0;
}

.bubble p {
  font-size: 14px;
  line-height: 1.4;
  word-wrap: break-word;
}

.media-image,
.media-video {
  display: block;
  width: auto;
  max-width: min(100%, 520px);
  max-height: min(70vh, 640px);
  border-radius: $radius-md;
  object-fit: contain;
}

@media (max-width: 700px) {
  .media-image,
  .media-video {
    max-width: 100%;
    max-height: 62vh;
  }
}

.bubble audio {
  max-width: 260px;
}

.document-link,
.link-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: $accent;
  font-size: 12px;
  text-decoration: none;
}

.link-preview {
  padding: 8px;
  margin-bottom: 6px;
  border-left: 3px solid $accent;
  background: $bg-tertiary;
}

.link-preview span {
  color: $text-secondary;
}

.bubble .time {
  font-size: 10px;
  color: $text-secondary;
  float: right;
  margin-left: 12px;
  margin-top: 4px;
}

.media-only-bubble .time {
  display: block;
  float: none;
  margin: 4px 0 0;
  text-align: right;
}

.input-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid $border-color;
}

.input-area input {
  flex: 1;
  @include input-dark(10px 14px, 14px);
  border-radius: $radius-round;
}

.attach-button {
  position: relative;
  display: inline-flex;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  align-self: center;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 0;
  border: 1px solid $border-color;
  border-radius: $radius-full;
  color: $accent;
  font-size: 22px;
  cursor: pointer !important;
  transition: transform $transition-fast, background $transition-fast, box-shadow $transition-fast;
}

.attach-button:hover:not(.disabled) {
  background: rgba($accent, 0.12);
  box-shadow: 0 0 0 3px rgba($accent, 0.1), 0 0 14px rgba($accent, 0.25);
  transform: scale(1.06);
  cursor: pointer !important;
}

.attach-button:not(.disabled),
.attach-button:not(.disabled) * {
  cursor: pointer !important;
}

.attach-button span {
  position: relative;
  display: block;
  width: 14px;
  height: 14px;
  font-size: 0;
  pointer-events: none;
  cursor: inherit;
}

.attach-button span::before,
.attach-button span::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  cursor: inherit;
  transform: translate(-50%, -50%);
}

.attach-button span::after {
  transform: translate(-50%, -50%) rotate(90deg);
}

.attach-button input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.attach-button.disabled {
  opacity: 0.4;
  cursor: default;
}

.input-area button {
  padding: 10px 20px;
  border: none;
  border-radius: $radius-round;
  background: $accent;
  color: #111;
  font-weight: 600;
  cursor: pointer;
  transition: opacity $transition-normal;
}

.input-area button:disabled {
  opacity: 0.4;
  cursor: default;
}

.spinner {
  display: inline-block;
  @include spinner(14px, 2px, #111, transparent);
}

.send-error {
  margin: 0 16px 10px;
  color: $text-error;
  font-size: 12px;
}
</style>
