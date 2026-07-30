import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@shared': shared
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use '@shared/styles' as *;\n`,
          api: 'modern-compiler'
        }
      }
    },
    plugins: [vue()]
  }
})
