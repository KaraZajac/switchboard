import type { IpcMainInvokeEvent } from 'electron'
import { isSharedSetting } from '@shared/settings'

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

/**
 * Where a local window's calls arrive, when there is a local window.
 *
 * The registry's own map is what a paired device reaches, and it is enough on
 * its own — a headless Switchboard has no window, no `ipcMain` and no Electron
 * to take it from. So the desktop hands in its own way of listening at
 * startup, and everything here works the same with or without one.
 */
type LocalBridge = (channel: string, handler: Handler) => void

let bridge: LocalBridge | null = null

/**
 * Install the local front-end's transport.
 *
 * Handlers already registered are replayed, so this works whether it is
 * installed before or after `registerIPCHandlers`. Order being load-bearing is
 * the kind of thing that works until somebody moves a line.
 */
export function useLocalBridge(next: LocalBridge): void {
  bridge = next
  for (const [channel, handler] of handlers) next(channel, handler)
}

/** Register a handler for both the local window and paired devices. */
export function handle(channel: string, handler: Handler): void {
  handlers.set(channel, handler)
  bridge?.(channel, handler)
}

/**
 * Channels a paired device may call.
 *
 * Deliberately a list of what is allowed rather than what is blocked: a new
 * handler is unreachable from a phone until someone thinks about it.
 */
/**
 * Deliberately absent: `transcript:save`, and every `dcc:` handler.
 *
 * Each of those opens a native dialog on *this* machine and writes a file to
 * *this* disk. A phone calling one would pop a save dialog on somebody's
 * desktop and produce a file it can never reach. The phone has its own share
 * sheet and its own DCC; neither is this one.
 */
export const REMOTE_ALLOWED = new Set([
  // read the world
  'server:list',
  // the same snapshot the desktop window rebuilds itself from: connected
  // servers, their channels, members and our nick
  'app:renderer-ready',
  'history:fetch',
  // every line that named you, across every network — a phone following a
  // desktop or a headless instance is asking the thing with the deep history,
  // which is the whole reason it is worth asking rather than answering from
  // the rolling window a phone keeps
  'mentions:recent',
  // catching a returning device up on everything it missed
  'history:since',
  // what a phone heard while it was the connection — see `storage/handover.ts`
  'history:store',
  'chathistory:request',
  'chathistory:catchup',
  'chathistory:targets',
  'message:search',
  // the same question of every network at once — a phone following a desktop
  // is asking the device that has the whole history
  'search:everywhere',
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
  'metadata:reset',
  'read-marker:set',
  'monitor:add',
  'monitor:remove',
  'user:kick',
  'user:mode',
  'channel:modes',
  'channel:set-mode',
  'masklist:fetch',
  'masklist:set',
  'ignore:list',
  'ignore:add',
  'ignore:remove',
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
  'server:trust-certificate',
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

  /*
   * Settings are allowed by key, not wholesale.
   *
   * `settings:get` takes a name and returns whatever is under it, and one of
   * those names is `proxy` — which holds a username and a password for this
   * machine. A paired device could read it with a single call, and write it
   * too, which would route this desktop's connections through a host the phone
   * chose. Neither is what "the phone can pick a theme" was meant to allow.
   *
   * The list is the one that already answers this question: the settings that
   * belong to the person rather than to the machine they were typed on.
   */
  if (channel === 'settings:get' || channel === 'settings:set') {
    if (!isSharedSetting(args[0])) {
      throw new Error(`Setting not available to paired devices: ${String(args[0])}`)
    }
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
