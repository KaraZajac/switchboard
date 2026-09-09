import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseMetadataLimits, metadataValueFits } from '../../src/main/irc/features/metadata'
import { saslMechanismsFrom } from '../../src/main/irc/capability'

/**
 * The values servers put on their capabilities.
 *
 * A capability is not only a yes: `sasl=PLAIN`, `draft/metadata-2=max-value-
 * bytes=4096` and `draft/multiline=max-lines=20` all say what the server will
 * actually take. Ignoring them means sending something it has already said it
 * will refuse, and the refusal arrives as a bare FAIL the user cannot act on.
 */

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/cap-values.json'), 'utf8')
)

/** A connection carrying one capability value, which is all these read */
const withValue = (capability: string, value: string) =>
  ({ state: { availableCapabilities: new Map([[capability, value]]) } }) as never

describe('which SASL mechanisms a server will take', () => {
  for (const c of corpus.sasl) {
    it(c.name, () => {
      expect(saslMechanismsFrom(c.value)).toEqual(c.mechanisms)
    })
  }
})

describe('how much metadata a server will hold', () => {
  for (const c of corpus.metadata) {
    it(c.name, () => {
      const limits = parseMetadataLimits(c.value)
      expect(limits.maxSubs).toBe(c.maxSubs)
      expect(limits.maxKeys).toBe(c.maxKeys)
      expect(limits.maxValueBytes).toBe(c.maxValueBytes)
    })
  }
})

describe('whether a profile field will be kept', () => {
  for (const c of corpus.fits) {
    it(c.name, () => {
      expect(metadataValueFits(withValue('draft/metadata-2', c.value), c.text)).toBe(c.fits)
    })
  }
})
