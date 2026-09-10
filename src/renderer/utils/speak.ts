import { useUIStore } from '../stores/uiStore'

/**
 * Say something, and notice when it did not go.
 *
 * `invoke` returns a promise and every send site ignored it, so a message typed
 * while the connection was down became an unhandled rejection: the composer
 * emptied, nothing appeared, and nothing anywhere said why. The main process
 * has always refused politely — "Not connected" — and nobody was listening.
 *
 * Losing what somebody typed is the worst thing a chat client can do quietly,
 * so this is the one place that must not be fire-and-forget.
 */
export function speak(attempt: Promise<unknown>, what = 'That was not sent'): void {
  attempt.catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err)
    useUIStore.getState().addToast({
      title: what,
      // Electron wraps a thrown Error with its own preamble; the sentence the
      // main process wrote is the part worth showing.
      body: reason.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
    })
  })
}
