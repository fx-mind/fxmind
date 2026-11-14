export type ColdCompactSettings = { enabled: boolean; minutes: number; tokens: number }
export type LastCompact = { at: number; tokensBefore: number; idleMinutes: number; ok: boolean; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'fxmind-cold-compact': {
      settings: Shaped<ColdCompactSettings>
      last: Shaped<LastCompact | null>
    }
  }
}
