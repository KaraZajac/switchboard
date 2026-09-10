import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import '../../src/main/irc/handlers/index'
import { registeredCommands } from '../../src/main/irc/handlers/registry'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/handlers-parity.json'), 'utf8')
) as {
  handled: string[]
  desktopOnly: Record<string, string>
  phoneOnly: Record<string, string>
}

/**
 * What the two clients answer.
 *
 * Two clients that handle different messages behave differently on the same
 * network, and the seam shows up exactly when one takes over from the other —
 * which is when nobody is watching. The desktop was missing four numerics the
 * phone had: the plain WHO reply (so away and bot flags were lost on every
 * network without WHOX), RPL_AWAY (so messaging someone who is not there said
 * nothing), the reply to a MODE query (so `/mode #channel` did nothing at all),
 * and ERR_NICKLOCKED. Nothing was watching for that either.
 */
describe('handler parity', () => {
  it('handles exactly what the shared list says', () => {
    expect(registeredCommands()).toEqual(corpus.handled)
  })

  it('has a reason recorded for anything only one client answers', () => {
    for (const [command, reason] of Object.entries(corpus.desktopOnly)) {
      expect(corpus.handled, `${command} is desktop-only`).toContain(command)
      expect(reason.length, `${command} needs a reason`).toBeGreaterThan(20)
    }
    for (const reason of Object.values(corpus.phoneOnly)) {
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('lets several handlers claim one command', () => {
    // JOIN is interesting to the roster and to the metadata layer for
    // different reasons. Registering with `set` meant the second silently
    // replaced the first.
    expect(registeredCommands()).toContain('JOIN')
    expect(new Set(registeredCommands()).size).toBe(registeredCommands().length)
  })
})
