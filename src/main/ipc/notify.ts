/**
 * Telling the window that something changed underneath it.
 *
 * The window keeps its own copy of the server list and updates it as it acts —
 * which is right until something else acts. A paired phone can add, edit and
 * remove servers, and adopting a shared vault rewrites the list wholesale;
 * neither goes through the window, so without this it goes on showing what was
 * true when it loaded. The phone's own settings promise that anything changed
 * there is changed on both, and it was only half true.
 *
 * A sink rather than a direct import, because the window belongs to the entry
 * point and importing it here would tie the IPC layer to it.
 */

type Sink = (channel: string, data: unknown) => void

let sink: Sink | null = null

/** Called once, by whoever owns the window */
export function setNotifier(next: Sink | null): void {
  sink = next
}

/**
 * The stored server list is no longer what the window last read.
 *
 * Deliberately carries nothing: the window re-reads rather than being handed a
 * diff, so there is one description of the servers and it is the stored one.
 */
export function serversChanged(): void {
  sink?.('servers:changed', undefined)
}
