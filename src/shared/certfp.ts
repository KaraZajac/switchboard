/**
 * Logging in with a certificate instead of a password.
 *
 * SASL EXTERNAL is the one mechanism where nothing secret crosses the wire at
 * all: the TLS handshake already proved who you are, and the server looks up
 * the fingerprint of the certificate you presented. Libera, OFTC and most of
 * the rest call it CertFP, and it is the strongest thing they offer.
 *
 * Both clients implemented the mechanism — the desktop's server dialog has
 * always listed "EXTERNAL (client cert)" — and neither had anywhere to put a
 * certificate, so the connection presented none and the server had nothing to
 * look up. Choosing it could only ever end in 904, with nothing on screen to
 * say why.
 *
 * A certificate is a credential: it is kept where the passwords are kept, and
 * stripped on the way to a paired device by the same rule.
 *
 * Only the PEM reading lives here, because it is the part both clients have to
 * agree on. The fingerprint is three lines of whichever platform's crypto, and
 * neither platform should be handed a hand-rolled one.
 */

/** A certificate and its key, as the two PEM blocks a connection needs */
export interface ClientCertificate {
  certificate: string
  privateKey: string
}

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----\r?\n([\s\S]*?)-----END \1-----/g

/**
 * Pull the certificate and key out of whatever was pasted.
 *
 * One file holding both is what every guide tells people to make and what
 * `openssl req -x509 -newkey` produces when asked for one; two files pasted one
 * after the other come out the same way. Order is not assumed — a key is
 * whichever block says it is a key — because the two orders are equally common
 * and getting it wrong would be silent.
 */
export function readCertificate(pem: string | null | undefined): ClientCertificate | null {
  if (!pem) return null

  let certificate: string | null = null
  let privateKey: string | null = null

  for (const match of pem.matchAll(BLOCK)) {
    const whole = match[0]
    const label = match[1]
    if (label === 'CERTIFICATE' && certificate === null) certificate = whole
    else if (label.endsWith('PRIVATE KEY') && privateKey === null) privateKey = whole
  }

  if (certificate === null || privateKey === null) return null
  return { certificate, privateKey }
}

/** What is wrong with what was pasted, in a sentence someone can act on */
export function certificateProblem(pem: string | null | undefined): string | null {
  if (!pem || pem.trim().length === 0) return null

  const labels = Array.from(pem.matchAll(BLOCK), (match) => match[1])
  if (labels.length === 0) {
    return 'That does not look like a PEM file — it should have -----BEGIN lines in it.'
  }
  if (!labels.includes('CERTIFICATE')) {
    return 'That has a key in it but no certificate. Both belong in the same box.'
  }
  if (!labels.some((label) => label.endsWith('PRIVATE KEY'))) {
    return 'That has a certificate in it but no private key. Both belong in the same box.'
  }
  return null
}

/** The certificate's base64 body, which is the DER a fingerprint is taken of */
export function certificateBody(certificate: string): string {
  return certificate
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '')
}
