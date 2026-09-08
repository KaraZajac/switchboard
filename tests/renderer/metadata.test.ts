import { describe, it, expect } from 'vitest'
import {
  METADATA_KEYS,
  displayNameFor,
  isValidMetadataKey,
  metadataColor
} from '../../src/shared/types/metadata'

describe('metadata keys', () => {
  it('covers the registry keys we render', () => {
    expect([...METADATA_KEYS]).toEqual([
      'avatar',
      'display-name',
      'homepage',
      'pronouns',
      'status',
      'color'
    ])
  })

  it('accepts the key charset the spec allows', () => {
    for (const key of METADATA_KEYS) expect(isValidMetadataKey(key)).toBe(true)
    expect(isValidMetadataKey('vendor.example/thing')).toBe(true)
    expect(isValidMetadataKey('under_score-1')).toBe(true)
  })

  it('rejects keys the spec does not allow', () => {
    expect(isValidMetadataKey('Display-Name')).toBe(false) // uppercase
    expect(isValidMetadataKey('two words')).toBe(false)
    expect(isValidMetadataKey('semi;colon')).toBe(false)
    expect(isValidMetadataKey('')).toBe(false)
  })
})

describe('display names', () => {
  it('prefers a display name when set', () => {
    expect(displayNameFor('kara', { 'display-name': 'Kara Z' })).toBe('Kara Z')
  })

  it('falls back to the nick', () => {
    expect(displayNameFor('kara', {})).toBe('kara')
    expect(displayNameFor('kara', undefined)).toBe('kara')
    expect(displayNameFor('kara', { 'display-name': '   ' })).toBe('kara')
  })
})

describe('user colours', () => {
  it('takes hex colours as written', () => {
    expect(metadataColor('#f38ba8')).toBe('#f38ba8')
    expect(metadataColor('#ABC')).toBe('#ABC')
    expect(metadataColor('  #a6e3a1  ')).toBe('#a6e3a1')
  })

  it('understands the mIRC colour numbers people actually type', () => {
    expect(metadataColor('4')).toBe('#ff0000')
    expect(metadataColor('0')).toBe('#ffffff')
    expect(metadataColor('15')).toBe('#d2d2d2')
  })

  it('returns null for anything it cannot use, rather than a broken style', () => {
    expect(metadataColor('rebeccapurple')).toBeNull()
    expect(metadataColor('16')).toBeNull()
    expect(metadataColor('-1')).toBeNull()
    expect(metadataColor('#12345')).toBeNull()
    expect(metadataColor('')).toBeNull()
    expect(metadataColor(undefined)).toBeNull()
  })
})
