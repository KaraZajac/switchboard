/**
 * Reading the tags a server puts on a message.
 *
 * Shared because the same tag is read twice: once as the message arrives, and
 * again when it comes back out of the database, where the whole tag record was
 * stored as it was received.
 */

/**
 * draft/oper-tag — whether the server says the sender is one of its operators.
 *
 * The value is the operator's name where the server gives one; a bare tag
 * still means yes, so it becomes an empty string. Null is reserved for "the
 * server did not say", which is also what a client that never asked for the
 * capability sees, and the two are the same thing to a reader.
 *
 * Only the server tag counts. `+draft/oper` is a client tag, which is to say
 * anyone can send one, and taking it for this would invert the entire point of
 * the capability.
 */
export function operFrom(tags: Record<string, string | true>): string | null {
  const tag = tags['draft/oper']
  if (tag === undefined) return null
  return typeof tag === 'string' ? tag : ''
}

/**
 * draft/relaymsg — whether this message came through a bridge.
 *
 * A relay bot with the right permission sends `RELAYMSG #channel <nick> :text`,
 * and the server delivers it as though the named nick had said it — which is
 * the point, because "bridgebot: <alice> hello" is not a conversation with
 * alice. The tag names the bot that carried it.
 *
 * Worth showing, quietly. A nick that is not in the member list and cannot be
 * messaged back is a strange thing to meet with no explanation, and the tag is
 * the only thing that distinguishes a bridged person from someone who left
 * between saying something and being looked up.
 *
 * Server tag only, like `draft/oper`: a client tag of the same name is
 * something anyone can send, and reading it here would let anyone claim to be
 * a bridge.
 */
export function relayedBy(tags: Record<string, string | true>): string | null {
  const tag = tags['draft/relaymsg']
  if (tag === undefined) return null
  return typeof tag === 'string' ? tag : ''
}
