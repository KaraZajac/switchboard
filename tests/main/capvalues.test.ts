import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseMetadataLimits, metadataValueFits } from '../../src/main/irc/features/metadata'
import { saslMechanismsFrom } from '../../src/main/irc/capability'
import { targetMax, groupTargets, isupportNumber, fitsLimit } from '../../src/shared/isupport'

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

/**
 * TARGMAX, which is the one that loses the message.
 *
 * `PRIVMSG:1` and a message addressed to two people comes back `407 :Too many
 * recipients` — delivered to neither, which is not what "too many" sounds like
 * it should mean.
 */
describe('how many people one command may address', () => {
  for (const c of corpus.targmax) {
    it(c.name, () => {
      const isupport = c.value === null ? {} : { TARGMAX: c.value }
      expect(targetMax(isupport, c.command)).toBe(c.max)
    })
  }
})

describe('splitting a target list into commands the server will take', () => {
  for (const c of corpus.groups) {
    it(c.name, () => {
      expect(groupTargets(c.targets, c.max)).toEqual(c.groups)
    })
  }

  it('never loses or reorders a recipient', () => {
    const names = Array.from({ length: 17 }, (_, i) => `person${i}`)
    const groups = groupTargets(names.join(','), 5)

    expect(groups.join(',').split(',')).toEqual(names)
    expect(groups.every((g) => g.split(',').length <= 5)).toBe(true)
  })
})

describe('lengths the server states but does not enforce', () => {
  it('reads a positive number and nothing else', () => {
    expect(isupportNumber({ TOPICLEN: '307' }, 'TOPICLEN')).toBe(307)
    expect(isupportNumber({ TOPICLEN: '0' }, 'TOPICLEN')).toBeNull()
    expect(isupportNumber({ TOPICLEN: 'lots' }, 'TOPICLEN')).toBeNull()
    expect(isupportNumber({ TOPICLEN: true }, 'TOPICLEN')).toBeNull()
    expect(isupportNumber({}, 'TOPICLEN')).toBeNull()
  })

  /** Bytes, which is what the server counts, not characters */
  it('measures the limit in bytes', () => {
    expect(fitsLimit('abcdefghij', 10)).toBe(true)
    expect(fitsLimit('abcdefghijk', 10)).toBe(false)
    expect(fitsLimit('日本語', 10)).toBe(true)
    expect(fitsLimit('日本語です', 10)).toBe(false)
    expect(fitsLimit('anything at all', null)).toBe(true)
  })
})
