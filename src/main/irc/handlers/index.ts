// Re-export registry functions
export { registerHandler, getHandler, dispatchMessage } from './registry'
export type { HandlerFn } from './registry'

// Side-effect imports — register all handlers
// Phase 1: Core
import './registration'
import './channel'
import './message'
import './user'
import './error'
import '../capability'
import '../sasl'

// Phase 4: Presence & tracking
import '../features/account'
import '../features/away'
import '../features/chghost'
import '../features/setname'
import '../features/monitor'
import '../features/whox'

// Phase 5: Message features
import '../features/batch'
import '../features/labeled'
import '../features/readmarker'
import '../features/rename'
import '../features/redact'

/** No-op — handlers are registered via side-effect imports above */
export function registerAllHandlers(): void {
  // All handlers registered at import time
}
