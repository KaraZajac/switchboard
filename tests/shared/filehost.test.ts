import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  filehostUrl,
  mayAuthenticate,
  uploadedUrl,
  contentDisposition,
  acceptsType,
  describeAccepted
} from '../../src/shared/filehost'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/filehost.json'), 'utf8')) as {
  where: { name: string; isupport: Record<string, string>; url: string | null }[]
  auth: { url: string; mayAuthenticate: boolean }[]
  resolved: { name: string; location: string; base: string; url: string | null }[]
  tls: { name: string; isupport: Record<string, string>; overTls: boolean; url: string | null }[]
  disposition: { name: string; file: string; header: string }[]
  accept: { name: string; acceptPost: string | null; type: string; ok: boolean }[]
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

describe('refusing a filehost the connection does not vouch for', () => {
  for (const c of corpus.tls) {
    it(c.name, () => {
      expect(filehostUrl(c.isupport, { overTls: c.overTls })).toBe(c.url)
    })
  }

  it('is strict when nobody says', () => {
    // A caller that forgets should get the safe answer, not the permissive one
    expect(filehostUrl({ 'draft/FILEHOST': 'http://files.example.net/' })).toBeNull()
  })
})

describe('the name a file arrives under', () => {
  for (const c of corpus.disposition) {
    it(c.name, () => {
      expect(contentDisposition(c.file)).toBe(c.header)
    })
  }

  it('is always something an HTTP header can carry', () => {
    // Both runtimes refuse a header outside ASCII rather than guessing an
    // encoding, so this is not a nicety: a photo named in Greek did not upload
    for (const name of ['Ωmega.jpg', '写真.png', '🎉.gif', 'ünïcödé.txt']) {
      expect(contentDisposition(name)).toMatch(/^[\x20-\x7e]*$/)
    }
  })
})

describe('what the filehost said it takes', () => {
  for (const c of corpus.accept) {
    it(c.name, () => {
      expect(acceptsType(c.acceptPost, c.type)).toBe(c.ok)
    })
  }

  it('names them, so a refusal is something to act on', () => {
    expect(describeAccepted('image/*, video/*')).toBe('image/*, video/*')
    expect(describeAccepted('*/*')).toBeNull()
    expect(describeAccepted(null)).toBeNull()
  })
})
