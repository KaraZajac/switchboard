import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { statusTarget } from '../../src/shared/isupport'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/statusmsg.json'), 'utf8')
) as {
  cases: {
    name: string
    statusmsg: string | null
    target: string
    channel: string
    status: string | null
  }[]
}

describe('shared STATUSMSG corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(statusTarget(c.target, c.statusmsg)).toEqual({
        target: c.channel,
        status: c.status
      })
    })
  }
})
