/// <reference types="vite/client" />

import type { SwitchboardAPI } from '../preload/index'

declare global {
  interface Window {
    switchboard: SwitchboardAPI
  }
}
