import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseIrcUrl, type IrcLink } from '../../src/shared/ircurl'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/ircurl.json'), 'utf8')) as {
  cases: { name: string; url: string; link: IrcLink | null }[]
}

describe('what an irc:// link means', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(parseIrcUrl(c.url)).toEqual(c.link))
  }
})
