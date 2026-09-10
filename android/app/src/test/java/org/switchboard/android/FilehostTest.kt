package org.switchboard.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.Filehost
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * Uploading a file, against a real HTTP server.
 *
 * `draft/filehost` is the only file transfer in IRC that works through a NAT.
 * The desktop has had it since it had a file picker; the phone had no attach
 * button at all. No public network I could reach advertises the token, so the
 * server here is a real one standing in for one — everything short of that
 * passes whether the bytes are sent or not.
 */
class FilehostTest {

    private var server: ServerSocket? = null
    private val received = mutableMapOf<String, String>()
    private var body = ByteArray(0)

    @After
    fun stop() {
        runCatching { server?.close() }
        server = null
    }

    /**
     * A filehost that records what it was sent and answers as the draft says.
     *
     * Raw sockets rather than a library: `com.sun.net.httpserver` is not on the
     * Android unit-test classpath, and speaking the four lines of HTTP this
     * needs makes the test explicit about the bytes anyway.
     */
    private fun listening(
        status: String = "201 Created",
        location: String? = "/files/abc123/cat.png"
    ): String {
        val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        server = socket

        thread(isDaemon = true) {
            runCatching {
                socket.accept().use { client ->
                    val input = client.getInputStream()

                    // Request line and headers, to the blank line
                    val head = StringBuilder()
                    while (!head.endsWith("\r\n\r\n")) {
                        val byte = input.read()
                        if (byte == -1) return@use
                        head.append(byte.toChar())
                    }

                    val lines = head.toString().split("\r\n")
                    received["method"] = lines.first().substringBefore(' ')
                    for (line in lines.drop(1)) {
                        val name = line.substringBefore(':', "")
                        if (name.isNotEmpty()) received[name] = line.substringAfter(": ", "")
                    }

                    val length = received.entries
                        .firstOrNull { it.key.equals("Content-Length", ignoreCase = true) }
                        ?.value?.trim()?.toIntOrNull() ?: 0
                    body = ByteArray(length)
                    var read = 0
                    while (read < length) {
                        val got = input.read(body, read, length - read)
                        if (got <= 0) break
                        read += got
                    }

                    val response = buildString {
                        append("HTTP/1.1 $status\r\n")
                        location?.let { append("Location: $it\r\n") }
                        append("Content-Length: 0\r\n")
                        append("Connection: close\r\n\r\n")
                    }
                    client.getOutputStream().write(response.toByteArray())
                    client.getOutputStream().flush()
                }
            }
        }

        return "http://127.0.0.1:${socket.localPort}/upload"
    }

    @Test
    fun `sends the bytes and returns the link the filehost gave`() {
        val endpoint = listening()
        val content = "not really a picture".toByteArray()

        val link = Filehost.upload(
            endpoint = endpoint,
            bytes = content.inputStream(),
            length = content.size.toLong(),
            fileName = "cat.png",
            contentType = "image/png"
        )

        assertEquals("POST", received["method"])
        assertEquals("image/png", received["Content-Type"])
        assertEquals("attachment; filename=\"cat.png\"", received["Content-Disposition"])
        assertEquals(String(content), String(body))

        // Relative, as the draft allows — and a relative one pasted into a
        // channel is a link to nothing
        assertEquals("http://127.0.0.1:${server!!.localPort}/files/abc123/cat.png", link)
    }

    @Test
    fun `never sends the account password over plain http`() {
        val endpoint = listening()
        val content = "x".toByteArray()

        Filehost.upload(
            endpoint = endpoint,
            bytes = content.inputStream(),
            length = content.size.toLong(),
            fileName = "a.txt",
            contentType = "text/plain",
            account = "kara",
            password = "hunter2"
        )

        assertNull(
            "the upload authenticates with Basic, which over http hands the " +
                "password to anyone on the path",
            received["Authorization"]
        )
    }

    @Test
    fun `keeps a filename with a space in it in one piece`() {
        val endpoint = listening()
        val content = "x".toByteArray()

        Filehost.upload(
            endpoint = endpoint,
            bytes = content.inputStream(),
            length = content.size.toLong(),
            fileName = "holiday photo.jpg",
            contentType = "image/jpeg"
        )

        // Unquoted, the header ends at the space and the name is lost
        assertEquals("attachment; filename=\"holiday photo.jpg\"", received["Content-Disposition"])
    }

    @Test
    fun `says what the filehost said when it refuses`() {
        val endpoint = listening(status = "413 Payload Too Large", location = null)
        val content = "x".toByteArray()

        val refusal = runCatching {
            Filehost.upload(
                endpoint = endpoint,
                bytes = content.inputStream(),
                length = content.size.toLong(),
                fileName = "big.bin",
                contentType = "application/octet-stream"
            )
        }.exceptionOrNull()

        assertTrue("a refusal is worth showing", refusal is Filehost.Refused)
        assertTrue(refusal!!.message!!.contains("413"))
    }

    @Test
    fun `refuses an answer with nowhere to find the file`() {
        val endpoint = listening(location = null)
        val content = "x".toByteArray()

        val refusal = runCatching {
            Filehost.upload(
                endpoint = endpoint,
                bytes = content.inputStream(),
                length = content.size.toLong(),
                fileName = "a.txt",
                contentType = "text/plain"
            )
        }.exceptionOrNull()

        assertTrue(refusal is Filehost.Refused)
    }
}
