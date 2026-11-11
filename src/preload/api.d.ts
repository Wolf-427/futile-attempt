import type { ScriptumApi } from '@shared/ipc'

declare global {
  interface Window {
    scriptum: ScriptumApi
  }
}

export {}
