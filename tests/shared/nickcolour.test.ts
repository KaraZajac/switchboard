import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AVATAR_COLOURS, avatarColour, avatarInk, avatarInkFor } from '@shared/nickcolour'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/nickcolour.json'), 'utf8')) as {
  colours: string[]
  ink: { name: string; colour: string; ink: string; contrast: number }[]
  nicks: { nick: string; colour: string }[]
}

describe('the seventeen', () => {
  it('are the ones both clients paint with, in the order the hash indexes them', () => {
    expect([...AVATAR_COLOURS]).toEqual(corpus.colours)
  })

  it('are all fixed, so nobody changes colour when the theme does', () => {
    // Two of these used to be Tailwind shades every palette redefines
    for (const colour of AVATAR_COLOURS) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('the lettering on a circle', () => {
  for (const c of corpus.ink) {
    it(`${c.name} takes ${c.ink === '#ffffff' ? 'white' : 'black'}`, () => {
      expect(avatarInk(c.colour)).toBe(c.ink)
    })
  }

  it('reads on every one of them', () => {
    // Always-white was 2.01:1 on the green. This is the number that replaced it
    expect(Math.min(...corpus.ink.map((c) => c.contrast))).toBeGreaterThanOrEqual(4.5)
  })

  it('takes the shorthand a stylesheet might hand it', () => {
    expect(avatarInk('#fff')).toBe('#000000')
    expect(avatarInk('#000')).toBe('#ffffff')
  })
})

describe('which colour a nick gets', () => {
  for (const c of corpus.nicks) {
    it(`${c.nick || '(an empty nick)'}`, () => {
      expect(avatarColour(c.nick)).toBe(c.colour)
    })
  }

  it('is the same answer every time', () => {
    expect(avatarColour('kara')).toBe(avatarColour('kara'))
  })

  it('tells them apart where a weaker hash would not', () => {
    const three = ['dave', 'dave_', 'dave__'].map(avatarColour)
    expect(new Set(three).size).toBe(3)
  })

  it('hands back the circle and its lettering together', () => {
    const { background, ink } = avatarInkFor('kara')
    expect(background).toBe(avatarColour('kara'))
    expect(ink).toBe(avatarInk(background))
  })
})
