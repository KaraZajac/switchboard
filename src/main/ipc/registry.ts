import { ipcMain, type IpcMainInvokeEvent } from 'electron'

/**
 * One registry for everything the UI can ask the core to do.
 *
 * The desktop window reaches these through Electron IPC. A paired device
 * reaches the same functions over the remote link, so both front-ends go
 * through one implementation rather than drifting apart — but only the
 * channels listed in REMOTE_ALLOWED, because a phone has no business
 * minimising your window or opening a file dialog on your desktop.
 */

type Handler = (event: IpcMainInvokeEvent | null, ...args: never[]) => unknown

const handlers = new Map<string, Handler>()

/** Register a handler for both the local window and paired devices. */
export function handle(channel: string, handler: Handler): void {
  handlers.set(channel, handler)
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
}

/**
 * Channels a paired device may call.
 *
 * Deliberately a list of what is allowed rather than what is blocked: a new
 * handler is unreachable from a phone until someone thinks about it.
 */
export const REMOTE_ALLOWED = new Set([
  // read the world
  'server:list',
  // the same snapshot the desktop window rebuilds itself from: connected
  // servers, their channels, members and our nick
  'app:renderer-ready',
  'history:fetch',
  'chathistory:request',
  'chathistory:catchup',
  'chathistory:targets',
  'message:search',
  'message:search-server',
  'read-marker:get',
  'read-marker:get-all',
  'monitor:list',
  'monitor:status',
  'metadata:get',
  'settings:get',
  'link-preview:fetch',
  // take part in it
  'channel:join',
  'channel:part',
  'channel:topic',
  'channel:list',
  'message:send',
  'message:reply',
  'message:react',
  'message:redact',
  'message:edit',
  'message:typing',
  'user:whois',
  'user:nick',
  'user:setname',
  'user:away',
  'metadata:set',
  'read-marker:set',
  'monitor:add',
  'monitor:remove',
  'user:kick',
  'user:mode',
  // Registering an account is a thing you do from whichever device is in your
  // hand, and the second half of it arrives by email — often on the phone.
  'account:register',
  'account:verify',
  // connection control for the networks, not for the desktop app
  'server:connect',
  'server:disconnect',
  // and the networks themselves: a phone that cannot add a server is not a
  // client, it is a viewer. Credentials are protected on the way in by
  // sanitizeIncomingFromRemote rather than by withholding the whole feature.
  'server:add',
  'server:update',
  'server:remove',
  'settings:set'
])

/**
 * Fields a paired device is never allowed to blank.
 *
 * `server:list` reaches a phone with every secret replaced by null, so a phone
 * that edits a server it read back and returns the whole object would clear the
 * passwords as a side effect of renaming the network. `updateServer` treats
 * undefined as "leave alone" and null as "set to null", and the phone cannot
 * tell those apart across JSON — so null means "leave alone" here.
 */
const REMOTE_PROTECTED_FIELDS = ['password', 'saslPassword', 'identifyCommand', 'clientCert']

/** Whether a paired device is allowed to call this channel at all. */
export function isRemoteAllowed(channel: string): boolean {
  return REMOTE_ALLOWED.has(channel)
}

/**
 * Strip anything a paired device should not learn.
 *
 * The point of proxying through the desktop is that the phone never holds the
 * IRC credentials — so they must not travel in a server list either, even to a
 * device that is paired.
 */
export function sanitizeForRemote(channel: string, value: unknown): unknown {
  if (channel !== 'server:list' || !Array.isArray(value)) return value

  return value.map((server) => {
    const config = server as Record<string, unknown>
    return {
      ...config,
      password: null,
      saslPassword: null,
      identifyCommand: null,
      // A certificate's private key is a credential like any other, and the
      // one that cannot be changed once it has been somewhere it should not be
      clientCert: null,
      // Enough for the UI to show "SASL is set up" without the secret itself
      hasPassword: Boolean(config.password),
      hasSaslPassword: Boolean(config.saslPassword),
      hasClientCert: Boolean(config.clientCert)
    }
  })
}

/**
 * Strip anything a paired device should not be able to overwrite.
 *
 * A device may still *set* a password — sending a string does that. What it
 * cannot do is erase one it was never shown.
 */
export function sanitizeIncomingFromRemote(channel: string, args: unknown[]): unknown[] {
  if (channel !== 'server:update' && channel !== 'server:add') return args

  return args.map((arg) => {
    if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return arg
    const config = { ...(arg as Record<string, unknown>) }
    // Only on update: a new server genuinely has no password to protect, and
    // dropping the key there would leave the column unbound.
    if (channel === 'server:update') {
      for (const field of REMOTE_PROTECTED_FIELDS) {
        if (config[field] === null) delete config[field]
      }
    }
    // Reading a server list hands these back too; they are not columns
    delete config.hasPassword
    delete config.hasSaslPassword
    delete config.hasClientCert
    return config
  })
}

/**
 * Invoke a handler on behalf of a paired device.
 *
 * There is no IpcMainInvokeEvent for a remote caller, so handlers that need
 * one (the window controls) are not on the allowlist and never get here.
 */
export async function invokeForRemote(channel: string, args: unknown[]): Promise<unknown> {
  if (!isRemoteAllowed(channel)) {
    throw new Error(`Channel not available to paired devices: ${channel}`)
  }
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const safeArgs = sanitizeIncomingFromRemote(channel, args)
  return sanitizeForRemote(channel, await handler(null, ...(safeArgs as never[])))
}

/** Registered channel names — used by tests to keep the allowlist honest. */
export function registeredChannels(): string[] {
  return [...handlers.keys()]
}
