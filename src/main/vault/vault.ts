import { getSetting, setSetting } from '../storage/models/settings'
import { shouldAdoptVault } from '@shared/vaultorder'
import { serversChanged, settingChanged, monitorChanged } from '../ipc/notify'
import { getAllServers, removeServer, upsertServer } from '../storage/models/server'
import {
  addToMonitorList,
  clearMonitorList,
  getMonitorList
} from '../storage/models/monitor'
import type { ServerConfig } from '@shared/types/server'
import {
  deriveKey,
  deriveKeyFor,
  generateSalt,
  keyFingerprint,
  openVault,
  sealVault,
  VaultLockedError,
  type VaultEnvelope
} from './crypto'

/**
 * The shared vault: the config both devices work from.
 *
 * Server list, nicks, SASL credentials — everything a device needs to *be* the
 * connection — sealed with a passphrase the user types on each device. The
 * passphrase itself never travels; only the sealed envelope does, which is why
 * it is safe to hand to a phone over any link, or to keep in a backup.
 *
 * The desktop's local database stays the working copy. The vault is what syncs.
 */

const VAULT_KEY = 'vault'
const DEVICE_NAME_KEY = 'vaultDeviceName'

export interface VaultPayload {
  version: number
  servers: ServerConfig[]
  /**
   * Settings both devices should agree on.
   *
   * An allowlist rather than everything, because not every setting is about
   * the person: a proxy address and a CA path describe the machine they were
   * typed on, and copying those to a phone would be wrong rather than helpful.
   */
  settings?: Record<string, unknown>
  /** Watched nicks, per server. MONITOR is per connection, so each device has
   * to be told the list rather than being able to ask for it. */
  monitor?: Record<string, string[]>
}

/**
 * Settings that belong to the person rather than the machine.
 *
 * The theme is the obvious one — the two clients share it deliberately. Mutes
 * are the same kind of thing: a conversation you have silenced is silenced
 * because of what it is, not because of which device you silenced it on. And
 * the profile most of all: a display name and a set of pronouns are facts about
 * the person, not about the machine they were typed on or the network they
 * happened to be on at the time.
 *
 * This list is also what survives a reseal: `sharedSettings` rebuilds the
 * settings object from it, so a key the other device wrote and this one has
 * never heard of is dropped. The phone writes `profile`, so leaving it out
 * meant the profile someone set on their phone disappeared the next time the
 * desktop saved anything.
 */
export const SHARED_SETTINGS = ['theme', 'mutes', 'profile', 'ignores'] as const

export interface VaultStatus {
  /** A vault exists on this device */
  exists: boolean
  /** The passphrase has been entered this session */
  unlocked: boolean
  version: number
  updatedAt: string | null
  updatedBy: string | null
  /** Short hash of the key, for checking two devices share a passphrase */
  fingerprint: string | null
}

// The key lives only in memory: locking the app is a restart away, and a key on
// disk would defeat the point of asking for a passphrase.
let sessionKey: Buffer | null = null

/** Set by the remote link so a re-sealed vault is offered to paired devices */
let announce: ((version: number) => void) | null = null

export function onVaultChanged(listener: (version: number) => void): void {
  announce = listener
}

function readEnvelope(): VaultEnvelope | null {
  return getSetting<VaultEnvelope>(VAULT_KEY)
}

function writeEnvelope(envelope: VaultEnvelope): void {
  setSetting(VAULT_KEY, envelope)
}

function deviceName(): string {
  const existing = getSetting<string>(DEVICE_NAME_KEY)
  if (existing) return existing
  const name = `desktop-${Math.random().toString(36).slice(2, 8)}`
  setSetting(DEVICE_NAME_KEY, name)
  return name
}

export function vaultStatus(): VaultStatus {
  const envelope = readEnvelope()

  // Unlocked means there is a vault and it is open. A held key with no
  // envelope behind it is not a vault, and reporting it as one hides the
  // create form — leaving the user unable to make the thing the app is
  // telling them they need.
  const open = envelope !== null && sessionKey !== null

  return {
    exists: envelope !== null,
    unlocked: open,
    version: envelope?.version ?? 0,
    updatedAt: envelope?.updatedAt ?? null,
    updatedBy: envelope?.updatedBy ?? null,
    fingerprint: open && sessionKey ? keyFingerprint(sessionKey) : null
  }
}

/** Create the vault for the first time from whatever is configured locally. */
export function createVault(passphrase: string): VaultStatus {
  if (readEnvelope()) throw new Error('A vault already exists on this device')

  const salt = generateSalt()
  sessionKey = deriveKey(passphrase, salt)
  const envelope = seal(sessionKey, salt, 1)
  writeEnvelope(envelope)
  announce?.(envelope.version)
  return vaultStatus()
}

/** Open the existing vault and adopt its contents locally. */
export function unlockVault(passphrase: string): VaultStatus {
  const envelope = readEnvelope()
  if (!envelope) throw new Error('There is no vault on this device yet')

  const key = deriveKeyFor(envelope, passphrase)
  const payload = openVault<VaultPayload>(envelope, key) // throws if wrong
  sessionKey = key

  applyPayload(payload)
  return vaultStatus()
}

export function lockVault(): VaultStatus {
  sessionKey = null
  return vaultStatus()
}

/**
 * Re-seal the vault from the current config, bumping its version.
 *
 * Called after anything that changes what a device would need in order to take
 * over the connection. A locked vault is left alone rather than silently
 * dropping the change — the caller can see it in the status.
 */
export function resealVault(): VaultStatus {
  const envelope = readEnvelope()
  if (!envelope || !sessionKey) return vaultStatus()

  const next = seal(sessionKey, Buffer.from(envelope.kdf.salt, 'base64'), envelope.version + 1)
  writeEnvelope(next)
  announce?.(next.version)
  return vaultStatus()
}

/** The sealed envelope, for handing to another device. */
export function exportVault(): VaultEnvelope | null {
  return readEnvelope()
}

/**
 * Take a vault offered by another device.
 *
 * Older versions are ignored, so a device that has been offline for a while
 * cannot roll everyone else back. An equal version is also ignored: the two
 * are already in step.
 */
export function importVault(envelope: VaultEnvelope): {
  accepted: boolean
  reason: string
  status: VaultStatus
} {
  const current = readEnvelope()

  if (!shouldAdoptVault(envelope, current)) {
    return {
      accepted: false,
      reason: `Ignored vault v${envelope.version}; this device has v${current?.version}`,
      status: vaultStatus()
    }
  }

  // Without the key we cannot verify it opens, but we can still store it: the
  // user may unlock later, and refusing would leave the devices out of step.
  if (sessionKey) {
    try {
      const payload = openVault<VaultPayload>(envelope, sessionKey)
      writeEnvelope(envelope)
      applyPayload(payload)
      return { accepted: true, reason: `Adopted vault v${envelope.version}`, status: vaultStatus() }
    } catch (err) {
      if (err instanceof VaultLockedError) {
        return {
          accepted: false,
          reason: 'That device is using a different passphrase',
          status: vaultStatus()
        }
      }
      throw err
    }
  }

  writeEnvelope(envelope)
  return {
    accepted: true,
    reason: `Stored vault v${envelope.version}; unlock to apply it`,
    status: vaultStatus()
  }
}

// ── internals ────────────────────────────────────────────────────────

function seal(key: Buffer, salt: Buffer, version: number): VaultEnvelope {
  const payload: VaultPayload = {
    version,
    servers: getAllServers(),
    settings: sharedSettings(),
    monitor: watchedNicks()
  }
  return sealVault(payload, key, salt, {
    version,
    updatedAt: new Date().toISOString(),
    updatedBy: deviceName()
  })
}

/**
 * Make the local config match the vault.
 *
 * Servers are matched on id, so a device that has been offline picks up edits
 * rather than ending up with duplicates, and a server deleted elsewhere goes
 * away here too.
 */
/** The shared settings as they stand, for sealing into the vault */
function sharedSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of SHARED_SETTINGS) {
    const value = getSetting(key)
    if (value !== null && value !== undefined) out[key] = value
  }
  return out
}

/** The watched nicks of every server, for sealing into the vault */
function watchedNicks(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const server of getAllServers()) {
    const nicks = getMonitorList(server.id)
    if (nicks.length > 0) out[server.id] = nicks
  }
  return out
}

function applyPayload(payload: VaultPayload): void {
  const local = new Map(getAllServers().map((server) => [server.id, server]))

  for (const server of payload.servers) {
    upsertServer(server)
    local.delete(server.id)
  }

  for (const id of local.keys()) {
    removeServer(id)
  }

  // Written through the models rather than the IPC handlers on purpose: those
  // reseal, and a device applying what it was just handed would seal a new
  // version and offer it back, and the two would pass versions between them
  // for as long as both were running.
  for (const key of SHARED_SETTINGS) {
    const value = payload.settings?.[key]
    if (value === undefined) continue
    setSetting(key, value)
    settingChanged(key)
  }

  if (payload.monitor) {
    for (const [serverId, nicks] of Object.entries(payload.monitor)) {
      clearMonitorList(serverId)
      if (nicks.length > 0) addToMonitorList(serverId, nicks)
      monitorChanged(serverId)
    }
  }

  // The whole list has just been replaced by another device's. The window is
  // still showing the one it read at startup.
  serversChanged()
}
