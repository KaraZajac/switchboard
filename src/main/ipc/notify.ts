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

/**
 * The watched-nicks list changed for one network.
 *
 * The window reads this once, when the connection comes up, and the server
 * only ever echoes who is *online* — never who is on the list. So a friend
 * added from the phone stayed invisible on the desktop, and their online
 * notices arrived for a nick the window did not think was being watched.
 */
export function monitorChanged(serverId: string): void {
  sink?.('monitor:changed', { serverId })
}

/**
 * A stored setting changed.
 *
 * The one that shows is the theme: both clients share it deliberately, and
 * picking one on the phone left the desktop on the old one until it restarted.
 */
export function settingChanged(key: string): void {
  sink?.('settings:changed', { key })
}

/**
 * A channel was read up to a point.
 *
 * Where the server has `draft/read-marker` it echoes MARKREAD and the window
 * hears about it that way. Where it does not, this is the only way the desktop
 * learns that the phone has read a conversation — otherwise it goes on showing
 * unread messages that were read an hour ago on the other device.
 */
export function readMarkerChanged(serverId: string, channel: string, timestamp: string): void {
  sink?.('irc:read-marker', { serverId, channel, timestamp })
}
