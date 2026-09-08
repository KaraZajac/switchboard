package org.switchboard.android.pairing

import androidx.camera.core.ImageProxy
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * Finding a QR code in a camera frame.
 *
 * ZXing's core rather than a scanner library or ML Kit: it is pure Java, about
 * half a megabyte, and needs no Play Services — which matters for a client
 * people sideload. Decoding a frame is the whole of it, so the wrapping is
 * small enough to keep honest.
 */
class QrScanner {

    private val reader = QRCodeReader()

    private val hints = mapOf(
        // The pairing QR is dense; spending a little longer per frame beats
        // asking someone to hold the phone still for another second.
        DecodeHintType.TRY_HARDER to true,
        DecodeHintType.CHARACTER_SET to "UTF-8"
    )

    /**
     * Decode one camera frame, or return null.
     *
     * Most frames contain no code at all — that is the normal case while
     * someone is lining the camera up, not an error worth reporting.
     */
    fun decode(image: ImageProxy): String? {
        val plane = image.planes.firstOrNull() ?: return null
        val luminance = luminanceOf(plane.buffer, plane.rowStride, image.width, image.height)
            ?: return null
        return decodeLuminance(luminance, image.width, image.height)
    }

    /**
     * Decode a plane of brightness values.
     *
     * Separated from the camera so it can be tested against real images: the
     * `ImageProxy` plumbing above is the part that cannot run off-device, so it
     * is kept to as few lines as possible.
     */
    fun decodeLuminance(data: ByteArray, width: Int, height: Int): String? {
        if (width <= 0 || height <= 0 || data.size < width * height) return null
        val source = PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)

        // Try the frame as it is, then inverted: a QR shown on a dark-themed
        // screen is light-on-dark, which the plain pass will not find.
        for (candidate in listOf(source, source.invert())) {
            try {
                return reader.decode(BinaryBitmap(HybridBinarizer(candidate)), hints).text
            } catch (e: NotFoundException) {
                // No code in this frame; try the next form
            } catch (e: Exception) {
                // A misread is as uninteresting as an empty frame
            } finally {
                reader.reset()
            }
        }
        return null
    }

    /**
     * Copy out the frame's brightness plane, honouring the row stride.
     *
     * CameraX hands over YUV_420_888, whose first plane is luminance — exactly
     * what a QR decoder wants, so there is no colour conversion to do. The row
     * stride can exceed the width when the buffer is padded, and ignoring that
     * shears the image into something no decoder will recognise — which is why
     * this is tested directly rather than only through the camera.
     */
    internal fun luminanceOf(
        buffer: java.nio.ByteBuffer,
        rowStride: Int,
        width: Int,
        height: Int
    ): ByteArray? {
        if (width <= 0 || height <= 0) return null

        val data = ByteArray(width * height)
        if (rowStride == width) {
            buffer.get(data, 0, minOf(data.size, buffer.remaining()))
            return data
        }

        val row = ByteArray(rowStride)
        var offset = 0
        for (y in 0 until height) {
            if (buffer.remaining() < rowStride) break
            buffer.get(row, 0, rowStride)
            System.arraycopy(row, 0, data, offset, width)
            offset += width
        }
        return data
    }
}
