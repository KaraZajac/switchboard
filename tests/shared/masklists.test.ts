import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  maskListsFor,
  readListReply,
  isListNumeric,
  looksLikeMask,
  maskToSet
} from '@shared/masklists'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/masklists.json'), 'utf8')) as {
  lists: { name: string; chanmodes: string | null; prefix: string; modes: string[] }[]
  labels: { name: string; chanmodes: string; prefix: string; mode: string; label: string; entry: string }[]
  replies: {
    name: string
    command: string
    params: string[]
    mode?: string
    channel?: string
    done?: boolean
    entry?: { mask: string; setBy?: string; setAt?: number }
    reply?: null
  }[]
  masks: { name: string; typed: string; sent: string; isMask: boolean }[]
}

describe('which lists a network keeps', () => {
  for (const c of corpus.lists) {
    it(c.name, () =>
      expect(maskListsFor(c.chanmodes, c.prefix).map((l) => l.mode)).toEqual(c.modes))
  }

  /**
   * The `q` trap, from the other side. `quietMode` already refuses to offer
   * "mute" on a network where `q` makes somebody the owner; the same letter
   * must not grow a "Quiets" tab there either.
   */
  it('never shows a rank as a list', () => {
    const unreal = maskListsFor('beI,kLf,l,psmnt', '(qaohv)~&@%+')
    expect(unreal.map((l) => l.mode)).not.toContain('q')

    const solanum = maskListsFor('eIbq,k,flj,CFLMPQS', '(ohv)@%+')
    expect(solanum.map((l) => l.mode)).toContain('q')
  })
})

describe('what each list is called', () => {
  for (const c of corpus.labels) {
    it(c.name, () => {
      const list = maskListsFor(c.chanmodes, c.prefix).find((l) => l.mode === c.mode)
      expect(list?.label).toBe(c.label)
      expect(list?.entry).toBe(c.entry)
    })
  }
})

describe('reading a list off the wire', () => {
  for (const c of corpus.replies) {
    it(c.name, () => {
      const reply = readListReply(c.command, c.params)
      if (c.reply === null) {
        expect(reply).toBe(null)
        return
      }
      expect(reply?.mode).toBe(c.mode)
      expect(reply?.channel).toBe(c.channel)
      expect(reply?.done).toBe(c.done)
      if (c.entry) {
        expect(reply?.entry?.mask).toBe(c.entry.mask)
        expect(reply?.entry?.setBy).toBe(c.entry.setBy)
        expect(reply?.entry?.setAt).toBe(c.entry.setAt)
      } else {
        expect(reply?.entry).toBeUndefined()
      }
    })
  }

  /**
   * The difference that actually bites. RPL_QUIETLIST puts the mode letter
   * where RPL_BANLIST puts the mask, so reading one as the other lists the
   * letter `q` as though somebody had banned it.
   */
  it('does not mistake the quiet list mode for a mask', () => {
    const quiet = readListReply('728', ['kara', '#test', 'q', '*!*@loud.example'])
    expect(quiet?.entry?.mask).toBe('*!*@loud.example')
    expect(quiet?.entry?.mask).not.toBe('q')
  })

  it('knows which numerics are lists', () => {
    for (const numeric of ['367', '368', '346', '347', '348', '349', '728', '729']) {
      expect(isListNumeric(numeric)).toBe(true)
    }
    for (const numeric of ['353', '366', '324', '482']) {
      expect(isListNumeric(numeric)).toBe(false)
    }
  })
})

describe('what to send for what was typed', () => {
  for (const c of corpus.masks) {
    it(c.name, () => {
      expect(maskToSet(c.typed)).toBe(c.sent)
      expect(looksLikeMask(c.typed.trim())).toBe(c.isMask)
    })
  }

  /** Expanding something that is already a mask would corrupt it */
  it('is idempotent', () => {
    for (const typed of ['kara', '*!*@x', 'a@b', '*.example']) {
      expect(maskToSet(maskToSet(typed))).toBe(maskToSet(typed))
    }
  })
})
