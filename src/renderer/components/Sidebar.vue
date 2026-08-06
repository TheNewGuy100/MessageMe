<script setup lang="ts">
import { onMounted, ref } from 'vue'

const api = window.electronAPI
const compact = ref(localStorage.getItem('sidebar-compact') === 'true')

function setCompact(value: boolean) {
  compact.value = value
  localStorage.setItem('sidebar-compact', String(value))
  void api.app.setSidebarWidth(value ? 72 : 200)
}

onMounted(() => {
  void api.app.setSidebarWidth(compact.value ? 72 : 200)
})

</script>

<template>
  <aside class="sidebar" :class="{ compact }">
    <div class="brand-row">
      <div class="logo">MM</div>
    </div>
    <button class="collapse-btn menu-toggle" :title="compact ? 'Expandir menu' : 'Recolher menu'" @click="setCompact(!compact)">
      {{ compact ? '›' : '‹' }}
    </button>

    <nav>
      <button class="nav-item" title="Automações" @click="api.app.openDialog('automation')">
        <span class="icon">✦</span><span class="label">Automações</span>
      </button>
      <button class="nav-item" title="Agendamentos" @click="api.app.openDialog('appointments')">
        <span class="icon">▤</span><span class="label">Agendamentos</span>
      </button>
    </nav>

    <div class="bottom">
      <button class="refresh-btn" title="Recarregar apps oficiais" @click="api.app.reload()">
        <span class="icon">↻</span><span class="label">Recarregar</span>
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  width: 200px;
  flex: 0 0 200px;
  background: $bg-secondary;
  border-right: 1px solid $border-color;
  @include flex-column;
  padding: 12px 8px;
  transition: width $transition-normal, flex-basis $transition-normal;
  overflow: hidden;
}

.sidebar.compact {
  width: 72px;
  flex-basis: 72px;
  padding-left: 8px;
  padding-right: 8px;
}

.brand-row { display: flex; align-items: center; min-height: 52px; }
.logo { flex: 1; color: $accent; font-size: 22px; font-weight: 800; text-align: center; letter-spacing: 2px; }
.collapse-btn { width: 32px; min-width: 32px; justify-content: center; padding: 6px; color: $text-secondary; font-size: 22px; }
.menu-toggle { margin: 0 auto 12px; }

nav { @include flex-column; gap: 4px; flex: 1; margin-top: 16px; }
button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 10px; border: 0; background: transparent; color: $text-secondary; font: inherit; font-size: 13px; cursor: pointer; border-radius: $radius-md; transition: all $transition-fast; white-space: nowrap; }
button:hover { background: $bg-hover; color: $text-primary; }
.nav-item.active { background: $bg-accent-18; color: $accent; }
.icon { width: 22px; min-width: 22px; text-align: center; font-size: 18px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.compact .label { display: none; }
.compact button { justify-content: center; padding-left: 8px; padding-right: 8px; }
.bottom { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid $border-color; }
.refresh-btn { justify-content: center; color: #fff; font-weight: 700; }
.refresh-btn { background: $action; }
.refresh-btn:hover { background: $action-hover; color: #fff; }
</style>
