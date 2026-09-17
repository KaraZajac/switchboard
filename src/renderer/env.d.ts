/// <reference types="vite/client" />

import type { SwitchboardAPI } from '../preload/index'

declare global {
  interface Window {
    switchboard: SwitchboardAPI
  }

  /**
   * What the About page says about this build — see `electron.vite.config.ts`.
   *
   * Inside `declare global` rather than beside it: this file imports, which
   * makes it a module, and a bare `declare const` in a module is visible only
   * to the module.
   *
   * Put in by the bundler rather than read at run time — `app.getVersion()` is
   * a main-process call that answers with Electron's own version from an
   * unpackaged build, and the licence is a file that is not shipped beside the
   * renderer.
   */
  const __APP_VERSION__: string
  /** When this bundle was built, ISO 8601 */
  const __BUILD_DATE__: string
  /** The full text of `LICENSE`, so the About page cannot drift from it */
  const __LICENSE__: string
}
