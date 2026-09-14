import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatFingerprint,
  sameFingerprint,
  certificateProblemText,
  certificateFingerprintLine
} from '../../src/shared/certificate'

/**
 * A pinned certificate is written down on one device and compared on the
 * other, so both must spell and compare the fingerprint the same way.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/certificate.json'), 'utf8')) as {
  format: { name: string; raw: string; shown: string }[]
  same: { name: string; a: string | null; b: string | null; same: boolean }[]
}

describe('spelling a fingerprint', () => {
  for (const c of corpus.format) {
    it(c.name, () => expect(formatFingerprint(c.raw)).toBe(c.shown))
  }
})

describe('comparing fingerprints', () => {
  for (const c of corpus.same) {
    it(c.name, () => expect(sameFingerprint(c.a, c.b)).toBe(c.same))
  }
})

describe('what the user is told', () => {
  it('names the host and the reason, with the fingerprint on a line of its own', () => {
    const problem = { fingerprint: 'ab12cd34', subject: 'irc.example.org', issuer: null, validTo: null, reason: 'DEPTH_ZERO_SELF_SIGNED_CERT' }
    const text = certificateProblemText(problem, 'irc.example.org')
    expect(text).toContain('irc.example.org')
    expect(text.toLowerCase()).toContain('trust')
    expect(text).not.toContain('AB:12')
    expect(certificateFingerprintLine(problem)).toBe('SHA-256 AB:12:CD:34')
  })
})
