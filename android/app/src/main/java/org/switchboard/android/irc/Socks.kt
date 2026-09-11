package org.switchboard.android.irc

/**
 * SOCKS, by hand.
 *
 * The Kotlin half of `src/shared/socks.ts`, checked against
 * `tests/fixtures/socks.json` so the two produce the same bytes.
 *
 * SOCKS5 is RFC 1928, its username/password authentication RFC 1929. SOCKS4a
 * is the older extension that added names; plain SOCKS4 cannot carry one and
 * is not offered, because resolving the name here is exactly what a proxy is
 * often there to avoid.
 */
object Socks {

    const val AUTH_NONE = 0x00
    const val AUTH_USERPASS = 0x02

    /** The proxy's way of saying it accepts none of what we offered */
    const val AUTH_REJECTED = 0xff

    /** What a proxy can be, as the shared config stores it */
    data class Settings(
        val type: String = "none",
        val host: String = "",
        val port: Int = 0,
        val username: String = "",
        val password: String = ""
    )

    /** Whether these settings name a proxy we should actually dial through */
    fun inUse(proxy: Settings?): Boolean {
        if (proxy == null) return false
        if (proxy.type != "socks5" && proxy.type != "socks4") return false
        return proxy.host.isNotBlank() && proxy.port > 0
    }

    // ── SOCKS5 ───────────────────────────────────────────────────────

    /**
     * The opening hello, listing what authentication we can do.
     *
     * "No authentication" is always offered: most proxies want none, and one
     * that does want a password picks the other.
     */
    fun greeting(hasCredentials: Boolean): ByteArray {
        val methods = if (hasCredentials) listOf(AUTH_NONE, AUTH_USERPASS) else listOf(AUTH_NONE)
        return byteArrayOf(5, methods.size.toByte(), *methods.map { it.toByte() }.toByteArray())
    }

    /**
     * Which method the proxy chose, or null while the two bytes have not both
     * arrived — a proxy may send them separately, and a reader that assumes
     * otherwise works every time until it does not.
     */
    fun readChoice(reply: ByteArray): Int? {
        if (reply.size < 2) return null
        if (reply[0].toInt() and 0xff != 5) return AUTH_REJECTED
        return reply[1].toInt() and 0xff
    }

    /** RFC 1929: a username and password, each length-prefixed */
    fun authRequest(username: String, password: String): ByteArray {
        val user = username.toByteArray(Charsets.UTF_8)
        val pass = password.toByteArray(Charsets.UTF_8)
        require(user.size <= 255 && pass.size <= 255) {
            "SOCKS5 username and password may each be at most 255 bytes"
        }
        return byteArrayOf(1, user.size.toByte(), *user, pass.size.toByte(), *pass)
    }

    /** Whether the proxy accepted the password. Null while still arriving. */
    fun readAuthReply(reply: ByteArray): Boolean? {
        if (reply.size < 2) return null
        return reply[1].toInt() == 0
    }

    /**
     * "Connect me to this host and port."
     *
     * The host goes as a name so the proxy resolves it. That is the whole
     * point over Tor — a local lookup for an onion name fails, and for an
     * ordinary host it tells the network where you are about to connect, which
     * is what the proxy was supposed to hide.
     */
    fun connect5(host: String, port: Int): ByteArray {
        val name = host.toByteArray(Charsets.UTF_8)
        require(name.isNotEmpty() && name.size <= 255) { "SOCKS5 host must be 1-255 bytes" }
        return byteArrayOf(
            5, 1, 0, 3,
            name.size.toByte(), *name,
            ((port shr 8) and 0xff).toByte(), (port and 0xff).toByte()
        )
    }

    /** What each SOCKS5 failure code means, in words someone can act on */
    val ERRORS_5 = mapOf(
        0x01 to "The proxy failed",
        0x02 to "The proxy refused the connection by its own rules",
        0x03 to "The network is unreachable from the proxy",
        0x04 to "The host is unreachable from the proxy",
        0x05 to "The server refused the connection",
        0x06 to "The connection through the proxy timed out",
        0x07 to "The proxy does not support this kind of connection",
        0x08 to "The proxy does not support this kind of address"
    )

    /**
     * @param ok null while the reply is still arriving
     * @param length how many bytes it took, so anything after it is server data
     */
    data class Reply(val ok: Boolean?, val error: String? = null, val length: Int? = null)

    /**
     * The answer to CONNECT.
     *
     * Variable length, because it echoes a bound address whose size depends on
     * its type — and the byte after it is already the IRC server talking, so
     * the length matters rather than being a detail.
     */
    fun readReply5(reply: ByteArray): Reply {
        if (reply.size < 5) return Reply(null)
        if (reply[0].toInt() and 0xff != 5) return Reply(false, "Not a SOCKS5 proxy")

        val addressLength = when (reply[3].toInt() and 0xff) {
            0x01 -> 4
            0x04 -> 16
            0x03 -> (reply[4].toInt() and 0xff) + 1
            else -> return Reply(false, "The proxy answered with an address we cannot read")
        }

        val length = 4 + addressLength + 2
        if (reply.size < length) return Reply(null)

        val status = reply[1].toInt() and 0xff
        if (status != 0) {
            return Reply(false, ERRORS_5[status] ?: "The proxy refused the connection ($status)", length)
        }
        return Reply(true, null, length)
    }

    // ── SOCKS4a ──────────────────────────────────────────────────────

    /**
     * SOCKS4a CONNECT.
     *
     * The 0.0.0.1 address is the flag: an address in that range is impossible,
     * so a SOCKS4a proxy reads it as "the name follows". A plain SOCKS4 proxy
     * tries to reach 0.0.0.1 and fails, which is the right outcome — better
     * than resolving the name here and quietly leaking the lookup.
     */
    fun connect4(host: String, port: Int, username: String = ""): ByteArray {
        val user = username.toByteArray(Charsets.UTF_8)
        val name = host.toByteArray(Charsets.UTF_8)
        require(name.isNotEmpty() && name.size <= 255) { "SOCKS4a host must be 1-255 bytes" }
        return byteArrayOf(
            4, 1,
            ((port shr 8) and 0xff).toByte(), (port and 0xff).toByte(),
            0, 0, 0, 1,
            *user, 0,
            *name, 0
        )
    }

    /** What each SOCKS4 failure code means */
    val ERRORS_4 = mapOf(
        0x5b to "The proxy refused the connection",
        0x5c to "The proxy could not reach an identd on this machine",
        0x5d to "The proxy did not recognise the user name"
    )

    /** The answer to a SOCKS4 CONNECT: always eight bytes */
    fun readReply4(reply: ByteArray): Reply {
        if (reply.size < 8) return Reply(null)
        val status = reply[1].toInt() and 0xff
        if (status == 0x5a) return Reply(true, null, 8)
        return Reply(false, ERRORS_4[status] ?: "The proxy refused the connection ($status)", 8)
    }
}
