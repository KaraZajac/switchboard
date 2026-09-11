import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { channelModesFor, modeChange, type ChannelMode, type ModeKind } from '@shared/chanmodes'
import { maskListsFor } from '@shared/masklists'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/chanmodes.json'), 'utf8')) as {
  modes: {
    name: string
    chanmodes: string | null
    prefix: string
    letters?: string[]
    kinds?: ModeKind[]
    excludes?: string[]
  }[]
  labels: { name: string; chanmodes: string; prefix: string; letter: string; label: string }[]
  changes: {
    name: string
    letter: string
    kind: ModeKind
    on: boolean
    value: string | null
    args: string[] | null
  }[]
}

describe('which modes are settings', () => {
  for (const c of corpus.modes) {
    it(c.name, () => {
      const modes = channelModesFor(c.chanmodes, c.prefix)
      if (c.letters) expect(modes.map((m) => m.letter)).toEqual(c.letters)
      if (c.kinds) expect(modes.map((m) => m.kind)).toEqual(c.kinds)
      for (const letter of c.excludes ?? []) {
        expect(modes.map((m) => m.letter)).not.toContain(letter)
      }
    })
  }

  /**
   * The two panels must not both claim a letter. A ban shown as a checkbox
   * would set `+b` with no mask, which every server refuses.
   */
  it('never offers a mask list as a setting', () => {
    for (const network of [
      { chanmodes: 'eIbq,k,flj,CFLMPQScgimnprstz', prefix: '(ohv)@%+' },
      { chanmodes: 'beI,kLf,l,psmntirz', prefix: '(qaohv)~&@%+' }
    ]) {
      const settings = channelModesFor(network.chanmodes, network.prefix).map((m) => m.letter)
      const lists = maskListsFor(network.chanmodes, network.prefix).map((l) => l.mode)
      expect(settings.filter((letter) => lists.includes(letter))).toEqual([])
    }
  })
})

describe('what each mode is called', () => {
  for (const c of corpus.labels) {
    it(c.name, () => {
      const mode = channelModesFor(c.chanmodes, c.prefix).find((m) => m.letter === c.letter)
      expect(mode?.label).toBe(c.label)
    })
  }
})

describe('turning one on or off', () => {
  for (const c of corpus.changes) {
    it(c.name, () => {
      const mode: ChannelMode = { letter: c.letter, kind: c.kind, label: 'x', hint: 'y' }
      expect(modeChange(mode, c.on, c.value)).toEqual(c.args)
    })
  }

  /**
   * A mode that takes a value and was given none must send nothing. Sending
   * `+l` alone is a command the server answers with an error we chose to
   * cause, which reads to the user as the client being broken.
   */
  it('never sends a value mode without its value', () => {
    for (const kind of ['param', 'paramOnSet'] as ModeKind[]) {
      const mode: ChannelMode = { letter: 'k', kind, label: 'x', hint: 'y' }
      expect(modeChange(mode, true, null)).toBe(null)
      expect(modeChange(mode, true, '')).toBe(null)
    }
  })
})
