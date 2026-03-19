/**
 * draft/multiline — Send and receive multiline messages.
 *
 * Sending:
 *   BATCH +<ref> draft/multiline <target>
 *   @batch=<ref> PRIVMSG <target> :line 1
 *   @batch=<ref> PRIVMSG <target> :line 2
 *   BATCH -<ref>
 *
 * Receiving:
 *   Multiline batches are handled in batch.ts — we just need to
 *   add the 'draft/multiline' batch type processing.
 */

let batchCounter = 0

/**
 * Send a multiline message using the draft/multiline batch mechanism.
 * Falls back to sending individual PRIVMSG lines if the server doesn't support it.
 */
export function sendMultilineMessage(
  client: {
    connection: { send: (...args: string[]) => void; sendRaw: (line: string) => void }
    state: { capabilities: Set<string> }
  },
  target: string,
  lines: string[]
): void {
  if (lines.length <= 1 || !client.state.capabilities.has('draft/multiline')) {
    // Single line or no multiline support — send normally
    for (const line of lines) {
      client.connection.send('PRIVMSG', target, line)
    }
    return
  }

  // Generate a unique batch reference
  const ref = `ml${++batchCounter}`

  // Open batch
  client.connection.send('BATCH', `+${ref}`, 'draft/multiline', target)

  // Send each line within the batch
  for (const line of lines) {
    client.connection.sendRaw(`@batch=${ref} PRIVMSG ${target} :${line}`)
  }

  // Close batch
  client.connection.send('BATCH', `-${ref}`)
}
