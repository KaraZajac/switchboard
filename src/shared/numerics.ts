/**
 * What to say when nothing was listening.
 *
 * Both clients hand a server's message to whoever registered for that command
 * and drop it where nobody did. For the replies that carry data that is
 * exactly right: a client that printed every unclaimed `RPL_` would fill the
 * server tab with the answers to questions it asked itself, and there are
 * hundreds of them.
 *
 * It is wrong for the refusals. A refusal is the server's answer to something
 * the user just did, and dropping it means they watch nothing happen and are
 * never told why — you message somebody who is blocking strangers and the
 * message simply vanishes; you join a channel that forwards elsewhere and end
 * up somewhere you did not ask for; the server password is wrong and the
 * connection closes with no reason given. Every one of those is a numeric no
 * client can be expected to have a handler for, and every one of them says in
 * plain English what went wrong.
 *
 * So: anything nothing claimed, in the block reserved for errors, is shown.
 */

/** A numeric nothing was listening for, and the text to show for it */
export interface Unclaimed {
  code: string
  message: string
}

/**
 * Numerics outside the error block that still report a message going nowhere.
 *
 * `716`–`718` belong with the four hundreds and are not among them because the
 * server that invented them had run out of room: they are what a network with
 * `CALLERID` says when somebody is refusing messages from strangers. Without
 * them a private message to a person in `+g` disappears with no sign it was
 * ever sent — which is the exact failure this module exists for.
 */
const ALSO = new Set(['716', '717', '718'])

/** Whether a numeric belongs to the block servers use for refusals */
function isRefusal(command: string): boolean {
  if (!/^\d{3}$/.test(command)) return false
  const number = Number(command)
  return (number >= 400 && number <= 599) || ALSO.has(command)
}

/**
 * The text of a numeric, put back together for a person to read.
 *
 * The parameters run `<us> [context...] :<description>` — our own nick first,
 * because a numeric is addressed to somebody, then whatever the refusal was
 * about, then the sentence. The nick is dropped: the user knows who they are.
 *
 * Joined with a colon or a space depending on how the description starts,
 * because the two families were written to read differently. `No such
 * channel` is a sentence of its own and wants `#chan: No such channel`; `is in
 * +g mode` was written to follow a nick and wants `bob is in +g mode`. A
 * lowercase first letter is what distinguishes them, and it is the server's
 * own choice rather than a guess about it.
 */
function readable(params: string[]): string | null {
  const description = params[params.length - 1]?.trim()
  if (!description) return null

  // A lone parameter is read as the sentence rather than as a nick, because
  // that is the form servers actually send: `464 :Password incorrect`, before
  // registration has given them a name to address it to. A numeric carrying a
  // nick and nothing else is not a message any server sends.
  const context = params.slice(1, -1).filter((part) => part.length > 0)
  if (context.length === 0) return description

  const joined = context.join(' ')
  const continues = /^[a-z]/.test(description)
  return continues ? `${joined} ${description}` : `${joined}: ${description}`
}

/**
 * What to report for a numeric no handler claimed, or null to stay quiet.
 */
export function unclaimedNumeric(command: string, params: string[]): Unclaimed | null {
  if (!isRefusal(command)) return null

  const message = readable(params)
  return message === null ? null : { code: command, message }
}
