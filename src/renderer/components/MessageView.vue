<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  messages: any[]
  chatName: string
}>()

const emit = defineEmits<{ send: [text: string] }>()
const inputText = ref('')

function formatTime(ts: number | undefined) {
  if (!ts) return ''
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getText(msg: any) {
  return msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.text
    || ''
}

function isMine(msg: any) {
  return msg.key?.fromMe || msg.isMine
}

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
      <div
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
      <button @click="handleSend" :disabled="!inputText.trim()">Enviar</button>
    </div>
  </div>
</template>

<style scoped>
.message-view {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a2a;
  font-weight: 600;
  font-size: 15px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.message {
  display: flex;
}

.message.mine {
  justify-content: flex-end;
}

.bubble {
  max-width: 70%;
  padding: 8px 14px;
  border-radius: 16px;
  background: #262626;
  position: relative;
}

.mine .bubble {
  background: #00e67620;
  border-bottom-right-radius: 4px;
}

.bubble p {
  font-size: 14px;
  line-height: 1.4;
  word-wrap: break-word;
}

.bubble .time {
  font-size: 10px;
  color: #888;
  float: right;
  margin-left: 12px;
  margin-top: 4px;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #2a2a2a;
}

.input-area input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #333;
  border-radius: 24px;
  background: #222;
  color: #e0e0e0;
  font-size: 14px;
  outline: none;
}

.input-area input:focus {
  border-color: #00e676;
}

.input-area button {
  padding: 10px 20px;
  border: none;
  border-radius: 24px;
  background: #00e676;
  color: #111;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.input-area button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
