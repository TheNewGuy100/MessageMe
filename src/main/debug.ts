import { BrowserWindow } from 'electron'

let enabled = false

type ToggleListener = (enabled: boolean) => void
const toggleListeners: ToggleListener[] = []

function timestamp() {
  return new Date().toLocaleTimeString('pt-BR')
}

function toWindows(event: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(event, ...args))
}

function notifyToggle() {
  toggleListeners.forEach(fn => fn(enabled))
}

export const debug = {
  get enabled() { return enabled },

  enable() {
    if (enabled) return
    enabled = true
    console.log('[DEBUG] modo debug ativado')
    toWindows('debug:log', '[DEBUG] modo debug ativado')
    notifyToggle()
  },

  disable() {
    if (!enabled) return
    console.log('[DEBUG] modo debug desativado')
    toWindows('debug:log', '[DEBUG] modo debug desativado')
    enabled = false
    notifyToggle()
  },

  send(type: 'log' | 'error', ...args: any[]) {
    if (!enabled) return
    const tag = `[${timestamp()}]`
    if (type === 'error') {
      console.error(tag, ...args)
      toWindows('debug:error', tag, ...args)
    } else {
      console.log(tag, ...args)
      toWindows('debug:log', tag, ...args)
    }
  },

  log(...args: any[]) { debug.send('log', ...args) },

  error(...args: any[]) { debug.send('error', ...args) },

  ipc(channel: string, direction: 'send' | 'result' | 'error', data?: any) {
    if (!enabled) return
    const prefix = direction === 'send' ? '>>' : direction === 'result' ? '<<' : '!!'
    const tag = `[${timestamp()}] [IPC] ${prefix} ${channel}`
    console.log(tag, data !== undefined ? data : '')
    toWindows('debug:ipc', { channel, direction, data, tag })
  },

  onToggle(fn: ToggleListener) {
    toggleListeners.push(fn)
  }
}

export function watchDevtools(window: BrowserWindow) {
  window.webContents.on('devtools-opened', () => debug.enable())
  window.webContents.on('devtools-closed', () => debug.disable())
  if (window.webContents.isDevToolsOpened()) debug.enable()
}
