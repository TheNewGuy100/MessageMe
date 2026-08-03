<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { formatRelativeTime, getName, getText } from '@shared/utils'

const props = defineProps<{
  chats: any[]
  selectedId?: string
  platform: 'whatsapp' | 'instagram'
  disabled?: boolean
  hasMore?: boolean
  loadingMore?: boolean
}>()

const emit = defineEmits<{ select: [chatId: string]; 'load-more': []; search: [query: string] }>()

const avatars = ref<Record<string, string>>({})
const searchQuery = ref('')
const avatarAttempts = new Set<string>()
const avatarElements = new Map<string, Element>()
const avatarObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = (entry.target as HTMLElement).dataset.chatId
          if (id) loadAvatar(id)
        }
      }
    }, { rootMargin: '120px' })
  : null

async function loadAvatar(id: string) {
  const chat = props.chats.find(item => item.id === id)
  if (!chat || avatars.value[id] || avatarAttempts.has(id)) return

  if (chat.avatarUrl) {
    avatars.value[id] = chat.avatarUrl
    return
  }

  if (props.platform === 'whatsapp') {
    avatarAttempts.add(id)
    const url = await window.electronAPI.whatsapp.getProfilePicture(id)
    if (url) avatars.value[id] = url
  }
}

function setChatItemRef(id: string, element: Element | null) {
  const previous = avatarElements.get(id)
  if (previous && avatarObserver) avatarObserver.unobserve(previous)
  if (!element) {
    avatarElements.delete(id)
    return
  }

  avatarElements.set(id, element)
  avatarObserver?.observe(element)
}

watch(() => props.chats, async (chats) => {
  for (const chat of chats || []) {
    if (chat.id && chat.avatarUrl && !avatars.value[chat.id]) {
      avatars.value[chat.id] = chat.avatarUrl
    }
  }
  await nextTick()
  for (const [id, element] of avatarElements) {
    avatarObserver?.observe(element)
    if (!props.chats.some(chat => chat.id === id)) avatarElements.delete(id)
  }
}, { immediate: true })

onUnmounted(() => avatarObserver?.disconnect())

const filteredChats = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.chats
  return props.chats.filter(c => getName(c).toLowerCase().includes(q))
})

function handleScroll(event: Event) {
  const element = event.currentTarget as HTMLElement
  if (props.hasMore && !props.loadingMore && element.scrollTop + element.clientHeight >= element.scrollHeight - 120) {
    emit('load-more')
  }
}
</script>

<template>
  <div :class="['chat-list', { disabled }]">
    <div class="search">
      <input v-model="searchQuery" type="text" placeholder="Buscar conversa..." @input="emit('search', searchQuery)" />
    </div>
    <div class="list" @scroll="handleScroll">
      <div
        v-for="chat in filteredChats"
        :key="chat.id"
        :ref="element => setChatItemRef(chat.id, element)"
        :data-chat-id="chat.id"
        :class="['chat-item', { selected: chat.id === selectedId, disabled }]"
        @click="!disabled && emit('select', chat.id)"
      >
        <div class="avatar">
          <img v-if="avatars[chat.id]" :src="avatars[chat.id]" class="avatar-img" />
          <span v-else>{{ getName(chat).charAt(0).toUpperCase() }}</span>
        </div>
        <div class="info">
          <div class="name">{{ getName(chat) }}</div>
          <div class="last-msg">{{ getText(chat.lastMessage) || '...' }}</div>
        </div>
        <div class="time">{{ formatRelativeTime(chat.lastMessage?.messageTimestamp || chat.lastTimestamp) }}</div>
      </div>
      <div v-if="loadingMore" class="list-loading-more">
        <span class="list-more-arc"></span>
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

.chat-list.disabled .search,
.chat-list.disabled .list {
  pointer-events: none;
  opacity: 0.65;
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

.list-loading-more {
  display: flex;
  position: sticky;
  bottom: 0;
  height: 4px;
  padding: 0;
  z-index: 2;
}

.list-more-arc {
  display: block;
  width: 100%;
  height: 4px;
  background: linear-gradient(90deg, rgba($accent, 0.28), rgba($accent, 0.72) 50%, rgba($accent, 0.28));
  box-shadow: 0 -3px 10px rgba($accent, 0.38), 0 0 16px rgba($accent, 0.16);
  animation: list-more-glow 1.6s ease-in-out infinite;
}

@keyframes list-more-glow {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
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
