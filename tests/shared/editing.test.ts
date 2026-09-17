import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { canEdit, lastEditable, editsAllowed, type EditableMessage } from '@shared/editing'

/**
 * Which of your own messages you can still change — see `@shared/editing` and
 * the Android `Editing`, which this corpus also runs against.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/editing.json'), 'utf8')) as {
  cases: {
    name: string
    type: string
    nick: string
    deleted: boolean
    me: string
    caps: string[]
    can: boolean
  }[]
  last: {
    name: string
    me: string
    caps: string[]
    messages: EditableMessage[]
    picked: string | null
  }[]
}

describe('whether a message can be edited', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const message = { id: 'm', nick: c.nick, type: c.type, deleted: c.deleted }
      expect(canEdit(message, c.me, c.caps)).toBe(c.can)
    })
  }
})

describe('the one the Up key opens', () => {
  for (const c of corpus.last) {
    it(c.name, () => {
      expect(lastEditable(c.messages, c.me, c.caps)?.id ?? null).toBe(c.picked)
    })
  }
})

describe('whether the network carries edits at all', () => {
  it('takes either spelling of the capability', () => {
    expect(editsAllowed(['draft/message-edit'])).toBe(true)
    expect(editsAllowed(['message-edit'])).toBe(true)
  })

  it('and is not fooled by one that merely looks like it', () => {
    expect(editsAllowed(['draft/message-editing'])).toBe(false)
    expect(editsAllowed(['message-redaction'])).toBe(false)
    expect(editsAllowed([])).toBe(false)
  })
})
