import { useEffect } from 'react'
import { useUIStore } from '../stores/uiStore'

/**
 * Telling somebody an update happened.
 *
 * The main process has always announced every step of an update — checking,
 * found, downloading, ready, failed — and nothing anywhere listened. Five
 * events sent into a window with no subscriber, which is a quieter kind of
 * broken than no updater at all: an update that could not install looked
 * exactly like no update, forever, with the app sure it was current.
 *
 * Only the two ends are worth interrupting for. Nobody needs to be told that
 * a check found nothing, or watch a percentage of something they did not ask
 * for; they need to know when there is a new version to restart into, and
 * when something went wrong.
 */
export function useUpdates(): void {
  const addToast = useUIStore((s) => s.addToast)

  useEffect(() => {
    const stops = [
      window.switchboard.on('updater:ready', ({ version, needsRoot }) => {
        addToast({
          title: `Switchboard ${version} is ready`,
          // Said plainly, because the next thing that happens is a password
          // prompt from the system, and a prompt nobody was expecting is the
          // thing that made this worth changing.
          body: needsRoot
            ? 'Installing it replaces the system package, so your password will be asked for.'
            : 'It will be installed the next time Switchboard is closed.',
          action: { kind: 'update', label: 'Restart and update' },
          // No eight-second life: this is about something still undone.
          sticky: true
        })
      }),

      window.switchboard.on('updater:error', ({ message }) => {
        addToast({
          title: 'The update could not be installed',
          body: 'Switchboard is still on the version you have. You can install the new one yourself from the releases page.',
          detail: message,
          sticky: true
        })
      })
    ]

    return () => stops.forEach((stop) => stop())
  }, [addToast])
}
