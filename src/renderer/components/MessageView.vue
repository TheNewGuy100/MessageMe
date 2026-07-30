<script setup lang="ts">
import { ref } from 'vue'
import { formatTime, getText, isMine } from '@shared/utils'

const props = defineProps<{
  messages: any[]
  chatName: string
  loading?: boolean
  sending?: boolean
  error?: string
}>()

const emit = defineEmits<{ send: [text: string] }>()
const inputText = ref('')

function handleSend() {
  const text = inputText.value.trim()
  if (!text) return
  emit('send', text)
  inputText.value = ''
}
</script>

<template>
  <div class="message-view">
    <div class="header">
      <span class="name">{{ chatName }}</span>
    </div>

    <div class="messages">
      <div v-if="loading" class="conversation-loading">
        <span class="conversation-spinner"></span>
      </div>
      <div
        v-else
        v-for="msg in messages"
        :key="msg.id || msg.key?.id"
        :class="['message', { mine: isMine(msg) }]"
      >
        <div class="bubble">
          <p>{{ getText(msg) }}</p>
          <span class="time">{{ formatTime(msg.messageTimestamp || msg.timestamp) }}</span>
        </div>
      </div>
    </div>

    <div class="input-area">
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
}

.conversation-loading {
  flex: 1;
  @include flex-center;
}

.conversation-spinner {
  @include spinner;
}

.message { display: flex; }
.message.mine { justify-content: flex-end; }

.bubble {
  @include bubble-message;
}

.mine .bubble {
  background: $bg-accent-20;
  border-bottom-right-radius: 4px;
}

.bubble p {
  font-size: 14px;
  line-height: 1.4;
  word-wrap: break-word;
}

.bubble .time {
  font-size: 10px;
  color: $text-secondary;
  float: right;
  margin-left: 12px;
  margin-top: 4px;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid $border-color;
}

.input-area input {
  flex: 1;
  @include input-dark(10px 14px, 14px);
  border-radius: $radius-round;
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
