/**
 * When the server disagrees with us about being in a channel.
 *
 * A channel is added to the list when the server echoes our `JOIN` and taken
 * out when it echoes our `PART`. That is right whenever the server answers at
 * all — and leaves a channel stuck forever when it answers with a refusal
 * instead.
 *
 * `PART #somewhere` answered with `403 No such channel` means we were not in
 * it, so the entry was stale; but nothing removed it, so it sat in the list
 * and every attempt to leave produced the same error. The only way out was to
 * delete the network.
 *
 * These two numerics settle it. Both say, in different words, that we are not
 * in the channel named — and between our list and the server, the server is
 * the one that knows.
 */

/** `403 ERR_NOSUCHCHANNEL` and `442 ERR_NOTONCHANNEL` */
export const NOT_ON_CHANNEL = ['403', '442'] as const

export function saysWeAreNotInIt(numeric: string): boolean {
  return (NOT_ON_CHANNEL as readonly string[]).includes(numeric)
}

/**
 * What to do with one of them.
 *
 * `leave` when we had the channel: our list was wrong and is now right, and
 * that is the outcome somebody asked for when they pressed leave — so it is
 * not worth a banner. `report` when we did not: the numeric is about
 * somewhere else, a mistyped `/topic` or a join that failed, and the person
 * needs to be told.
 *
 * Taking the channel from the numeric's own parameter rather than from what
 * the client last sent, because the two can differ — a server may fold the
 * case or a bouncer rewrite it, and the one that came back is the one the
 * server means.
 */
export function absenceAction(
  numeric: string,
  channel: string | undefined,
  weHaveIt: (channel: string) => boolean
): 'leave' | 'report' {
  if (!saysWeAreNotInIt(numeric)) return 'report'
  if (!channel || !weHaveIt(channel)) return 'report'
  return 'leave'
}
