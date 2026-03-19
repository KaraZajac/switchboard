import type { IRCMessage } from '@shared/types/irc'

/**
 * Handler function type.
 * Uses a generic 'client' type to avoid circular dependency with IRCClient.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerFn = (client: any, msg: IRCMessage) => void

/**
 * Handler registry — maps commands/numerics to handler functions.
 */
const handlers = new Map<string, HandlerFn>()

export function registerHandler(command: string, handler: HandlerFn): void {
  handlers.set(command.toUpperCase(), handler)
}

export function getHandler(command: string): HandlerFn | undefined {
  return handlers.get(command.toUpperCase())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchMessage(client: any, msg: IRCMessage): void {
  const handler = getHandler(msg.command)
  if (handler) {
    handler(client, msg)
  }
}
