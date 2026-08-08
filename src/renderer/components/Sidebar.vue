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
    <button class="collapse-btn" :title="compact ? 'Expandir menu' : 'Recolher menu'" :aria-label="compact ? 'Expandir menu' : 'Recolher menu'" @click="setCompact(!compact)">
      <span class="collapse-icon">{{ compact ? '›' : '‹' }}</span><span class="collapse-label">{{ compact ? 'Expandir' : 'Recolher' }}</span>
    </button>

    <nav>
      <button class="nav-item" title="Dashboard" @click="api.app.openDialog('dashboard')">
        <span class="icon">▦</span><span class="label">Dashboard</span>
      </button>
      <button class="nav-item" title="Automações" @click="api.app.openDialog('automation')">
        <span class="icon">✦</span><span class="label">Automações</span>
      </button>
      <button class="nav-item" title="Agendamentos" @click="api.app.openDialog('appointments')">
        <span class="icon">▤</span><span class="label">Agendamentos</span>
      </button>
      <button class="nav-item" title="Contatos" @click="api.app.openDialog('contacts')">
        <span class="icon">♙</span><span class="label">Contatos</span>
      </button>
    </nav>

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

.brand-row { display: flex; align-items: center; justify-content: center; min-height: 82px; box-sizing: border-box; }
.logo { color: $accent; font-size: 24px; font-weight: 800; text-align: center; letter-spacing: 2px; }
.collapse-btn { display: flex; align-items: center; justify-content: center; width: calc(100% + 16px); min-width: 0; height: 34px; margin: 0 -8px 14px; padding: 0 10px; border: 1px solid $border-input; border-right: 0; border-left: 0; border-radius: 0; background: $bg-primary; color: $text-secondary; font-size: 12px; line-height: 1; }
.collapse-btn:hover { border-color: $accent; background: $bg-accent-18; color: $accent; }
.collapse-icon { margin-right: 7px; font-size: 20px; transform: translateY(-1px); }

nav { @include flex-column; gap: 4px; flex: 1; margin-top: 16px; }
button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 10px; border: 0; background: transparent; color: $text-secondary; font: inherit; font-size: 13px; cursor: pointer; border-radius: $radius-md; transition: all $transition-fast; white-space: nowrap; }
button:hover { background: $bg-hover; color: $text-primary; }
.nav-item.active { background: $bg-accent-18; color: $accent; }
.icon { width: 22px; min-width: 22px; text-align: center; font-size: 18px; }
.label { overflow: hidden; text-overflow: ellipsis; }
.compact .label { display: none; }
.compact button { justify-content: center; padding-left: 8px; padding-right: 8px; }
.compact .collapse-label { display: none; }
.compact .collapse-icon { margin-right: 0; }
</style>
