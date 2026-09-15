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
import { restoreVault, unlockVault, createVault, vaultStatus } from './vault/vault'
import { loadSTSPolicies, persistSTSPoliciesWith } from './irc/features/sts'
import { allSTSPolicies, saveSTSPolicy, forgetSTSPolicy } from './storage/models/sts'
import {
  resumeRemoteLink,
  startRemoteLink,
  startPairing,
  stopRemoteLink,
  remoteStatus,
  sessionState
} from './remote/link'
import { registerIPCHandlers } from './ipc/index'
import { encryptStoredCredentials, getAllServers } from './storage/models/server'
import { getSetting } from './storage/models/settings'
import { useNetworkSettings } from './irc/connection'
import { setAppVersion } from './irc/handlers/message'
import { secretsBackendDescription } from './storage/secrets'
import { getPairedDevices } from './storage/models/device'
import type { ProxySettings } from '@shared/socks'

const VERSION = process.env['SWITCHBOARD_VERSION'] ?? 'headless'

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

/** Open the shared config, whichever way is available */
function openVault(): void {
  const before = vaultStatus()

  // The usual path: the key file remembered it, exactly as a keychain would.
  if (before.exists) {
    const restored = restoreVault()
    if (restored.unlocked) {
      console.info('Shared config open.')
      return
    }
  }

  const passphrase = suppliedPassphrase()
  if (!passphrase) {
    if (before.exists) {
      console.warn(
        'Shared config is locked and no passphrase was given. Set SWITCHBOARD_PASSPHRASE or ' +
          'SWITCHBOARD_PASSPHRASE_FILE. Networks and settings will not reach paired devices ' +
          'until it is open.'
      )
    } else {
      console.info(
        'No shared config yet. Set SWITCHBOARD_PASSPHRASE to make one, or pair a device and ' +
          'let it send its own.'
      )
    }
    return
  }

  const status = before.exists ? unlockVault(passphrase) : createVault(passphrase)
  if (status.unlocked) {
    console.info(before.exists ? 'Shared config unlocked.' : 'Shared config created.')
  } else {
    console.error('That passphrase did not open the shared config.')
  }
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

function describeState(): void {
  const remote = remoteStatus()
  const session = sessionState()
  const servers = getAllServers()
  const connected = ircManager.connectedServerIds()

  console.info('')
  console.info(`  Switchboard ${VERSION} — headless`)
  console.info(`  Data:     ${dataDir}`)
  console.info(`  Secrets:  ${secretsBackendDescription()}`)
  console.info(`  Vault:    ${vaultStatus().unlocked ? 'open' : 'locked'}`)
  console.info(`  Link:     ${remote.running ? 'listening' : 'off'}`)
  console.info(`  Devices:  ${remote.devices.length} paired, ${remote.connected.length} connected`)
  console.info(`  Session:  ${session.role}, priority ${session.priority}`)
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
  if (!process.stdin.isTTY) return

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  rl.prompt()

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
        case 'devices':
          for (const device of getPairedDevices()) {
            console.info(`  ${device.name}  ${device.endpointId}`)
          }
          break
        case 'help':
          console.info('  pair | status | devices | quit')
          break
        case 'quit':
        case 'exit':
          rl.close()
          await leave(0)
          return
        default:
          console.info(`  Unknown: ${command}. Try help.`)
      }
      rl.prompt()
    })()
  })

  rl.on('close', () => void leave(0))
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

  ircManager.destroyAll()
  closeDatabase()
  process.exit(code)
}

async function main(): Promise<void> {
  // What a CTCP VERSION gets told
  setAppVersion(VERSION, process.platform)

  useNetworkSettings(() => ({
    proxy: getSetting<ProxySettings>('proxy') ?? null,
    caPath: getSetting<string>('customCaPath') ?? null
  }))

  await initDatabase()

  persistSTSPoliciesWith({ save: saveSTSPolicy, forget: forgetSTSPolicy })
  loadSTSPolicies(allSTSPolicies())

  openVault()

  const { migrated } = encryptStoredCredentials()
  if (migrated > 0) console.info(`Encrypted stored credentials for ${migrated} server(s)`)

  registerIPCHandlers()

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
