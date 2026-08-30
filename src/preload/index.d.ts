import type { CortexApi } from './index'

declare global {
  interface Window {
    api: CortexApi
  }
}

export {}
