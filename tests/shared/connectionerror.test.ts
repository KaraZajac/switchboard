import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { connectionProblem, problemFrom, type Problem } from '@shared/connectionerror'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/connectionerror.json'), 'utf8')
) as {
  cases: { name: string; raw: string; problem: Problem }[]
  sentences: { name: string; problem: Problem; text: string }[]
}

const RAW_FOR: Record<string, string> = {
  'wrong-host': 'ERR_TLS_CERT_ALTNAME_INVALID',
  untrusted: 'SELF_SIGNED_CERT_IN_CHAIN',
  expired: 'CERT_HAS_EXPIRED'
}

describe('what a connection failure is', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(problemFrom(c.raw)).toBe(c.problem))
  }

  it('says nothing about a failure it has not read', () => {
    expect(problemFrom(null)).toBe('other')
    expect(problemFrom(undefined)).toBe('other')
  })
})

describe('what we say about it', () => {
  for (const c of corpus.sentences) {
    it(c.name, () => {
      expect(connectionProblem(RAW_FOR[c.problem], 'irc.example.org')).toBe(c.text)
    })
  }

  /**
   * Everything we have no sentence for is passed through. Inventing a friendly
   * phrase for an error nobody has read yet is how a client ends up explaining
   * the wrong thing confidently.
   */
  it('passes an error it does not recognise through untouched', () => {
    expect(connectionProblem('ECONNREFUSED', 'irc.example.org')).toBe('ECONNREFUSED')
    expect(connectionProblem('  Socket closed  ', 'irc.example.org')).toBe('Socket closed')
  })

  it('has something to say even when given nothing', () => {
    expect(connectionProblem('', 'irc.example.org')).toBe('Could not connect')
    expect(connectionProblem(null, 'irc.example.org')).toBe('Could not connect')
  })

  /**
   * The reassurance is the point and it must be in all three — the fear a
   * certificate warning creates is "did my password just go to them?", and the
   * answer is no. Case-insensitively, because in one of the three it follows an
   * em dash rather than a full stop.
   */
  it('always says the password did not go anywhere', () => {
    for (const problem of ['wrong-host', 'untrusted', 'expired']) {
      expect(connectionProblem(RAW_FOR[problem], 'irc.example.org').toLowerCase()).toContain(
        'nothing was sent'
      )
    }
  })
})
