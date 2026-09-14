import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import { encodePairingUri, QR_PIXELS_PER_MODULE, QR_QUIET_MODULES } from '../../src/shared/pairing'

/**
 * The pairing QR has to be readable by a phone across a desk.
 *
 * It used to be drawn 160 pixels wide whatever it held. A real iroh ticket
 * makes a code of some sixty modules a side, which at that width is under
 * three pixels a module — and the phone's camera, which then scales the frame
 * down again to analyse it, could not find it at all. The camera opened; the
 * code was never read. The size has to follow the content.
 */
describe('the pairing QR', () => {
  // An iroh ticket: "endpoint" and a couple of hundred base32 characters
  const ticket = 'endpoint' + 'abcdefghijklmnopqrstuvwxyz234567'.repeat(6)
  const uri = encodePairingUri(ticket, '482915')

  it('gives every module enough pixels for a camera to resolve', async () => {
    const symbol = QRCode.create(uri)
    const modules = symbol.modules.size
    const png = await QRCode.toBuffer(uri, { scale: QR_PIXELS_PER_MODULE, margin: QR_QUIET_MODULES })
    // PNG width is big-endian at byte 16 of the IHDR chunk
    const width = png.readUInt32BE(16)
    expect(width).toBe((modules + 2 * QR_QUIET_MODULES) * QR_PIXELS_PER_MODULE)
    expect(width / (modules + 2 * QR_QUIET_MODULES)).toBeGreaterThanOrEqual(4)
  })

  it('keeps a quiet zone a finder needs', () => {
    expect(QR_QUIET_MODULES).toBeGreaterThanOrEqual(2)
  })

  it('still fits a settings panel for a long ticket', () => {
    const symbol = QRCode.create(uri)
    const width = (symbol.modules.size + 2 * QR_QUIET_MODULES) * QR_PIXELS_PER_MODULE
    expect(width).toBeLessThanOrEqual(480)
  })
})
