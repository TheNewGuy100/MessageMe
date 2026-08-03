<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Sidebar from '@/components/Sidebar.vue'

onMounted(() => {
  const api = window.electronAPI

  api.onEvent('debug:log', (...args: any[]) => {
    console.log('%c[DEBUG]', 'color:#00e676;font-weight:bold', ...args)
  })

  api.onEvent('debug:error', (...args: any[]) => {
    console.error('%c[DEBUG]', 'color:#ff5252;font-weight:bold', ...args)
  })

  api.onEvent('debug:network-error', (...args: any[]) => {
    console.error('%c[NETWORK]', 'color:#ff9800;font-weight:bold', ...args)
  })

  api.onEvent('debug:render-error', (...args: any[]) => {
    console.error('%c[RENDER]', 'color:#e040fb;font-weight:bold', ...args)
  })

  api.onEvent('debug:ipc', (data: { channel: string; direction: string; data?: any; tag: string }) => {
    const colors: Record<string, string> = { send: '#64b5f6', result: '#81c784', error: '#ff5252' }
    console.log(`%c${data.tag}`, `color:${colors[data.direction] || '#888'};font-weight:bold`, data.data ?? '')
  })
})

onUnmounted(() => {
  const api = window.electronAPI
  api.removeListener('debug:log')
  api.removeListener('debug:error')
  api.removeListener('debug:network-error')
  api.removeListener('debug:render-error')
  api.removeListener('debug:ipc')
})
</script>

<template>
  <div class="app">
    <Sidebar />
    <main class="main-content">
      <router-view v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </router-view>
    </main>
  </div>
</template>

<style lang="scss">
@use '@shared/styles/base';

.app {
  display: flex;
  height: 100vh;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
