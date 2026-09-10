import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { REQUESTED_CAPS } from '@shared/constants'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/capabilities.json'), 'utf8')
) as { requested: string[]; notCapabilities: string[]; rules: { maxLineBytes: number } }

/**
 * The names we ask for.
 *
 * Only advertised capabilities are requested, so a wrong name is not an error —
 * it is silence. The feature never turns on, nothing is logged, and the bug
 * survives every test that does not look at the wire. These are the shapes that
 * have actually been wrong here.
 */
describe('capability names', () => {
  const caps = REQUESTED_CAPS as readonly string[]

  it('never asks for a client tag', () => {
    // `+` prefixes a message tag. A CAP REQ token starting with one is asking
    // for a capability that cannot exist.
    expect(caps.filter((cap) => cap.startsWith('+'))).toEqual([])
  })

  it('uses the registered case', () => {
    // Capability names are case-sensitive, and all registered ones are
    // lowercase. `UTF8ONLY` is the ISUPPORT token, not a capability.
    expect(caps.filter((cap) => cap !== cap.toLowerCase())).toEqual([])
  })

  it('has no duplicates', () => {
    expect(new Set(caps).size).toBe(caps.length)
  })

  it('uses the names servers actually advertise', () => {
    // Each of these was wrong once, and each failure was invisible
    expect(caps).toContain('no-implicit-names')
    expect(caps).not.toContain('draft/no-implicit-names')

    expect(caps).toContain('draft/message-edit')
    expect(caps).not.toContain('draft/edit')

    // utf8only is an ISUPPORT token; the spec defines no such capability
    expect(caps).not.toContain('UTF8ONLY')
    expect(caps).not.toContain('utf8only')

    // The redaction spec says the unprefixed name MUST NOT be used
    expect(caps).toContain('draft/message-redaction')
    expect(caps).not.toContain('message-redaction')

    expect(caps).toContain('typing')
    expect(caps).not.toContain('+typing')

    expect(caps).toContain('draft/channel-context')
    expect(caps).not.toContain('+draft/channel-context')
  })

  it('does not ask for things that are not capabilities', () => {
    // msgid arrives with message-tags; there is no `message-ids` capability
    expect(caps).not.toContain('message-ids')
    // superseded by draft/account-registration, which carries before-connect
    expect(caps).not.toContain('draft/register-before-connect')
  })

  it('asks for what the client has code for', () => {
    for (const cap of [
      'sasl',
      'draft/metadata-2',
      'draft/chathistory',
      'draft/read-marker',
      'draft/multiline',
      'draft/account-registration',
      'draft/channel-rename',
      'draft/message-redaction',
      'monitor',
      'echo-message',
      'setname',
      'chghost',
      'draft/pre-away',
      'draft/auto-join'
    ]) {
      expect(caps, `${cap} has a feature module but is never requested`).toContain(cap)
    }
  })

  it('is the same list the phone asks for', () => {
    // The Android client reads this fixture too. Two clients that negotiate
    // different capabilities render the same channel differently, and the seam
    // shows up exactly when one takes over from the other.
    expect(caps).toEqual(fixture.requested)
  })

  it('rules out the names that were wrong before', () => {
    for (const name of fixture.notCapabilities) {
      expect(caps, `${name} is not a capability`).not.toContain(name)
    }
  })

  /**
   * A feature module is not evidence of a capability.
   *
   * WHOX, bot mode and account extbans each have code behind them and are each
   * announced with an ISUPPORT token — `WHOX`, `BOT`, `ACCOUNTEXTBAN`. Asking
   * for them in a CAP REQ asks for something that cannot be granted, and
   * because only advertised names are ever requested it fails by doing nothing
   * at all rather than by saying so.
   */
  it('does not mistake an ISUPPORT feature for a capability', () => {
    for (const name of ['whox', 'bot', 'account-extban']) {
      expect(caps, `${name} is an ISUPPORT token`).not.toContain(name)
    }
  })
})
