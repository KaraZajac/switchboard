import type { IRCMessage } from '@shared/types/irc'

/**
 * Handler function type.
 * Uses a generic 'client' type to avoid circular dependency with IRCClient.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerFn = (client: any, msg: IRCMessage) => void

/**
 * Command and numeric handlers, by name.
 *
 * A list per command, not one handler: several may claim the same one. JOIN is
 * interesting to the channel roster and to the metadata layer for different
 * reasons, and neither should have to know about the other. This held a single
 * handler and registered with `set`, so a second one silently replaced the
 * first — no error, no warning, and the feature that lost simply never worked.
 * Nothing had collided yet; the phone's registry has always been a list, and
 * the trap was waiting for whoever added the next handler to a busy command.
 */
const handlers = new Map<string, HandlerFn[]>()

export function registerHandler(command: string, handler: HandlerFn): void {
  const name = command.toUpperCase()
  const existing = handlers.get(name)
  if (existing) existing.push(handler)
  else handlers.set(name, [handler])
}

export function getHandler(command: string): HandlerFn | undefined {
  return handlers.get(command.toUpperCase())?.[0]
}

/** Commands anything is listening for — used by the parity test */
export function registeredCommands(): string[] {
  return [...handlers.keys()].sort()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchMessage(client: any, msg: IRCMessage): void {
  const registered = handlers.get(msg.command.toUpperCase())
  if (!registered) return

  for (const handler of registered) {
    try {
      handler(client, msg)
    } catch (err) {
      // One handler failing is not a reason to drop the connection or to skip
      // the others that care about this message. The phone does the same.
      client?.events?.emit?.('error', {
        code: 'HANDLER',
        command: msg.command,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
