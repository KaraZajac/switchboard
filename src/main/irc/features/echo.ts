/**
 * echo-message — delivery confirmation for our own messages.
 *
 * With the capability, the server echoes our PRIVMSG and NOTICE back and the
 * message handler shows them then, marked `isEcho`. Without it the server
 * says nothing, and until now neither did this client: a sent line reached
 * the network and never appeared in the sender's own window. The capability
 * is optional and plenty of networks lack it. The phone has always echoed
 * locally in that case; this is the desktop catching up.
 *
 * The local echo is the same event a server echo produces, so nothing
 * downstream needs to know which of the two it was.
 */

/** Check if echo-message is enabled for a connection. */
export function hasEchoMessage(capabilities: Set<string>): boolean {
  return capabilities.has('echo-message')
}

interface EchoClient {
  state: { capabilities: Set<string>; nick: string }
  events: { emit: (name: string, data: unknown) => void }
}

/**
 * Show what we just sent, where the server will not.
 *
 * Called once per message at every point a PRIVMSG or NOTICE leaves the
 * client — once, not once per line the message was cut into: what appears is
 * what was typed, which is what the phone shows too. Does nothing when the
 * server has promised an echo; showing it twice is the other bug.
 */
export function echoLocally(
  client: EchoClient,
  target: string,
  content: string,
  kind: 'privmsg' | 'action' | 'notice'
): void {
  if (hasEchoMessage(client.state.capabilities)) return

  const data = {
    // Filed under the conversation it was sent to, which is where the server
    // echo of the same line would land: the handler files a message under
    // its sender only when it was addressed to us, and this one was not.
    channel: target,
    nick: client.state.nick,
    content,
    type: kind,
    isPrivate: false,
    isEcho: true,
    msgid: undefined,
    time: new Date().toISOString(),
    account: undefined,
    replyTo: undefined,
    editOf: undefined,
    label: undefined,
    oper: null,
    relayedBy: null,
    userHost: null,
    tags: {}
  }
  client.events.emit(kind === 'notice' ? 'notice' : 'privmsg', data)
}
