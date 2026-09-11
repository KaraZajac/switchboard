/**
 * What a conversation and a network look like when something has happened.
 *
 * Three states and nothing else, because a sidebar is read at a glance and a
 * glance holds three things:
 *
 *   quiet     grey, nothing waiting
 *   unread    white, something was said
 *   mention   a number, somebody said your name
 *
 * The two clients had drifted into different answers. The phone put a grey
 * count on every unread channel, so "something was said" and "you were named"
 * were both numbers and you had to read them to tell which. It also counted
 * direct messages toward the network badge, which double-counts them now that
 * people have their own button — and it ignored muting entirely, so a network
 * you had silenced still lit its own rail.
 *
 * Muting is the interesting case. A muted conversation still *counts* its
 * mentions — somebody saying your name is worth knowing about even somewhere
 * you have turned down — it just does not shout: the badge goes grey rather
 * than red, and the network it lives on does not light up for it. Hiding the
 * count entirely would make muting mean "and never tell me", which is a
 * different thing from what people press it for.
 */

import { isChannelName } from './constants'

export interface ConversationState {
  name: string
  unread: number
  mentions: number
  muted: boolean
}

/** Grey, white, or the one you are looking at */
export type RowLook = 'selected' | 'unread' | 'quiet'

export function rowLook(
  conversation: { unread: number; muted: boolean },
  selected: boolean
): RowLook {
  if (selected) return 'selected'
  // A muted conversation stays grey however much was said in it
  if (conversation.unread > 0 && !conversation.muted) return 'unread'
  return 'quiet'
}

/** The number on a row, or null where there is nothing to count */
export function rowBadge(
  conversation: { mentions: number; muted: boolean }
): { count: number; muted: boolean } | null {
  if (conversation.mentions <= 0) return null
  return { count: conversation.mentions, muted: conversation.muted }
}

export interface RailLook {
  /**
   * The pill on the left edge: tall for the network you are looking at, short
   * for one with something unread, and absent otherwise. It is the whole
   * information design of a rail — it reads without being looked at.
   */
  chip: 'tall' | 'short' | 'none'
  /** The red badge on the icon, 0 for none */
  mentions: number
  /** Whether that badge should be grey rather than red */
  mentionsMuted: boolean
}

/**
 * @param conversations everything on this network — channels and people alike;
 *   people are filtered out here so that neither client can forget to. Their
 *   unread belongs to the Messages button, and counting it twice makes a
 *   network look busy because somebody sent you one line.
 */
export function railLook(
  conversations: readonly ConversationState[],
  options: { active: boolean; serverMuted: boolean }
): RailLook {
  const channels = conversations.filter((c) => isChannelName(c.name))
  const audible = channels.filter((c) => !c.muted)

  const mentions = channels.reduce((sum, c) => sum + Math.max(0, c.mentions), 0)
  const hasUnread = !options.serverMuted && audible.some((c) => c.unread > 0)

  return {
    chip: options.active ? 'tall' : hasUnread ? 'short' : 'none',
    mentions,
    // Grey when the network itself is silenced, or when every mention in it is
    // somewhere silenced — there is nothing here to shout about. False with no
    // mentions at all, so the flag never describes a badge that is not there.
    mentionsMuted:
      mentions > 0 &&
      (options.serverMuted || !channels.some((c) => c.mentions > 0 && !c.muted))
  }
}
