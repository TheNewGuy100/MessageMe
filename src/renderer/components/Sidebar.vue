<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const waStatus = ref('disconnected')
const igStatus = ref('disconnected')

const links = [
  { path: '/whatsapp', label: 'WhatsApp', icon: '💬', status: waStatus },
  { path: '/instagram', label: 'Instagram', icon: '📷', status: igStatus }
]

function statusColor(s: string) {
  if (s === 'connected') return '#00e676'
  if (s === 'connecting') return '#ffd740'
  return '#ff5252'
}

onMounted(() => {
  window.electronAPI.onEvent('whatsapp:connecting', () => { waStatus.value = 'connecting' })
  window.electronAPI.onEvent('whatsapp:connected', () => { waStatus.value = 'connected' })
  window.electronAPI.onEvent('whatsapp:disconnected', () => { waStatus.value = 'disconnected' })
  window.electronAPI.onEvent('instagram:connected', () => { igStatus.value = 'connected' })
  window.electronAPI.onEvent('instagram:disconnected', () => { igStatus.value = 'disconnected' })

  window.electronAPI.whatsapp.getStatus().then(s => { waStatus.value = s })
  window.electronAPI.instagram.getStatus().then(s => { igStatus.value = s })
})

onUnmounted(() => {
  window.electronAPI.removeListener('whatsapp:connecting')
  window.electronAPI.removeListener('whatsapp:connected')
  window.electronAPI.removeListener('whatsapp:disconnected')
  window.electronAPI.removeListener('instagram:connected')
  window.electronAPI.removeListener('instagram:disconnected')
})
</script>

<template>
  <aside class="sidebar">
    <div class="logo">MM</div>
    <nav>
      <button
        v-for="link in links"
        :key="link.path"
        :class="{ active: route.path === link.path }"
        @click="router.push(link.path)"
      >
        <span class="icon">{{ link.icon }}</span>
        <span class="label">{{ link.label }}</span>
        <span class="dot" :style="{ background: statusColor(link.status.value) }" />
      </button>
    </nav>
    <div class="bottom">
      <button class="clear-btn" @click="window.electronAPI.app.clearTokens()">
        Limpar tokens
      </button>
      <button class="refresh-btn" @click="window.electronAPI.app.reload()">
        Recarregar
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  background: #1a1a1a;
  border-right: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
}

.logo {
  font-size: 24px;
  font-weight: 700;
  text-align: center;
  padding: 8px 16px 24px;
  color: #00e676;
  letter-spacing: 2px;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px;
  flex: 1;
}

button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;
  font-family: inherit;
}

button:hover {
  background: #2a2a2a;
  color: #e0e0e0;
}

button.active {
  background: #00e67618;
  color: #00e676;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
  margin-left: auto;
}

.icon {
  font-size: 16px;
}

.label {
  font-weight: 500;
}

.bottom {
  padding: 8px;
  border-top: 1px solid #2a2a2a;
  margin-top: auto;
}

.clear-btn {
  width: 100%;
  justify-content: center;
  background: #8f0000;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 8px;
  border-radius: 6px;
  margin-bottom: 6px;
}

.clear-btn:hover {
  background: #b50000;
  color: #fff;
}

.refresh-btn {
  width: 100%;
  justify-content: center;
  background: #008f4c;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 8px;
  border-radius: 6px;
}

.refresh-btn:hover {
  background: #00a85a;
  color: #fff;
}
</style>
