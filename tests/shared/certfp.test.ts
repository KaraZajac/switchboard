import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { readCertificate, certificateProblem, certificateBody } from '../../src/shared/certfp'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/certfp.json'), 'utf8')
) as {
  certificate: string
  privateKey: string
  fingerprint: string
  cases: {
    name: string
    pem: string
    hasCertificate: boolean
    hasKey: boolean
    problem: string | null
  }[]
}

describe('shared client-certificate corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const read = readCertificate(c.pem)
      expect(read !== null).toBe(c.hasCertificate && c.hasKey)
      expect(certificateProblem(c.pem)).toBe(c.problem)
    })
  }

  it('keeps the two blocks apart whichever order they came in', () => {
    const both = readCertificate(`${corpus.certificate}\n${corpus.privateKey}`)
    const swapped = readCertificate(`${corpus.privateKey}\n${corpus.certificate}`)

    expect(both).toEqual(swapped)
    expect(both?.certificate).toContain('BEGIN CERTIFICATE')
    expect(both?.privateKey).toContain('PRIVATE KEY')
    expect(both?.certificate).not.toContain('PRIVATE KEY')
  })

  it('computes the fingerprint a network asks for', () => {
    // The same number openssl prints for this certificate, which is what the
    // user has to hand to NickServ
    const der = Buffer.from(certificateBody(corpus.certificate), 'base64')
    expect(createHash('sha256').update(der).digest('hex')).toBe(corpus.fingerprint)
  })
})
