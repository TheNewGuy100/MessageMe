<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{ connected: [] }>()
const qrDataUrl = ref<string | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  window.electronAPI.onEvent('whatsapp:qr', (qr: string) => {
    qrDataUrl.value = qr
    loading.value = false
    error.value = ''
  })

  window.electronAPI.onEvent('whatsapp:connected', () => {
    emit('connected')
  })

  window.electronAPI.onEvent('whatsapp:error', (msg: string) => {
    error.value = msg
    loading.value = false
  })

  const status = await window.electronAPI.whatsapp.getStatus()
  if (status === 'disconnected') {
    await window.electronAPI.whatsapp.connect()
  } else if (status === 'connected') {
    emit('connected')
  }
})

onUnmounted(() => {
  window.electronAPI.removeListener('whatsapp:qr')
  window.electronAPI.removeListener('whatsapp:connected')
  window.electronAPI.removeListener('whatsapp:error')
})

async function retry() {
  error.value = ''
  loading.value = true
  qrDataUrl.value = null
  await window.electronAPI.whatsapp.connect()
}
</script>

<template>
  <div class="qr-login">
    <div v-if="error" class="error-container">
      <p class="error-text">{{ error }}</p>
      <button @click="retry" class="retry-btn">Tentar novamente</button>
    </div>
    <div v-else-if="loading" class="loading">Conectando...</div>
    <div v-else-if="qrDataUrl" class="qr-container">
      <h2>Escaneie o QR Code</h2>
      <p>Abra o WhatsApp no celular e escaneie</p>
      <img :src="qrDataUrl" alt="QR Code" />
    </div>
    <div v-else class="loading">Aguardando QR Code...</div>
  </div>
</template>

<style scoped>
.qr-login {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.loading {
  color: #888;
  font-size: 16px;
}

.qr-container {
  text-align: center;
}

.qr-container h2 {
  margin-bottom: 8px;
  color: #e0e0e0;
}

.qr-container p {
  color: #888;
  margin-bottom: 24px;
  font-size: 14px;
}

.qr-container img {
  border-radius: 12px;
  background: white;
  padding: 16px;
  width: 280px;
  height: 280px;
}

.error-container {
  text-align: center;
}

.error-text {
  color: #ff5252;
  font-size: 14px;
  margin-bottom: 16px;
}

.retry-btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  background: #00e676;
  color: #111;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
}

.retry-btn:hover {
  background: #00c853;
}
</style>
