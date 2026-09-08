package org.switchboard.android

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.switchboard.android.pairing.Pairing
import org.switchboard.android.pairing.QrScanner

/**
 * Reading the desktop's QR off a camera frame.
 *
 * Real encoded images rather than hand-made bitmaps, because the interesting
 * failures are in the middle: a dark-theme QR that is light-on-dark, a padded
 * buffer whose row stride exceeds the frame width, a frame with nothing in it.
 */
class QrScannerTest {

    private val scanner = QrScanner()

    /** A QR of [text], rendered as an 8-bit luminance plane like the camera's */
    private fun frame(
        text: String,
        size: Int = 480,
        inverted: Boolean = false,
        rowStride: Int = size
    ): Triple<ByteArray, Int, Int> {
        val matrix = QRCodeWriter().encode(
            text,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2)
        )

        val data = ByteArray(rowStride * size)
        for (y in 0 until size) {
            for (x in 0 until size) {
                val dark = matrix.get(x, y)
                val value = if (dark != inverted) 0 else 255
                data[y * rowStride + x] = value.toByte()
            }
        }
        return Triple(data, size, size)
    }

    /** What the analyzer does after copying the plane out, stride removed */
    private fun decode(text: String, inverted: Boolean = false): String? {
        val (data, w, h) = frame(text, inverted = inverted)
        return scanner.decodeLuminance(data, w, h)
    }

    @Test
    fun `reads a pairing URI back exactly`() {
        val uri = Pairing.encode("endpointabcdef0123456789", "482915")
        assertEquals(uri, decode(uri))

        val payload = Pairing.parse(decode(uri)!!)
        assertEquals("endpointabcdef0123456789", payload?.ticket)
        assertEquals("482915", payload?.code)
    }

    @Test
    fun `reads a full-length ticket, which is what a real one looks like`() {
        // An iroh ticket is long; a QR of it is dense, and dense is where a
        // decoder gives up first
        val ticket = "endpoint" + "abcdefghijklmnopqrstuvwxyz234567".repeat(5)
        val uri = Pairing.encode(ticket, "000123")

        val payload = Pairing.parse(decode(uri) ?: error("did not decode"))
        assertEquals(ticket, payload?.ticket)
        assertEquals("000123", payload?.code)
    }

    @Test
    fun `reads a code shown light-on-dark`() {
        // The desktop draws its QR dark-on-white, but a phone camera pointed at
        // a dark-themed screen, or a photo of one, comes back inverted
        val uri = Pairing.encode("endpointinverted", "112233")
        assertEquals(uri, decode(uri, inverted = true))
    }

    @Test
    fun `survives a padded buffer whose stride exceeds the width`() {
        // CameraX pads rows on plenty of devices. Ignoring the stride shears
        // the image into something no decoder recognises.
        val uri = Pairing.encode("endpointpadded", "445566")
        val size = 480
        val stride = size + 64
        val (padded, _, _) = frame(uri, size = size, rowStride = stride)

        // Copy out exactly as the analyzer does
        val packed = ByteArray(size * size)
        for (y in 0 until size) {
            System.arraycopy(padded, y * stride, packed, y * size, size)
        }
        assertEquals(uri, scanner.decodeLuminance(packed, size, size))
    }

    @Test
    fun `returns nothing for a frame with no code in it`() {
        // The normal case while someone lines the camera up
        val blank = ByteArray(320 * 240) { 200.toByte() }
        assertNull(scanner.decodeLuminance(blank, 320, 240))

        val noise = ByteArray(320 * 240) { ((it * 37) % 256).toByte() }
        assertNull(scanner.decodeLuminance(noise, 320, 240))
    }

    @Test
    fun `refuses a frame smaller than it claims to be`() {
        assertNull(scanner.decodeLuminance(ByteArray(10), 320, 240))
        assertNull(scanner.decodeLuminance(ByteArray(0), 0, 0))
    }

    @Test
    fun `keeps working after a frame it could not read`() {
        // The reader is reused across frames, and most frames are misses
        val uri = Pairing.encode("endpointaftermiss", "778899")
        repeat(3) { assertNull(scanner.decodeLuminance(ByteArray(320 * 240), 320, 240)) }
        assertEquals(uri, decode(uri))
    }

    // ── The camera adapter's one piece of real logic ──────────────────

    @Test
    fun `copies a frame out of an unpadded buffer`() {
        val uri = Pairing.encode("endpointunpadded", "111111")
        val size = 480
        val (data, _, _) = frame(uri, size = size)

        val copied = scanner.luminanceOf(java.nio.ByteBuffer.wrap(data), size, size, size)!!
        assertEquals(uri, scanner.decodeLuminance(copied, size, size))
    }

    @Test
    fun `copies a frame out of a padded buffer, dropping the padding`() {
        // CameraX pads rows on plenty of devices. This is the line that turns a
        // readable code into a sheared mess when it is wrong, and the camera is
        // the one part of the scanner a unit test cannot drive — so drive this.
        val uri = Pairing.encode("endpointpaddedbuffer", "222222")
        val size = 480
        val stride = size + 96
        val (padded, _, _) = frame(uri, size = size, rowStride = stride)

        val copied = scanner.luminanceOf(java.nio.ByteBuffer.wrap(padded), stride, size, size)!!
        assertEquals(size * size, copied.size)
        assertEquals(uri, scanner.decodeLuminance(copied, size, size))
    }

    @Test
    fun `does not read past the end of a short buffer`() {
        // A truncated frame is a dropped frame, not a crash
        val size = 64
        val short = java.nio.ByteBuffer.wrap(ByteArray(size * 4))
        val copied = scanner.luminanceOf(short, size, size, size)
        assertEquals(size * size, copied?.size)
    }

    @Test
    fun `refuses a frame with no dimensions`() {
        assertNull(scanner.luminanceOf(java.nio.ByteBuffer.wrap(ByteArray(4)), 0, 0, 0))
    }
}
