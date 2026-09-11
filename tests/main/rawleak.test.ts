import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

/**
 * The two halves of the fix, asserted against the source rather than a mock.
 *
 * A unit test of `redactLine` proves the rule; these prove it is actually
 * applied, and that the stream carrying it no longer leaves the machine.
 */
describe('the wire log does not carry credentials off this machine', () => {
  it('is not relayed to paired devices', () => {
    const link = readFileSync('src/main/remote/link.ts', 'utf8')
    expect(link).toMatch(/NEVER_RELAYED\s*=\s*new Set\(\[[^\]]*'irc:raw'/)
    expect(link).toMatch(/if \(NEVER_RELAYED\.has\(channel\)\) return/)
  })

  it('is redacted before it is emitted at all', () => {
    const connection = readFileSync('src/main/irc/connection.ts', 'utf8')
    expect(connection).toContain("this.emit('raw', 'out', redactLine(line))")
    // and never the unredacted form
    expect(connection).not.toMatch(/emit\('raw', 'out', line\)/)
  })
})
