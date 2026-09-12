package org.switchboard.android.irc

/**
 * Whether an address is somewhere on this machine or this network.
 *
 * The Kotlin half of `src/shared/privateaddress.ts`, checked against
 * `tests/fixtures/privateaddress.json`. Used wherever somebody else names an
 * address this phone would then connect to — a DCC offer, most directly.
 *
 * Answers about *addresses*: anything it cannot read as one is refused, which
 * is the safe default here and the wrong answer for a hostname.
 */
object PrivateAddress {

    fun isPrivate(address: String): Boolean {
        val host = address.trim().lowercase().removePrefix("[").removeSuffix("]")
        if (host.isEmpty()) return true
        if (':' in host) return isPrivateV6(host)

        val parts = host.split('.')
        if (parts.size != 4) return true
        val octets = parts.map { if (Regex("""^\d{1,3}$""").matches(it)) it.toInt() else -1 }
        if (octets.any { it < 0 || it > 255 }) return true

        val (a, b) = octets
        return when {
            a == 0 -> true
            a == 10 -> true
            a == 127 -> true
            a == 169 && b == 254 -> true
            a == 172 && b in 16..31 -> true
            a == 192 && b == 168 -> true
            a == 192 && b == 0 -> true
            a == 198 && (b == 18 || b == 19) -> true
            a == 198 && b == 51 -> true
            a == 203 && b == 0 -> true
            a == 100 && b in 64..127 -> true
            a >= 224 -> true
            else -> false
        }
    }

    /** Whether this is an address rather than a name */
    fun isIpLiteral(host: String): Boolean {
        val bare = host.trim().removePrefix("[").removeSuffix("]")
        if (bare.isEmpty()) return false
        if (':' in bare) return true
        return Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(bare)
    }

    private fun isPrivateV6(host: String): Boolean {
        if (host == "::" || host == "::1") return true
        Regex("""^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$""").matchEntire(host)?.let {
            return isPrivate(it.groupValues[1])
        }
        val head = host.substringBefore(':')
        if (head.isEmpty()) return true
        val first = head.toIntOrNull(16) ?: return true
        return (first and 0xfe00) == 0xfc00 || // unique local
            (first and 0xffc0) == 0xfe80 ||    // link-local
            (first and 0xff00) == 0xff00       // multicast
    }
}
