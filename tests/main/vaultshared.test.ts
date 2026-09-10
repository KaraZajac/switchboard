import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { VaultPayload } from '../../src/main/vault/vault'

/**
 * What the vault carries besides servers.
 *
 * Servers were the only shared thing for a long time, so a theme picked on the
 * phone and a friend added on the desktop each stayed where they were made —
 * on two clients that are supposed to be the same client in two places. These
 * are the fields that fixed it, read from the same corpus the Kotlin side
 * reads, because two devices quietly disagreeing about what the person chose
 * is exactly the failure nobody reports.
 */

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/vault-shared-state.json'), 'utf8')
)

const asPayload = (raw: unknown) => raw as VaultPayload

describe('the shared state a vault carries', () => {
  const payload = asPayload(corpus.payload)

  it('carries the theme the person chose', () => {
    expect(payload.settings?.theme).toBe(corpus.expected.theme)
  })

  /** MONITOR is per connection: the server never says who is on the list */
  it('carries the watched nicks of every server', () => {
    expect(payload.monitor).toEqual(corpus.expected.watched)
  })

  it('still carries the servers', () => {
    expect(payload.servers.map((s) => s.id)).toEqual(corpus.expected.serverIds)
  })

  /**
   * A display name and a set of pronouns are facts about the person, not about
   * the machine they were typed on. The phone writes this one, and a desktop
   * that did not know about it dropped it on the next reseal.
   */
  it('carries the profile that belongs to the person', () => {
    expect(payload.settings?.profile).toEqual(corpus.expected.profile)
  })

  /**
   * Joining a channel is how you say you want to be in it — there is no other
   * signal — so the join is the setting, and it belongs to the config both
   * clients read rather than to one device's local list.
   */
  it('carries each server’s join-on-connect list', () => {
    for (const server of payload.servers) {
      expect(server.autoJoin ?? []).toEqual(
        (corpus.expected.autoJoin as Record<string, string[]>)[server.id]
      )
    }
  })

  /**
   * Upgrading one device must not lock the other out of its own config, in
   * either direction.
   */
  it('opens a vault sealed before any of this existed', () => {
    const older = asPayload(corpus.older)
    expect(older.servers).toHaveLength(1)
    expect(older.settings).toBeUndefined()
    expect(older.monitor).toBeUndefined()
  })

  it('opens a vault from a client that knows something we do not', () => {
    const newer = asPayload(corpus.newer)
    expect(newer.settings?.theme).toBe('gruvbox')
    expect(newer.servers).toEqual([])
  })
})

/**
 * Not everything in settings belongs to the person.
 *
 * A proxy address and a CA path describe the machine they were typed on, and
 * copying those onto a phone would be wrong rather than merely unhelpful.
 */
describe('which settings are shared at all', () => {
  it('shares the ones about the person and no others', async () => {
    const { SHARED_SETTINGS } = await import('../../src/main/vault/vault')

    // The profile most of all: a display name and a set of pronouns are facts
    // about the person. It is also what the phone writes, and a key missing
    // from this list is dropped on the next reseal rather than merely unshared.
    expect([...SHARED_SETTINGS]).toEqual(['theme', 'mutes', 'profile'])
    expect(SHARED_SETTINGS as readonly string[]).not.toContain('proxy')
    expect(SHARED_SETTINGS as readonly string[]).not.toContain('customCaPath')
  })
})
