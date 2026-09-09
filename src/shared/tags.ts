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
