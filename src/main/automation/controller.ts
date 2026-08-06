export type AutomationPlatform = 'instagram' | 'whatsapp'

export interface AutomationAdapter {
  readonly platform: AutomationPlatform
  run(): Promise<void>
}

export class AutomationController {
  private readonly adapters = new Map<AutomationPlatform, AutomationAdapter>()
  private running = false

  register(adapter: AutomationAdapter) {
    this.adapters.set(adapter.platform, adapter)
  }

  isRunning() {
    return this.running
  }

  async run() {
    if (this.running) return
    this.running = true
    try {
      for (const adapter of this.adapters.values()) await adapter.run()
    } finally {
      this.running = false
    }
  }
}
