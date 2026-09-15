package org.switchboard.android.irc

/**
 * The addresses a network can be reached at.
 *
 * The Kotlin twin of `src/shared/addresses.ts`; `tests/fixtures/addresses.json`
 * holds the two to the same answers.
 *
 * Written as `host`, `host:6667`, or `host:+6697` — the leading `+` for TLS is
 * the convention mIRC and HexChat use. A port written without one is plain,
 * for the same reason: without that rule there is no way to say "this one is
 * not encrypted" on a network whose primary is. A bare hostname inherits both
 * from the network. IPv6 goes in brackets: `[2001:db8::1]:6697`.
 */
object Addresses {

    data class Address(val host: String, val port: Int, val tls: Boolean)

    private val BRACKETED = Regex("""^\[([^]]+)](?::(\+?)(\d+))?$""")

    /** Read one written address, taking what was left out from the network */
    fun parse(text: String, port: Int, tls: Boolean): Address? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null

        BRACKETED.matchEntire(trimmed)?.let { m ->
            val (host, secure, written) = m.destructured
            if (written.isEmpty()) return Address(host, port, tls)
            return Address(host, written.toInt(), secure == "+")
        }

        // A bare IPv6 address has more than one colon and no port
        if (trimmed.count { it == ':' } > 1) return Address(trimmed, port, tls)

        val host = trimmed.substringBefore(':')
        if (host.isEmpty()) return null
        if (!trimmed.contains(':')) return Address(host, port, tls)

        val written = trimmed.substringAfter(':')
        val secure = written.startsWith("+")
        val parsed = (if (secure) written.drop(1) else written).toIntOrNull() ?: return null
        if (parsed !in 1..65535) return null

        return Address(host, parsed, secure)
    }

    /** Every address to try, the network's own first, without repeats */
    fun forConfig(config: ServerConfig): List<Address> {
        val first = Address(config.host, config.port, config.tls)
        val out = mutableListOf(first)
        val seen = mutableSetOf(key(first))

        for (written in config.altAddresses) {
            val address = parse(written, config.port, config.tls) ?: continue
            if (!seen.add(key(address))) continue
            out.add(address)
        }

        return out
    }

    /**
     * Which address a given attempt should use.
     *
     * Round-robin rather than giving up at the end: a network wholly down is
     * on a backoff anyway, and coming round again is how a client notices the
     * primary has returned.
     */
    fun forAttempt(config: ServerConfig, attempt: Int): Address {
        val all = forConfig(config)
        return all[if (attempt <= 0) 0 else attempt % all.size]
    }

    private fun key(a: Address) = "${a.host.lowercase()}:${a.port}:${a.tls}"
}
