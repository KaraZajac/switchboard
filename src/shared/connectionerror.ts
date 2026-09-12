/**
 * What went wrong reaching a server, in words somebody can act on.
 *
 * A failed TLS handshake arrives as whatever the platform's own library calls
 * it — `ERR_TLS_CERT_ALTNAME_INVALID` on the desktop, "No subjectAltNames on
 * the certificate match" on the phone. Both were shown to the user verbatim.
 * They are accurate and they are not English, and the one they describe is the
 * failure a person most needs to understand: a certificate that does not match
 * the address is what being intercepted looks like.
 *
 * So the three that mean something get a sentence, and everything else is
 * passed through untouched — inventing a friendly phrase for an error nobody
 * has read yet is how a client ends up explaining the wrong thing.
 *
 * Both clients say the same sentence, because it is the same event and the
 * person is the same person.
 */

export type Problem =
  /** The certificate is for some other address */
  | 'wrong-host'
  /** Signed by somebody this device does not trust */
  | 'untrusted'
  /** Trusted and matching, but out of date */
  | 'expired'
  /** Anything else, including every non-TLS failure */
  | 'other'

/** Which of the failures we have something to say about this is */
export function problemFrom(raw: string | null | undefined): Problem {
  const text = (raw ?? '').toLowerCase()
  if (text.length === 0) return 'other'

  // Node, then Android. Each platform has more than one phrasing depending on
  // which layer noticed.
  if (
    text.includes('altname') ||
    text.includes('hostname/ip does not match') ||
    text.includes('subject alternative dns name') ||
    text.includes('no subjectaltnames')
  ) {
    return 'wrong-host'
  }

  if (
    text.includes('self_signed') ||
    text.includes('self signed') ||
    text.includes('unable_to_verify_leaf_signature') ||
    text.includes('unable_to_get_issuer') ||
    text.includes('trust anchor for certification path not found')
  ) {
    return 'untrusted'
  }

  if (text.includes('cert_has_expired') || text.includes('certificate expired')) {
    return 'expired'
  }

  return 'other'
}

/**
 * The sentence to show.
 *
 * "Nothing was sent" is the part that matters and it is true on both clients:
 * the handshake is checked before a single byte of registration goes out, so a
 * refused certificate never saw the password.
 */
export function connectionProblem(raw: string | null | undefined, host: string): string {
  switch (problemFrom(raw)) {
    case 'wrong-host':
      return `The certificate ${host} presented is for a different address. This may not be the server you meant — nothing was sent.`
    case 'untrusted':
      return `The certificate ${host} presented is signed by an authority this device does not trust. Nothing was sent.`
    case 'expired':
      return `The certificate ${host} presented has expired. Nothing was sent.`
    default:
      return raw?.trim() || 'Could not connect'
  }
}
