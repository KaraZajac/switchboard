import { app, net, powerMonitor, safeStorage } from 'electron'
import type { Host } from './index'
import { DESKTOP_PRIORITY } from '../session/coordinator'

/**
 * The machine, as Electron sees it.
 *
 * The only file in the engine that is allowed to import Electron. Installed by
 * `src/main/index.ts` before anything else runs; a headless entry point
 * installs a different one and never loads this.
 */
export const electronHost: Host = {
  dataDir: () => app.getPath('userData'),

  secrets: {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
    describe: () =>
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform
  },

  idleSeconds: () => powerMonitor.getSystemIdleTime(),

  // Electron's own fetch, which goes through the session and so honours the
  // proxy the app is configured with
  fetch: ((input, init) => net.fetch(input as string, init)) as typeof globalThis.fetch,

  sessionPriority: () => DESKTOP_PRIORITY
}
