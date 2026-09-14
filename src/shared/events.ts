/**
 * What a channel event says, in words.
 *
 * Joins, parts, quits, renames, kicks and topic changes reach the
 * conversation as lines of their own. Both clients word them here, from one
 * corpus (`tests/fixtures/events.json`, Kotlin half in `Events.kt`), so what
 * the phone shows for a kick is what the desktop shows for the same kick —
 * and what the desktop's playback of last night's events says is what it
 * would have said live.
 *
 * Joins, parts and quits are the noisy three: in a busy channel they bury the
 * talk, which is why every client since mIRC has had a switch for them. Ours
 * is `showJoinsParts`, shared between devices and off by default — the member
 * list already says who is here. Renames, kicks and topic changes are always
 * shown: they are rarer, and they change what is going on.
 */

export type ChannelEventKind = 'join' | 'part' | 'quit' | 'nick' | 'kick' | 'topic'

export interface ChannelEvent {
  kind: ChannelEventKind
  /** Who did it — or, for a kick, who was kicked */
  nick: string
  /** The new nick, the kicker, or the new topic */
  detail?: string | null
  reason?: string | null
}

export function eventLine(event: ChannelEvent): string {
  const reason = event.reason ? ` (${event.reason})` : ''
  switch (event.kind) {
    case 'join':
      return `${event.nick} joined the channel`
    case 'part':
      return `${event.nick} left the channel${reason}`
    case 'quit':
      return `${event.nick} quit${reason}`
    case 'nick':
      return `${event.nick} is now known as ${event.detail ?? ''}`
    case 'kick':
      return `${event.nick} was kicked by ${event.detail || 'someone'}${reason}`
    case 'topic':
      return event.detail
        ? `${event.nick} changed the topic to: ${event.detail}`
        : `${event.nick} cleared the topic`
  }
}

/** The three the switch hides */
export function isJoinOrPart(kind: ChannelEventKind): boolean {
  return kind === 'join' || kind === 'part' || kind === 'quit'
}
