/**
 * A server's certificate, when nobody vouches for it.
 *
 * A private network — a friend's server, a mesh, a box at home — runs on a
 * certificate no root store has heard of, and both clients refused it flat:
 * the connection failed with a sentence about authorities and nothing to
 * press. Every other client has an answer, and it is the same one SSH gives:
 * show the fingerprint, let the user say yes to that one certificate, and
 * remember the choice. Not the whole idea of verification switched off — that
 * one certificate, by its SHA-256, so a different one presented later is
 * refused again.
 *
 * The fingerprint lives on the server's config as `trustedCertificate` and
 * travels between devices with it: it is a fact about the server, not a
 * secret. The Kotlin half is `TrustedCertificate.kt`, checked against
 * `tests/fixtures/certificate.json`.
 */

import { connectionProblem } from './connectionerror'

export interface CertificateProblem {
  /** SHA-256 of the certificate the server presented — see `formatFingerprint` */
  fingerprint: string
  /** Who it says it is for */
  subject: string | null
  /** Who signed it */
  issuer: string | null
  /** When it stops being valid, as the certificate states it */
  validTo: string | null
  /** Why it was refused, in the words of the library that refused it */
  reason: string
}

/**
 * Hex pairs joined by colons, upper case — the way OpenSSL prints one, and
 * the way a server operator writes it down for people to compare by eye.
 * Takes whatever spelling it is given: bare hex, lower case, spaces.
 */
export function formatFingerprint(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  return hex.match(/.{1,2}/g)?.join(':') ?? ''
}

/** Whether two spellings name the same certificate */
export function sameFingerprint(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false
  const left = formatFingerprint(a)
  return left.length > 0 && left === formatFingerprint(b)
}

/**
 * What to tell the user. The fingerprint — the one thing they can check —
 * is shown on a line of its own by the caller, in a typeface it can be read
 * from; sixty-four hex digits wrapped mid-pair inside a sentence cannot.
 *
 * The reason is worded by the connection-error corpus, which both clients
 * share, so "self-signed" and "for another address" read the same on both.
 */
export function certificateProblemText(problem: CertificateProblem, host: string): string {
  const who = problem.subject ? ` It says it is for ${problem.subject}.` : ''
  return `${connectionProblem(problem.reason, host)}${who} Trust it only if the fingerprint below matches what the server's operator told you.`
}

/** The fingerprint line shown under the sentence */
export function certificateFingerprintLine(problem: CertificateProblem): string {
  return `SHA-256 ${formatFingerprint(problem.fingerprint)}`
}
