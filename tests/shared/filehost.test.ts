import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { filehostUrl, mayAuthenticate, uploadedUrl } from '../../src/shared/filehost'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/filehost.json'), 'utf8')
) as {
  where: { name: string; isupport: Record<string, string>; url: string | null }[]
  auth: { url: string; mayAuthenticate: boolean }[]
  resolved: { name: string; location: string; base: string; url: string | null }[]
}

describe('shared filehost corpus', () => {
  for (const c of corpus.where) {
    it(`finds where uploads go: ${c.name}`, () => {
      expect(filehostUrl(c.isupport)).toBe(c.url)
    })
  }

  for (const c of corpus.auth) {
    it(`decides whether to send the password: ${c.url}`, () => {
      expect(mayAuthenticate(c.url)).toBe(c.mayAuthenticate)
    })
  }

  for (const c of corpus.resolved) {
    it(`resolves the answer: ${c.name}`, () => {
      expect(uploadedUrl(c.location, c.base)).toBe(c.url)
    })
  }
})
