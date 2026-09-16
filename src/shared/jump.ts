/**
 * Going to one message, rather than to the room it was said in.
 *
 * Mentions, search results and reply quotes all name a particular line, and
 * all three used to answer with the conversation scrolled to the bottom — the
 * right room, and then you go looking. For a mention from this morning that is
 * a scroll; for a search result from March it is hopeless, because the line is
 * not loaded at all and nothing on screen says so. A reply quote did say so,
 * in as many words — "Original message not loaded" — and offered nothing.
 *
 * The decision here is only the first one: can this be a scroll, or does
 * something have to be fetched first. Everything after it — where the messages
 * come from, how the room scrolls, how the line is marked once it arrives — is
 * the client's own business, and the two clients do it differently.
 */

/** A message as this decision needs to see it */
export interface Placed {
  id: string
  timestamp: string
}

/** Where a jump is aimed: an id when there is one, and always a time */
export interface Target {
  id?: string | null
  timestamp: string
}

export type Jump =
  /** It is already here with room above it — scroll and be done */
  | 'scroll'
  /** Fetch around it first */
  | 'load'

/**
 * Whether the loaded conversation can be scrolled to this line as it stands.
 *
 * Present is not enough: a message sitting at the very top of what is loaded
 * can be scrolled to and then shows nothing above itself, which is the half of
 * a conversation that explains it. So it also has to have [context] lines
 * before it — otherwise there is more to fetch, and fetching is what `AROUND`
 * is for.
 *
 * By id where there is one. A timestamp is a fallback rather than a key: two
 * messages in a busy channel share one to the millisecond often enough, and
 * server clocks are not ours.
 *
 * This answers one question once. A caller that has just fetched scrolls to
 * whatever it got, whether or not the answer here would still be `load` — the
 * alternative is a client that fetches for ever because a channel genuinely
 * has nothing older.
 */
export function jumpPlan(
  loaded: readonly Placed[],
  target: Target,
  context = 5
): Jump {
  const at = target.id
    ? loaded.findIndex((one) => one.id === target.id)
    : loaded.findIndex((one) => one.timestamp === target.timestamp)

  if (at === -1) return 'load'
  return at >= context ? 'scroll' : 'load'
}
