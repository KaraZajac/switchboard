import { lineBudget, splitToFit } from './linelen'

/**
 * draft/multiline — one message that happens to have line breaks in it.
 *
 * Sending:
 *   BATCH +<ref> draft/multiline <target>
 *   @batch=<ref> PRIVMSG <target> :line 1
 *   @batch=<ref> PRIVMSG <target> :line 2
 *   BATCH -<ref>
 *
 * The capability value carries what the server will accept, and going over it
 * is not a truncated message — it is `FAIL BATCH MULTILINE_MAX_BYTES` and
 * nothing delivered at all. So the splitting is the client's job.
 *
 * Receiving is in batch.ts.
 */

/** What the server said it will take in one batch, from `draft/multiline=…` */
export interface MultilineLimits {
  maxBytes: number | null
  maxLines: number | null
}

/**
 * Read the limits out of the capability value.
 *
 * A key we cannot make a positive number of is not a limit of zero — it is a
 * value we do not understand, and the safe reading of that is "unlimited",
 * because the server will tell us if we are wrong and the alternative is
 * refusing to send anything at all.
 */
export function parseMultilineLimits(value: string | null | undefined): MultilineLimits {
  const limits: MultilineLimits = { maxBytes: null, maxLines: null }
  if (!value) return limits

  for (const token of value.split(',')) {
    const at = token.indexOf('=')
    if (at === -1) continue

    const key = token.slice(0, at).trim()
    const count = Number(token.slice(at + 1).trim())
    if (!Number.isInteger(count) || count <= 0) continue

    if (key === 'max-bytes') limits.maxBytes = count
    if (key === 'max-lines') limits.maxLines = count
  }

  return limits
}

/**
 * Group lines into batches none of which exceeds the limits.
 *
 * A single line longer than `max-bytes` goes on its own rather than being
 * dropped: splitting inside it would change what someone wrote, and the server
 * refusing one line is a better outcome than this client silently deciding
 * their message was too long to send.
 */
export function splitForLimits<T extends string | { text: string }>(
  lines: T[],
  limits: MultilineLimits
): T[][] {
  if (limits.maxBytes === null && limits.maxLines === null) return [lines]

  const batches: T[][] = []
  let current: T[] = []
  let bytes = 0

  for (const line of lines) {
    const size = Buffer.byteLength(typeof line === 'string' ? line : line.text, 'utf8')
    const overBytes = limits.maxBytes !== null && current.length > 0 && bytes + size > limits.maxBytes
    const overLines = limits.maxLines !== null && current.length >= limits.maxLines

    if (overBytes || overLines) {
      batches.push(current)
      current = []
      bytes = 0
    }

    current.push(line)
    bytes += size
  }

  if (current.length > 0) batches.push(current)
  return batches
}

let batchCounter = 0

/**
 * Send a message that has line breaks in it.
 *
 * Falls back to one PRIVMSG per line where the server has no multiline, which
 * is what every client did before the capability existed.
 */
export function sendMultilineMessage(
  client: {
    connection: { send: (...args: string[]) => void; sendRaw: (line: string) => void }
    state: {
      capabilities: Set<string>
      availableCapabilities: Map<string, string | null>
      nick: string
      userHost: string | null
      isupport: Record<string, string | true>
    }
  },
  target: string,
  lines: string[]
): void {
  // A line too long for the wire is refused outright — `417 :Input line was
  // too long`, nothing delivered — so every line is cut to fit before anything
  // else decides how to send it. `continued` marks the pieces that were one
  // line before we cut them.
  const budget = lineBudget(client.state, 'PRIVMSG', target)
  const parts: { text: string; continued: boolean }[] = []
  for (const line of lines) {
    splitToFit(line, budget).forEach((piece, at) => {
      parts.push({ text: piece, continued: at > 0 })
    })
  }

  if (parts.length <= 1 || !client.state.capabilities.has('draft/multiline')) {
    for (const part of parts) {
      client.connection.send('PRIVMSG', target, part.text)
    }
    return
  }

  const limits = parseMultilineLimits(client.state.availableCapabilities.get('draft/multiline'))

  for (const batch of splitForLimits(parts, limits)) {
    if (batch.length === 1) {
      // A batch of one is a message with no line breaks in it, and the spec
      // asks for a plain PRIVMSG rather than a batch wrapped around nothing.
      client.connection.send('PRIVMSG', target, batch[0].text)
      continue
    }

    const ref = `ml${++batchCounter}`
    client.connection.send('BATCH', `+${ref}`, 'draft/multiline', target)
    batch.forEach((part, at) => {
      // The tag says "this ran on from the one before with no line break",
      // which is exactly what a line we had to cut did. Never on the first
      // part of a batch: there is nothing before it to run on from.
      const concat = part.continued && at > 0 ? 'draft/multiline-concat;' : ''
      client.connection.sendRaw(`@${concat}batch=${ref} PRIVMSG ${target} :${part.text}`)
    })
    client.connection.send('BATCH', `-${ref}`)
  }
}
