import { createRouter, createMemoryHistory } from 'vue-router'
import WhatsAppView from '@/views/WhatsAppView.vue'
import InstagramView from '@/views/InstagramView.vue'

const routes = [
  { path: '/', redirect: '/whatsapp' },
  { path: '/whatsapp', name: 'WhatsApp', component: WhatsAppView },
  { path: '/instagram', name: 'Instagram', component: InstagramView }
]

const router = createRouter({
  history: createMemoryHistory(),
  routes
})

export default router
