/**
 * The pairing payload a desktop shows and a phone scans.
 *
 * A ticket alone is not enough to pair — the six-digit code has to be typed as
 * well, which is what stops a ticket someone glimpsed from being useful. But a
 * QR code is not glimpsed, it is scanned from the screen in front of you, so it
 * can safely carry both and turn pairing into one action instead of three.
 *
 * Kept in `shared` because the Android client parses exactly this.
 */

export const PAIRING_SCHEME = 'switchboard'
export const PAIRING_HOST = 'pair'

export interface PairingPayload {
  ticket: string
  code: string | null
}

/**
 * How the QR is drawn.
 *
 * `scale` is pixels per module, and it is the only number that matters to a
 * phone camera: a module has to cover several sensor pixels after the
 * picture has been scaled down for analysis. The code used to be drawn 160
 * pixels wide whatever it held, and a real ticket makes a code of some sixty
 * modules a side — under three pixels each, which a camera across a desk
 * cannot resolve. So the width follows the content instead. Error
 * correction stays at the library's default (M): a QR is read off the screen
 * in front of you, and the extra modules of a higher level would cost more
 * than the damage tolerance is worth.
 */
export const QR_PIXELS_PER_MODULE = 6
export const QR_QUIET_MODULES = 2

/** Build the URI a desktop encodes into its QR code. */
export function encodePairingUri(ticket: string, code: string | null): string {
  const params = new URLSearchParams({ ticket })
  if (code) params.set('code', code)
  return `${PAIRING_SCHEME}://${PAIRING_HOST}?${params.toString()}`
}

/**
 * Read whatever the phone scanned or the user pasted.
 *
 * Accepts the URI form and a bare ticket, because a ticket is what earlier
 * builds put in the QR and what someone copying by hand will paste.
 */
export function parsePairingInput(input: string): PairingPayload | null {
  const text = input.trim()
  if (text.length === 0) return null

  if (text.toLowerCase().startsWith(`${PAIRING_SCHEME}://`)) {
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return null
    }
    const ticket = parsed.searchParams.get('ticket')?.trim()
    if (!ticket) return null
    return { ticket, code: parsed.searchParams.get('code')?.trim() || null }
  }

  // A bare ticket. Anything carrying a URI scheme is some other app's link and
  // would fail much later with nothing to point at; a sentence is not a ticket
  // either.
  if (/\s/.test(text)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null
  return { ticket: text, code: null }
}
