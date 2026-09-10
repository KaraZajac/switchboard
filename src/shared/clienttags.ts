/**
 * Which client-only tags this network will actually carry.
 *
 * A client tag — `+typing`, `+draft/react`, `+reply` — is one the server is
 * meant to pass along without caring what it means. Servers are allowed to
 * refuse, and say which in ISUPPORT:
 *
 *     Libera    CLIENTTAGDENY=*,-typing
 *     FurNet    CLIENTTAGDENY=*,-draft/typing,-typing,-draft/channel-context,-draft/reply
 *
 * `*` denies everything, and a name after a `-` puts one back. Neither client
 * read the token, so on Libera a reaction went out, had its tag stripped in
 * passing, and arrived as a TAGMSG that meant nothing — no reaction, no error,
 * and a button that appeared to do its job.
 *
 * The other half is spelling. Two names exist for most of these while the
 * drafts settle, and a network may carry one and not the other: FurNet allows
 * `draft/reply` and denies `reply`, which is exactly the one we were sending.
 * So a caller asks for the names it knows and is told which to use.
 */

/** Whether the network will pass this client tag along, named without its `+` */
export function carriesTag(deny: string | true | null | undefined, tag: string): boolean {
  if (typeof deny !== 'string' || deny.length === 0) return true

  let allowed = true
  for (const entry of deny.split(',')) {
    const token = entry.trim()
    if (token.length === 0) continue

    if (token === '*') {
      allowed = false
    } else if (token.startsWith('-')) {
      if (token.slice(1).toLowerCase() === tag.toLowerCase()) allowed = true
    } else if (token.toLowerCase() === tag.toLowerCase()) {
      allowed = false
    }
  }
  return allowed
}

/**
 * The first of these names the network will carry, or null if it will carry none.
 *
 * Ask with the preferred spelling first. Null is the answer to "can I do this
 * here at all", which is a question worth being able to answer before offering
 * somebody a button.
 */
export function tagToUse(
  deny: string | true | null | undefined,
  names: readonly string[]
): string | null {
  for (const name of names) {
    if (carriesTag(deny, name)) return name
  }
  return null
}

/** The spellings we know for each thing that rides on a client tag */
export const TAG_NAMES = {
  typing: ['typing', 'draft/typing'],
  react: ['draft/react', 'react'],
  unreact: ['draft/unreact', 'unreact'],
  reply: ['reply', 'draft/reply'],
  channelContext: ['draft/channel-context', 'channel-context']
} as const
