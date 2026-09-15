import { DESKTOP_PRIORITY } from '../session/coordinator'
/**
 * What the engine needs from the machine it is running on.
 *
 * Everything below `src/main` that is not the window is the engine: the
 * connections, the storage, the vault, the session, the link. It was written
 * against Electron because that is where it has always run, but only a handful
 * of things actually needed Electron — somewhere to put files, a keychain, how
 * long the person has been idle, and a fetch that honours the system proxy.
 *
 * Behind this interface instead, so the same engine can run with no window at
 * all. That is the only thing standing between here and a Switchboard that
 * lives on a machine which never sleeps, which is the one thing a paired
 * desktop and phone cannot be for each other.
 *
 * Deliberately no import of Electron in this file. A headless build must not
 * pull it in, and the surest way to guarantee that is for the engine's view of
 * the platform to have never heard of it.
 */

export interface SecretStore {
  /** Whether the OS will actually wrap a secret for us */
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
  /** Which store is in use, for the settings panel and for diagnostics */
  describe(): string
}

export interface Host {
  /** Where this instance keeps its database, its key and its logs */
  dataDir(): string

  secrets: SecretStore

  /**
   * How long since the person last touched anything, in seconds.
   *
   * Null where there is nobody to be idle — a headless instance is not away,
   * it is simply not a person, and marking it away would mark *you* away.
   */
  idleSeconds(): number | null

  /** A fetch that honours the system proxy, where the platform has one */
  fetch: typeof globalThis.fetch

  /**
   * How good a host for the connections this machine is.
   *
   * A property of the machine rather than of the app, which is why it is
   * asked for here: mains power, no Doze, and — for a headless instance —
   * never being closed. The session coordinator uses it to decide who holds
   * the network when more than one device is up.
   */
  sessionPriority(): number
}

let installed: Host | null = null

/**
 * Say what this process is running on.
 *
 * Called once, as early as possible: the Electron entry point installs the
 * Electron host before anything touches storage, and a headless entry installs
 * its own.
 */
export function setHost(next: Host | null): void {
  installed = next
}

export function host(): Host {
  if (!installed) {
    throw new Error(
      'No host installed. Call setHost() before anything touches storage — ' +
        'see src/main/host/index.ts'
    )
  }
  return installed
}

/** Whether one has been installed, for code that can do without */
export function hasHost(): boolean {
  return installed !== null
}

/**
 * A host for tests: a directory you choose and a keychain that only pretends.
 *
 * Not encryption — a stand-in with the same shape, so the wrapping and
 * unwrapping paths are exercised without a real keyring in the test run.
 */
export function testHost(dataDir: string, options: { keychain?: boolean } = {}): Host {
  const keychain = options.keychain ?? true
  return {
    dataDir: () => dataDir,
    secrets: {
      available: () => keychain,
      encrypt: (plain) => Buffer.from(`wrapped:${plain}`),
      decrypt: (data) => data.toString().replace(/^wrapped:/, ''),
      describe: () => (keychain ? 'test' : 'none')
    },
    idleSeconds: () => 0,
    fetch: globalThis.fetch,
    sessionPriority: () => DESKTOP_PRIORITY
  }
}
