<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

type Section = 'inbox' | 'requests' | 'hidden'
type Counts = { inbox: number; requests: number; hidden: number }

const api = window.electronAPI
const active = ref<Section>('inbox')
const counts = ref<Counts>({ inbox: 0, requests: 0, hidden: 0 })

function navigate(section: Section) {
  active.value = section
  void api.instagram.navigate(section)
}

onMounted(() => {
  void api.app.getInstagramCounts().then(next => {
    counts.value = next
  })
  api.onEvent('instagram:counts', (next: Counts) => {
    counts.value = next
  })
})

onUnmounted(() => {
  api.removeListener('instagram:counts')
})
</script>

<template>
  <header class="instagram-header">
    <button :class="{ active: active === 'inbox' }" @click="navigate('inbox')">
      <span>Conversas</span>
      <strong>{{ counts.inbox > 99 ? '99+' : counts.inbox }}</strong>
    </button>
    <button :class="{ active: active === 'requests' }" @click="navigate('requests')">
      <span>Solicitações</span>
      <strong>{{ counts.requests > 99 ? '99+' : counts.requests }}</strong>
    </button>
    <button :class="{ active: active === 'hidden' }" @click="navigate('hidden')">
      <span>Ocultas</span>
      <strong>{{ counts.hidden > 99 ? '99+' : counts.hidden }}</strong>
    </button>
  </header>
</template>

<style scoped lang="scss">
.instagram-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 14px;
  box-sizing: border-box;
  background: #111b21;
  border-bottom: 1px solid #2a3942;
}

button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #3b4a54;
  border-radius: 7px;
  padding: 7px 12px;
  background: #202c33;
  color: #d1d7db;
  cursor: pointer;
  font: 600 12px Arial, sans-serif;
}

button:hover,
button.active {
  border-color: #25d366;
  background: #183d2b;
  color: #e9edef;
}

strong {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  border-radius: 999px;
  padding: 0 4px;
  background: #e53935;
  color: #fff;
  font: 800 10px Arial, sans-serif;
}
</style>
