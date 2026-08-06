<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

type FlowNodeData = { label: string; invalid?: boolean; selected?: boolean }
defineProps<{ type: string; data: FlowNodeData }>()
</script>

<template>
  <div class="semantic-flow-node" :class="[`semantic-${type}`, { 'semantic-invalid': data.invalid, 'semantic-selected': data.selected }]">
    <Handle v-if="type !== 'trigger'" type="target" :position="Position.Top" />
    <div class="semantic-flow-node-title">{{ data.label }}</div>
    <div class="semantic-flow-node-type">
      {{ type === 'trigger' ? 'Início' : type === 'condition' ? 'Decisão' : type === 'fallback' ? 'Fallback' : type === 'end' ? 'Fim' : 'Processo' }}
    </div>
    <Handle v-if="type !== 'end'" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.semantic-flow-node { position: relative; min-width: 150px; padding: 12px 16px; border: 2px solid #64748b; border-radius: 9px; background: #172033; color: #f8fafc; text-align: center; box-shadow: 0 5px 14px rgba(0, 0, 0, .25); }
.semantic-flow-node-title { font-size: 12px; font-weight: 700; }
.semantic-flow-node-type { margin-top: 4px; color: #94a3b8; font-size: 10px; }
.semantic-trigger { border-radius: 999px; border-color: #42a5f5; }
.semantic-message { border-color: #25d366; }
.semantic-condition { border-color: #ffca28; }
.semantic-fallback { border-color: #ab47bc; border-style: dashed; }
.semantic-end { border-radius: 999px; border-color: #ef5350; }
.semantic-invalid { border-color: #ef4444; box-shadow: 0 0 0 2px rgba(239, 68, 68, .3), 0 5px 14px rgba(0, 0, 0, .25); }
.semantic-selected { box-shadow: 0 0 0 3px rgba(96, 165, 250, .6), 0 5px 14px rgba(0, 0, 0, .25); }
</style>
