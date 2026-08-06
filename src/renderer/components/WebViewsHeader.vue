<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import instagramIcon from '@/assets/instagram.svg'
import whatsappIcon from '@/assets/whatsapp.svg'

const api = window.electronAPI
const MIN_ZOOM = 50
const MAX_ZOOM = 150
const ZOOM_STEP = 10
const storedZoom = Number(localStorage.getItem('official-views-zoom'))
const zoom = ref(Number.isFinite(storedZoom) ? storedZoom : 100)
const viewMode = ref<'instagram' | 'whatsapp' | 'both'>(
  (localStorage.getItem('official-views-mode') as 'instagram' | 'whatsapp' | 'both') || 'both'
)
const audioVolume = ref(100)
const previousVolume = ref(100)
const automationGlobalEnabled = ref(false)
const automationConfigured = ref(false)
const automationRunning = ref(false)

function setZoom(value: number) {
  zoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
  localStorage.setItem('official-views-zoom', String(zoom.value))
  void api.app.setZoom(zoom.value)
}

function setViewMode(mode: 'instagram' | 'whatsapp' | 'both') {
  viewMode.value = mode
  localStorage.setItem('official-views-mode', mode)
  void api.app.setViewMode(mode)
}

function setAudioVolume(value: number) {
  audioVolume.value = Math.max(0, Math.min(100, value))
  if (audioVolume.value > 0) previousVolume.value = audioVolume.value
  void api.app.setAudioVolume(audioVolume.value)
}

function toggleAudio() {
  setAudioVolume(audioVolume.value === 0 ? previousVolume.value || 100 : 0)
}

function toggleAutomation() {
  if (!automationConfigured.value) return
  automationGlobalEnabled.value = !automationGlobalEnabled.value
  void api.app.setGlobalAutomation(automationGlobalEnabled.value)
}

onMounted(() => {
  setZoom(zoom.value)
  setViewMode(viewMode.value)
  void api.app.getAudioVolume().then(volume => {
    audioVolume.value = volume
    if (volume > 0) previousVolume.value = volume
  })
  void api.app.getAutomationStatus().then(status => {
    automationGlobalEnabled.value = status.globalEnabled
    automationConfigured.value = status.configured
    automationRunning.value = status.running
  })
  api.onEvent('app:automation-status', (status: { enabled: boolean; configured: boolean; globalEnabled: boolean; running: boolean }) => {
    automationGlobalEnabled.value = status.globalEnabled
    automationConfigured.value = status.configured
    automationRunning.value = status.running
  })
})

onUnmounted(() => {
  api.removeListener('app:automation-status')
})
</script>

<template>
  <header class="webviews-header">
    <div class="header-title">
      <span class="eyebrow">APLICATIVOS OFICIAIS</span>
      <strong>Central de mensagens</strong>
    </div>

      <div class="header-controls" aria-label="Controles das aplicações">
      <button class="automation-toggle" :class="{ active: automationGlobalEnabled, running: automationRunning }" :disabled="!automationConfigured" :title="automationConfigured ? 'Ativar ou desativar automações' : 'Configure uma automação primeiro'" @click="toggleAutomation">
        <span class="switch-track"><span /></span>
        <i v-if="automationRunning" class="automation-spinner" aria-hidden="true" />
        <span>Automação</span>
      </button>
      <div class="view-selector" aria-label="Aplicativos visíveis">
        <button class="view-button" :class="{ active: viewMode === 'instagram' }" title="Mostrar somente Instagram" @click="setViewMode('instagram')"><img class="view-icon" :src="instagramIcon" alt="" />Instagram</button>
        <button class="view-button" :class="{ active: viewMode === 'whatsapp' }" title="Mostrar somente WhatsApp" @click="setViewMode('whatsapp')"><img class="view-icon" :src="whatsappIcon" alt="" />WhatsApp</button>
        <button class="view-button" :class="{ active: viewMode === 'both' }" title="Mostrar Instagram e WhatsApp" @click="setViewMode('both')"><span class="view-icon both-icon">◫</span>Ambos</button>
      </div>
      <div class="zoom-controls">
        <span class="control-label">Zoom</span>
        <button class="zoom-button" title="Diminuir zoom" :disabled="zoom <= MIN_ZOOM" @click="setZoom(zoom - ZOOM_STEP)">−</button>
        <button class="zoom-value" title="Restaurar zoom" @click="setZoom(100)">{{ zoom }}%</button>
        <button class="zoom-button" title="Aumentar zoom" :disabled="zoom >= MAX_ZOOM" @click="setZoom(zoom + ZOOM_STEP)">+</button>
      </div>
      <button class="logs-button" title="Abrir logs de automação" @click="api.app.openDialog('logs')">Logs</button>
      <div class="audio-controls" aria-label="Controle de áudio">
        <button class="audio-icon" :title="audioVolume === 0 ? 'Ativar áudio' : 'Silenciar áudio'" @click="toggleAudio">
          {{ audioVolume === 0 ? '🔇' : '🔊' }}
        </button>
        <input :value="audioVolume" type="range" min="0" max="100" step="1" :aria-label="`Volume ${audioVolume}%`" @input="setAudioVolume(Number(($event.target as HTMLInputElement).value))" />
      </div>
      <button class="reload-button" title="Recarregar aplicativos oficiais" @click="api.app.reload">↻</button>
    </div>
  </header>
</template>

<style scoped lang="scss">
.webviews-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
  background: $bg-secondary;
  border-bottom: 1px solid $border-color;
  -webkit-app-region: drag;
  user-select: none;
}

.header-title { display: grid; gap: 3px; }
.eyebrow { color: $accent; font-size: 9px; font-weight: 800; letter-spacing: 1.3px; }
.header-title strong { color: $text-primary; font-size: 13px; }
.header-controls { display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag; }
.automation-spinner { width: 11px; height: 11px; border: 2px solid rgba(255, 202, 40, .3); border-top-color: #ffca28; border-radius: 50%; animation: spin .8s linear infinite; }
.automation-toggle { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border-radius: $radius-sm; font-size: 10px; font-weight: 700; }
.automation-toggle.running { color: #ffca28; }
.automation-toggle:disabled { cursor: not-allowed; opacity: .45; }
.switch-track { position: relative; width: 24px; height: 14px; border-radius: 999px; background: $border-input; transition: background $transition-fast; }
.switch-track span { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: $text-secondary; transition: transform $transition-fast, background $transition-fast; }
.automation-toggle.active .switch-track { background: $accent; }
.automation-toggle.active .switch-track span { transform: translateX(10px); background: #07110b; }
.view-selector, .zoom-controls { display: flex; align-items: center; gap: 4px; }
.zoom-controls { margin-left: 10px; }
.control-label { margin-right: 5px; color: $text-muted; font-size: 11px; }
button { height: 28px; border: 1px solid $border-input; background: $bg-primary; color: $text-secondary; font: inherit; cursor: pointer; }
button:hover:not(:disabled) { background: $bg-hover; color: $text-primary; }
button:disabled { cursor: not-allowed; opacity: 0.35; }
.view-button { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: $radius-sm; font-size: 10px; font-weight: 700; }
.view-button.active { border-color: $accent; background: $bg-accent-18; color: $accent; }
.view-icon { width: 15px; height: 15px; flex: 0 0 15px; }
.both-icon { color: $text-secondary; }
.zoom-button { width: 28px; border-radius: $radius-sm; font-size: 17px; line-height: 1; }
.zoom-value { min-width: 52px; padding: 0 8px; border-radius: $radius-sm; color: $accent; font-size: 11px; }
.audio-controls { display: flex; align-items: center; gap: 4px; margin-left: 6px; }
.audio-icon { width: 28px; padding: 0; border-radius: $radius-sm; font-size: 14px; }
input[type='range'] { width: 74px; accent-color: $accent; cursor: pointer; }
.logs-button { min-width: 38px; margin-left: 6px; padding: 0 8px; border-radius: $radius-sm; font-size: 10px; font-weight: 700; }
.reload-button { width: 30px; margin-left: 8px; border: 0; border-radius: $radius-sm; background: $action; color: #fff; font-size: 18px; }
.reload-button:hover { background: $action-hover; color: #fff; }
</style>
