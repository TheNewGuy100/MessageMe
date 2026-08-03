<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const api = window.electronAPI

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

async function clearDatabase() {
  const confirmed = window.confirm(
    'Isso apagará chats, mensagens, cache e envios pendentes do WhatsApp. Os tokens e a sessão não serão apagados. Continuar?'
  )
  if (!confirmed) return

  try {
    await api.whatsapp.clearDatabase()
  } catch (error: any) {
    window.alert(error?.message || 'Não foi possível limpar o banco de dados.')
  }
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
      <button class="database-btn" @click="clearDatabase">
        Limpar banco
      </button>
      <button class="clear-btn" @click="api.app.clearTokens()">
        Limpar tokens
      </button>
      <button class="refresh-btn" @click="api.app.reload()">
        Recarregar
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  width: $sidebar-width;
  background: $bg-secondary;
  border-right: 1px solid $border-color;
  @include flex-column;
  padding: 16px 0;
}

.logo {
  font-size: 24px;
  font-weight: 700;
  text-align: center;
  padding: 8px 16px 24px;
  color: $accent;
  letter-spacing: 2px;
}

nav {
  @include flex-column;
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
  border-radius: $radius-md;
  transition: all $transition-normal;
  font-family: inherit;
}

button:hover {
  background: $bg-hover;
  color: $text-primary;
}

button.active {
  background: $bg-accent-18;
  color: $accent;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: $radius-full;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
  margin-left: auto;
}

.icon { font-size: 16px; }
.label { font-weight: 500; }

.bottom {
  padding: 8px;
  border-top: 1px solid $border-color;
  margin-top: auto;
}

.clear-btn {
  width: 100%;
  justify-content: center;
  background: $danger;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 8px;
  border-radius: $radius-sm;
  margin-bottom: 6px;
}

.database-btn {
  width: 100%;
  justify-content: center;
  background: $bg-hover;
  color: $text-primary;
  font-weight: 700;
  font-size: 13px;
  padding: 8px;
  border-radius: $radius-sm;
  margin-bottom: 6px;
}

.database-btn:hover {
  background: $border-color;
  color: #fff;
}

.clear-btn:hover {
  background: $danger-hover;
  color: #fff;
}

.refresh-btn {
  width: 100%;
  justify-content: center;
  background: $action;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  padding: 8px;
  border-radius: $radius-sm;
}

.refresh-btn:hover {
  background: $action-hover;
  color: #fff;
}
</style>
