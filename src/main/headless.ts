import { setHost } from './host'
import { headlessHost, headlessDataDir } from './host/headless'

/*
 * Switchboard with nobody watching.
 *
 * The host goes in before anything else is imported, because the modules
 * below reach for a data directory on the way in. Same reason the Electron
 * entry does it at the top of its own file.
 */
const dataDir = process.env['SWITCHBOARD_DATA'] ?? headlessDataDir()
setHost(headlessHost(dataDir))

import { createInterface } from 'readline'
import { ircManager } from './irc/manager'
import { initDatabase, closeDatabase } from './storage/database'
import { restoreVault, unlockVault, createVault, vaultStatus, onVaultChanged } from './vault/vault'
import { loadSTSPolicies, persistSTSPoliciesWith } from './irc/features/sts'
import { allSTSPolicies, saveSTSPolicy, forgetSTSPolicy } from './storage/models/sts'
import {
  resumeRemoteLink,
  startRemoteLink,
  startPairing,
  stopRemoteLink,
  remoteStatus,
  sessionState,
  dialPeer,
  forgetDialledPeer
} from './remote/link'
import { registerIPCHandlers } from './ipc/index'
import { encryptStoredCredentials, getAllServers } from './storage/models/server'
import { getSetting } from './storage/models/settings'
import { useNetworkSettings } from './irc/connection'
import { setAppVersion } from './irc/handlers/message'
import { secretsBackendDescription } from './storage/secrets'
import { getPairedDevices } from './storage/models/device'
import { startBouncer, stopBouncer, bouncerStatus, attachedClients } from './bouncer/index'
import { watchWhoIsReading, stopWatchingWhoIsReading } from './bouncer/presence'
import { createNetwork, deleteNetwork } from './bouncer/networks'
import type { ProxySettings } from '@shared/socks'

const VERSION = process.env['SWITCHBOARD_VERSION'] ?? 'headless'

/**
 * Put the time on every line.
 *
 * A desktop's console is read while you are looking at it, so "now" is
 * obvious. A server's is read afterwards, often days later and often next to
 * another machine's, and a line with no time on it cannot be put in order with
 * anything. `journalctl` adds its own, but this also runs in a terminal, in a
 * container, and piped to a file, and none of those do.
 *
 * Skipped for the indented lines the console commands print, which are a reply
 * to something somebody just typed rather than a record of anything.
 */
function timestampOutput(): void {
  for (const level of ['info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      const first = args[0]
      if (typeof first === 'string' && (first.startsWith('  ') || first === '')) {
        original(...args)
        return
      }
      original(`${new Date().toISOString()}`, ...args)
    }
  }
}

/**
 * Where the passphrase comes from when there is nobody to type it.
 *
 * The desktop keeps the vault key in the OS keychain so a restart does not
 * lock you out, and the headless host has a key file standing in for that —
 * so in the ordinary case this is never needed and the vault simply opens.
 *
 * It matters on two days: the first one, before a vault exists, and any day
 * the key file is gone. Both want an answer that does not involve somebody
 * being at the machine, which is what the environment variable is for. A file
 * is offered as well because an environment variable is visible in `ps` to
 * every account on the box.
 */
function suppliedPassphrase(): string | null {
  const direct = process.env['SWITCHBOARD_PASSPHRASE']
  if (direct) return direct

  const file = process.env['SWITCHBOARD_PASSPHRASE_FILE']
  if (file) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as typeof import('fs')
    return readFileSync(file, 'utf8').trim()
  }

  return null
}

/**
 * Open the shared config, whichever way is available.
 *
 * Deliberately never *creates* one. A vault's key comes from the passphrase
 * and a salt made when the vault was made, so two vaults created separately
 * under the same passphrase cannot open each other — and the overwhelmingly
 * common way to arrive here is with a desktop that already has one. A headless
 * instance that made its own on first run would collide with it every time,
 * and the collision is not recoverable from either end without throwing one
 * away.
 *
 * So this opens what is here, and otherwise waits: the first peer to connect
 * offers its vault, this adopts it, and `tryPassphrase` opens it with what the
 * environment supplied. `vault create` at the console is the deliberate way to
 * make the first one.
 */
function openVault(): void {
  const before = vaultStatus()

  if (!before.exists) {
    console.info(
      'No shared config yet. Pair a device and this will adopt its one, or run ' +
        '`vault create` to start a new one.'
    )
    return
  }

  // The usual path: the key file remembered it, exactly as a keychain would.
  if (restoreVault().unlocked) {
    console.info('Shared config open.')
    return
  }

  if (!tryPassphrase()) {
    console.warn(
      'Shared config is locked and no passphrase opened it. Set SWITCHBOARD_PASSPHRASE or ' +
        'SWITCHBOARD_PASSPHRASE_FILE. Networks and settings will not reach paired devices ' +
        'until it is open.'
    )
  }
}

/** Try what the environment supplied against whatever vault is here now */
function tryPassphrase(): boolean {
  const passphrase = suppliedPassphrase()
  if (!passphrase) return false

  const status = unlockVault(passphrase)
  if (status.unlocked) console.info('Shared config unlocked.')
  return status.unlocked
}

/**
 * A peer sent us a config we did not have.
 *
 * Adopting it leaves it sealed, and a sealed config reaches nothing — the
 * networks in it are not dialled and nothing is passed on. There is nobody
 * here to type a passphrase, so the one the environment supplied is tried
 * against every vault that arrives. It is the same passphrase the user set on
 * their desktop; that is the whole point of it being shared.
 */
function unlockWhateverArrives(): void {
  onVaultChanged(() => {
    if (vaultStatus().unlocked) return
    if (tryPassphrase()) {
      /*
       * Dial whatever came with it.
       *
       * Not `autoConnectAll`, which runs at most once per launch and by this
       * point already has — with nothing to dial, because the config had not
       * arrived yet. `resumeConnections` asks the question that is actually
       * being asked: what should this instance be on right now. It skips
       * anything already up, so it is safe to call whenever a config lands.
       */
      ircManager.resumeConnections()
    }
  })
}

/**
 * What a new device needs to find this instance.
 *
 * A desktop shows a QR code. Here it is two lines on a console, which is what
 * somebody who just ran this over SSH can actually use.
 */
async function announcePairing(): Promise<void> {
  const status = await startPairing()
  if (status.error) {
    console.error(`Could not open pairing: ${status.error}`)
    return
  }

  console.info('')
  console.info('  Pair a device with these two:')
  console.info('')
  console.info(`  Ticket:  ${status.ticket ?? '(none)'}`)
  console.info(`  Code:    ${status.pairing?.code ?? '(none)'}`)
  console.info('')
  console.info('  The code expires; run `pair` again for a fresh one.')
  console.info('')
}

/**
 * Open the IRC port, unless somebody said not to.
 *
 * On loopback by default, which is the case that needs no decision: the
 * operating system already decides who may connect, and the way people reach a
 * headless bouncer is `ssh -L 6667:localhost:6667`. Anything else has to be
 * asked for, and asking for it requires a password — see `startBouncer`.
 *
 * `SWITCHBOARD_BOUNCER_PORT=0` turns it off.
 */
async function openBouncerPort(): Promise<void> {
  const wanted = process.env['SWITCHBOARD_BOUNCER_PORT']
  const port = wanted === undefined ? 6667 : Number(wanted)
  if (!Number.isInteger(port) || port <= 0) {
    console.info('IRC port off.')
    return
  }

  const cert = process.env['SWITCHBOARD_BOUNCER_TLS_CERT']
  const key = process.env['SWITCHBOARD_BOUNCER_TLS_KEY']

  const status = await startBouncer({
    port,
    address: process.env['SWITCHBOARD_BOUNCER_BIND'] ?? '127.0.0.1',
    password: process.env['SWITCHBOARD_BOUNCER_PASS'] ?? null,
    tls: cert && key ? { cert, key } : null,
    version: VERSION
  })

  if (status.error) console.error(`IRC port: ${status.error}`)
}

/**
 * Say what the connections are doing.
 *
 * A desktop shows this in a sidebar. Here there is no sidebar, and a bouncer
 * that fails to reach a network in silence is a bouncer nobody can debug —
 * the first symptom is a client attaching to an empty session hours later,
 * with nothing anywhere saying why.
 *
 * Only the events a person would want in a log. The message traffic is not
 * among them: it is in the database, it is somebody's private conversation,
 * and a server log is the wrong place for it.
 */
function reportConnections(): void {
  const named = (serverId: string): string =>
    getAllServers().find((server) => server.id === serverId)?.name ?? serverId

  ircManager.subscribe((channel, data) => {
    const event = data as Record<string, unknown>
    const server = typeof event['serverId'] === 'string' ? named(event['serverId']) : '?'

    switch (channel) {
      case 'irc:connected':
        console.info(`${server}: connected as ${String(event['nick'])}`)
        break
      case 'irc:disconnected':
        console.info(`${server}: disconnected — ${String(event['reason'])}`)
        break
      case 'irc:reconnecting':
        console.info(`${server}: reconnecting in ${Number(event['delayMs']) / 1000}s`)
        break
      case 'irc:error':
        console.error(`${server}: ${String(event['message'] ?? event['error'] ?? 'error')}`)
        break
      case 'irc:certificate':
        console.error(`${server}: certificate — ${String(event['reason'] ?? 'not trusted')}`)
        break
    }
  })
}

function describeState(): void {
  const remote = remoteStatus()
  const session = sessionState()
  const servers = getAllServers()
  const connected = ircManager.connectedServerIds()
  const bouncer = bouncerStatus()

  console.info('')
  console.info(`  Switchboard ${VERSION} — headless`)
  console.info(`  Data:     ${dataDir}`)
  console.info(`  Secrets:  ${secretsBackendDescription()}`)
  console.info(`  Vault:    ${vaultStatus().unlocked ? 'open' : 'locked'}`)
  console.info(`  Link:     ${remote.running ? 'listening' : 'off'}`)
  console.info(`  Devices:  ${remote.devices.length} paired, ${remote.connected.length} connected`)
  for (const peer of remote.dialled) {
    console.info(
      `    ${peer.connected ? '*' : ' '} ${peer.name ?? 'dialling'}  ${peer.ticket.slice(0, 24)}…`
    )
  }
  console.info(`  Session:  ${session.role}, priority ${session.priority}`)
  console.info(
    `  IRC port: ${
      bouncer.running
        ? `${bouncer.address}:${bouncer.port}${bouncer.tls ? ' TLS' : ''}, ${bouncer.clients.length} attached`
        : 'off'
    }`
  )
  console.info(`  Networks: ${connected.length} of ${servers.length} connected`)
  for (const server of servers) {
    const mark = connected.includes(server.id) ? '*' : ' '
    console.info(`    ${mark} ${server.name}  ${server.host}:${server.port}`)
  }
  console.info('')
}

/**
 * A console, for the times somebody is at one.
 *
 * Deliberately small. Anything that needs a real interface is done from the
 * desktop or the phone once one is paired — this exists to get the first
 * device paired and to answer "is it working", which are the two questions
 * you cannot answer from a device that is not paired yet.
 */
function readCommands(): void {
  const interactive = process.stdin.isTTY === true

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  if (interactive) rl.prompt()

  rl.on('line', (line) => {
    const command = line.trim()
    void (async () => {
      switch (command) {
        case '':
          break
        case 'pair':
          await announcePairing()
          break
        case 'status':
          describeState()
          break
        case 'networks':
          for (const server of getAllServers()) {
            const live = ircManager.connectedServerIds().includes(server.id)
            console.info(
              `  ${live ? '*' : ' '} ${server.name}  ${server.host}:${server.port}  ${server.nick}  ${server.id}`
            )
          }
          break
        case 'clients':
          for (const client of bouncerStatus().clients) {
            const network = client.network
              ? (getAllServers().find((s) => s.id === client.network)?.name ?? client.network)
              : 'no network'
            console.info(`  ${client.name}  ${network}`)
          }
          break
        case 'devices':
          for (const device of getPairedDevices()) {
            console.info(`  ${device.name}  ${device.endpointId}`)
          }
          break
        case 'help':
          console.info('  pair | status | networks | devices | clients')
          console.info('  add <name> <host[:port]> <nick>   — +port or a bare 6697 means TLS')
          console.info('  remove <id>')
          console.info('  dial <ticket> [code]              — go and find a desktop')
          console.info('  vault create                      — only for the very first instance')
          console.info('  undial <ticket>')
          console.info('  quit')
          break
        case 'quit':
        case 'exit':
          rl.close()
          await leave(0)
          return
        default: {
          /*
           * Enough of a console to set up a first network.
           *
           * Before a device is paired there is nothing else that can: the vault
           * arrives with a phone or a desktop, and somebody who means to use
           * this with irssi alone may never run either. An attached client can
           * do the same over `BOUNCER ADDNETWORK`, which is the same code
           * underneath.
           */
          const [verb, ...rest] = command.split(/\s+/)

          if (verb === 'add') {
            const [name, address, nick] = rest
            if (!name || !address || !nick) {
              console.info('  add <name> <host[:port]> <nick>')
              break
            }
            const { id, error } = createNetwork(
              new Map([
                ['name', name],
                ['host', address],
                ['nickname', nick]
              ])
            )
            console.info(error ? `  ${error}` : `  Added ${name} as ${id}. Connecting.`)
            break
          }

          if (verb === 'vault' && rest[0] === 'create') {
            /*
             * Making the first shared config is a deliberate act.
             *
             * Two vaults made separately under the same passphrase cannot open
             * each other — the salt differs — so doing this while a desktop
             * already has one is how somebody ends up with two configs and no
             * way back. Refused when one is already here for the same reason.
             */
            if (vaultStatus().exists) {
              console.info('  There is already a shared config here.')
              break
            }
            const passphrase = suppliedPassphrase()
            if (!passphrase) {
              console.info(
                '  Set SWITCHBOARD_PASSPHRASE first, so there is something to seal it with.'
              )
              break
            }
            const made = createVault(passphrase)
            console.info(made.unlocked ? '  Shared config created.' : '  Could not create it.')
            break
          }

          if (verb === 'dial') {
            const [ticket, code] = rest
            if (!ticket) {
              console.info('  dial <ticket> [pairing code]')
              break
            }
            const { ok, error } = await dialPeer(ticket, code)
            console.info(ok ? '  Linked.' : `  ${error}`)
            break
          }

          if (verb === 'undial') {
            const [ticket] = rest
            if (!ticket) {
              console.info('  undial <ticket> — see status')
              break
            }
            forgetDialledPeer(ticket)
            console.info('  Stopped looking for it.')
            break
          }

          if (verb === 'remove') {
            const [id] = rest
            if (!id) {
              console.info('  remove <id> — see networks')
              break
            }
            const { error } = deleteNetwork(id)
            console.info(error ? `  ${error}` : `  Removed ${id}.`)
            break
          }

          console.info(`  Unknown: ${command}. Try help.`)
        }
      }
      if (interactive) rl.prompt()
    })()
  })

  /*
   * A closed input is not a reason to stop.
   *
   * Under systemd stdin is `/dev/null`, which is at end of file the moment it
   * is opened — so a process that quits when input ends quits before it has
   * connected to anything, and the unit restarts forever. A person pressing
   * ctrl-D at a terminal does mean to leave; nothing else does.
   */
  rl.on('close', () => {
    if (interactive) void leave(0)
  })
}

let leaving = false

/**
 * Leave tidily, but never hang on it.
 *
 * Same rule as the desktop: a network call that does not come back must not
 * stop the process exiting. A supervisor that has asked for a stop will
 * escalate to SIGKILL, and being killed mid-write is how a database gets a
 * journal to recover from.
 */
async function leave(code: number): Promise<void> {
  if (leaving) return
  leaving = true

  console.info('Stopping.')
  await Promise.race([
    stopRemoteLink().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_500))
  ])

  stopWatchingWhoIsReading()
  stopBouncer()
  ircManager.destroyAll()
  closeDatabase()
  process.exit(code)
}

async function main(): Promise<void> {
  timestampOutput()

  // What a CTCP VERSION gets told
  setAppVersion(VERSION, process.platform)

  useNetworkSettings(() => ({
    proxy: getSetting<ProxySettings>('proxy') ?? null,
    caPath: getSetting<string>('customCaPath') ?? null
  }))

  await initDatabase()

  persistSTSPoliciesWith({ save: saveSTSPolicy, forget: forgetSTSPolicy })
  loadSTSPolicies(allSTSPolicies())

  unlockWhateverArrives()
  openVault()

  const { migrated } = encryptStoredCredentials()
  if (migrated > 0) console.info(`Encrypted stored credentials for ${migrated} server(s)`)

  registerIPCHandlers()
  reportConnections()

  /*
   * Away while nobody is reading.
   *
   * The desktop's version of this watches the keyboard, and there is no
   * keyboard here — `idleSeconds` is null precisely because a headless
   * instance is not a person. What it has instead is a count of who is
   * attached, which answers the same question better: an IRC client on the
   * port or a paired device on the link means somebody can see this.
   */
  watchWhoIsReading(ircManager, {
    attached: attachedClients,
    linked: () => remoteStatus().connected.length
  })

  /*
   * The link is the whole point of this process, so it starts whether or not
   * it was on last time.
   *
   * On a desktop the link is a setting somebody turned on. Here there is no
   * other way in: a headless instance with no link is a process holding IRC
   * connections that nothing can read. `resumeRemoteLink` first so an
   * explicit off is still honoured for its own bookkeeping, then start.
   */
  await resumeRemoteLink()
  const link = await startRemoteLink()
  if (link.error) console.error(`Remote link: ${link.error}`)

  await openBouncerPort()

  // Nothing is paired yet, so nothing can ever reach this. Say how.
  if (getPairedDevices().length === 0) {
    console.info('No devices paired yet.')
    await announcePairing()
  }

  describeState()

  /*
   * Dial after the coordinator has had its look around.
   *
   * A headless instance outranks everything, so it will end up holding the
   * connections — but a phone that took over while this was down is still on
   * the network right now, and dialling before it has been told to let go
   * puts both of us there under two nicks. The coordinator's discovery window
   * covers exactly this; waiting it out costs a few seconds once per restart.
   */
  setTimeout(() => ircManager.autoConnectAll(), 8_000)

  readCommands()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void leave(0))
}

process.on('unhandledRejection', (reason) => {
  // Staying up is the right call: this process exists to hold connections, and
  // one failed promise somewhere is not a reason to drop all of them.
  console.error('Unhandled rejection:', reason)
})

main().catch((err) => {
  console.error('Could not start:', err)
  process.exit(1)
})
