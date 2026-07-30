<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { formatRelativeTime, getName } from '@shared/utils'

const props = defineProps<{
  chats: any[]
  selectedId?: string
  platform: 'whatsapp' | 'instagram'
}>()

const emit = defineEmits<{ select: [chatId: string] }>()

const avatars = ref<Record<string, string>>({})
const searchQuery = ref('')

watch(() => props.chats, async (chats) => {
  for (const chat of chats || []) {
    if (chat.id && !avatars.value[chat.id]) {
      if (chat.avatarUrl) {
        avatars.value[chat.id] = chat.avatarUrl
      } else if (props.platform === 'whatsapp') {
        const url = await window.electronAPI.whatsapp.getProfilePicture(chat.id)
        if (url) avatars.value[chat.id] = url
      }
    }
  }
}, { immediate: true })

const filteredChats = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.chats
  return props.chats.filter(c => getName(c).toLowerCase().includes(q))
})
</script>

<template>
  <div class="chat-list">
    <div class="search">
      <input v-model="searchQuery" type="text" placeholder="Buscar conversa..." />
    </div>
    <div class="list">
      <div
        v-for="chat in filteredChats"
        :key="chat.id"
        :class="['chat-item', { selected: chat.id === selectedId }]"
        @click="emit('select', chat.id)"
      >
        <div class="avatar">
          <img v-if="avatars[chat.id]" :src="avatars[chat.id]" class="avatar-img" />
          <span v-else>{{ getName(chat).charAt(0).toUpperCase() }}</span>
        </div>
        <div class="info">
          <div class="name">{{ getName(chat) }}</div>
          <div class="last-msg">{{ chat.lastMessage?.message?.conversation || chat.lastMessage?.text || chat.lastMessage || '...' }}</div>
        </div>
        <div class="time">{{ formatRelativeTime(chat.lastMessage?.messageTimestamp || chat.lastTimestamp) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-list {
  width: $chatlist-width;
  border-right: 1px solid $border-color;
  @include flex-column;
  overflow: hidden;
  background: $bg-chatlist;
}

.search {
  padding: 12px;
  border-bottom: 1px solid $border-color;
}

.search input {
  width: 100%;
  @include input-dark;
}

.list {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-dark;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background $transition-fast;
}

.chat-item:hover { background: $bg-hover; }
.chat-item.selected { background: $bg-accent-10; }

.avatar {
  width: 42px;
  height: 42px;
  border-radius: $radius-full;
  background: $accent;
  color: #111;
  @include flex-center;
  font-weight: 700;
  font-size: 18px;
  flex-shrink: 0;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 14px;
  font-weight: 500;
  color: $text-primary;
}

.last-msg {
  font-size: 12px;
  color: $text-secondary;
  @include text-ellipsis;
  margin-top: 2px;
}

.time {
  font-size: 11px;
  color: $text-muted;
  flex-shrink: 0;
}
</style>
