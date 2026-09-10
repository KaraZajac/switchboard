import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  friendListKind,
  friendListLimit,
  friendListLines,
  friendListStatusLine,
  friendListListLine,
  type FriendListKind
} from '../../src/shared/friends'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/friends.json'), 'utf8')
) as {
  kinds: { name: string; isupport: Record<string, string | true>; kind: FriendListKind | null; limit: number | null }[]
  lines: { name: string; kind: FriendListKind; action: 'add' | 'remove'; nicks: string[]; lines: string[] }[]
  status: { kind: FriendListKind; here: string; list: string }[]
}

describe('shared friend-list corpus', () => {
  for (const c of corpus.kinds) {
    it(`picks a command: ${c.name}`, () => {
      expect(friendListKind(c.isupport)).toBe(c.kind)
      expect(friendListLimit(c.isupport)).toBe(c.limit)
    })
  }

  for (const c of corpus.lines) {
    it(`builds lines: ${c.name}`, () => {
      expect(friendListLines(c.kind, c.nicks, c.action)).toEqual(c.lines)
    })
  }

  for (const c of corpus.status) {
    it(`asks the two questions: ${c.kind}`, () => {
      expect(friendListStatusLine(c.kind)).toBe(c.here)
      expect(friendListListLine(c.kind)).toBe(c.list)
    })
  }

  it('keeps every line inside one IRC message', () => {
    const many = Array.from({ length: 200 }, (_, i) => `someverylongnickname${i}`)
    for (const kind of ['MONITOR', 'WATCH'] as FriendListKind[]) {
      for (const line of friendListLines(kind, many, 'add')) {
        expect(Buffer.byteLength(line) + 2).toBeLessThan(512)
      }
    }
  })

  it('loses nobody in the splitting', () => {
    const many = Array.from({ length: 200 }, (_, i) => `friend${i}`)
    const sent = friendListLines('WATCH', many, 'add')
      .flatMap((line) => line.slice('WATCH '.length).split(' '))
      .map((token) => token.slice(1))
    expect(sent).toEqual(many)
  })
})
