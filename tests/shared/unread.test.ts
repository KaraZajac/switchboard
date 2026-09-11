import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  rowLook,
  rowBadge,
  railLook,
  badgeLabel,
  badgeDiameter,
  type ConversationState
} from '@shared/unread'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/unread.json'), 'utf8')) as {
  rows: {
    name: string; unread: number; mentions: number; muted: boolean; selected: boolean
    look: string; badge: { count: number; muted: boolean } | null
  }[]
  badges: { name: string; count: number; label: string; diameter: number }[]
  rails: {
    name: string; conversations: ConversationState[]; active: boolean; serverMuted: boolean
    chip: string; mentions: number; mentionsMuted: boolean
  }[]
}

describe('how a conversation reads', () => {
  for (const c of corpus.rows) {
    it(c.name, () => {
      expect(rowLook(c, c.selected)).toBe(c.look)
      expect(rowBadge(c)).toEqual(c.badge)
    })
  }
})

describe('how a network reads on the rail', () => {
  for (const c of corpus.rails) {
    it(c.name, () => {
      const look = railLook(c.conversations, { active: c.active, serverMuted: c.serverMuted })
      expect(look.chip).toBe(c.chip)
      expect(look.mentions).toBe(c.mentions)
      expect(look.mentionsMuted).toBe(c.mentionsMuted)
    })
  }

  it('never describes a badge that is not there', () => {
    for (const c of corpus.rails) {
      const look = railLook(c.conversations, { active: c.active, serverMuted: c.serverMuted })
      if (look.mentions === 0) expect(look.mentionsMuted).toBe(false)
    }
  })

  it('the network you are looking at keeps its tall chip whatever is unread', () => {
    const busy = [{ name: '#lounge', unread: 9, mentions: 0, muted: false }]
    expect(railLook(busy, { active: true, serverMuted: false }).chip).toBe('tall')
    expect(railLook(busy, { active: true, serverMuted: true }).chip).toBe('tall')
  })
})

describe('what a count reads as', () => {
  for (const c of corpus.badges) {
    it(c.name, () => {
      expect(badgeLabel(c.count)).toBe(c.label)
      expect(badgeDiameter(c.count)).toBe(c.diameter)
    })
  }

  it('is always a circle wide enough for what is in it', () => {
    for (let n = 0; n < 500; n++) {
      expect(badgeDiameter(n)).toBeGreaterThanOrEqual(badgeLabel(n).length * 7)
    }
  })
})
