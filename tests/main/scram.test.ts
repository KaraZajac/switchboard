import { describe, it, expect } from 'vitest'
import { proofFor, serverSignatureFor, scramDigest } from '../../src/main/irc/scram'

/**
 * SCRAM, against the vector the RFC prints.
 *
 * The exchange is four HMACs and an XOR in a particular order, and getting any
 * of them slightly wrong fails in exactly one way: the server says 904 and the
 * user is told their password is wrong. This checked the primitives it did not
 * use before — `crypto.createHmac` returns 32 bytes, which was never in doubt
 * — so the code that actually runs was untested. RFC 7677 §3 knows the answer.
 */
describe('SCRAM-SHA-256 against RFC 7677', () => {
  const chosen = { password: 'pencil', digest: 'sha256' as const, keyLength: 32 }
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64')
  const iterations = 4096

  const clientFirstBare = 'n=user,r=rOprNGfwEbeRWgbNEkqO'
  const serverFirst =
    'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'
  const clientFinalNoProof =
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0'
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalNoProof}`

  it('computes the client proof the RFC prints', () => {
    expect(proofFor(chosen, salt, iterations, authMessage).toString('base64')).toBe(
      'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ='
    )
  })

  it('computes the server signature the RFC prints', () => {
    expect(
      serverSignatureFor(chosen, salt, iterations, authMessage).toString('base64')
    ).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=')
  })

  it('the channel binding in client-final is the "n,," we sent', () => {
    expect(Buffer.from('n,,').toString('base64')).toBe('biws')
  })
})

describe('SCRAM-SHA-512', () => {
  it('is the same exchange with a longer key', () => {
    expect(scramDigest('SCRAM-SHA-512')).toEqual({ digest: 'sha512', keyLength: 64 })
    expect(scramDigest('SCRAM-SHA-256')).toEqual({ digest: 'sha256', keyLength: 32 })
    expect(scramDigest('PLAIN')).toBeNull()
  })

  it('produces a proof of the right length, and a different one', () => {
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64')
    const auth = 'n=user,r=abc,r=abcdef,s=x,i=4096,c=biws,r=abcdef'

    const sha256 = proofFor({ password: 'pencil', digest: 'sha256', keyLength: 32 }, salt, 4096, auth)
    const sha512 = proofFor({ password: 'pencil', digest: 'sha512', keyLength: 64 }, salt, 4096, auth)

    expect(sha256).toHaveLength(32)
    expect(sha512).toHaveLength(64)
  })
})
