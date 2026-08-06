import { createApp } from 'vue'
import App from './App.vue'
import { initSmoothScroll } from './smooth-scroll'

const app = createApp(App)
app.mount('#app')
initSmoothScroll()
