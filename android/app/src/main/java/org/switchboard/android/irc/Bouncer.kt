package org.switchboard.android.irc

/**
 * Networks a bouncer holds on your behalf.
 *
 * The Kotlin twin of `src/shared/bouncer.ts`; `tests/fixtures/bouncer.json`
 * holds the two to the same answers, and those cases are what a real soju
 * actually sent rather than what the spec says it should.
 *
 * `soju.im/bouncer-networks`. A bouncer stays connected to several networks
 * and a client binds one connection to each, so what a person thinks of as
 * "my networks" lives on the bouncer rather than in this client's own list.
 */
object Bouncer {

    data class Network(
        val id: String,
        /** What to call it. Falls back to the host, which is what soju shows. */
        val name: String,
        val host: String,
        val port: Int,
        val tls: Boolean,
        val nickname: String,
        val state: String,
        /** Why it is not connected, when the bouncer says */
        val error: String?
    )

    private val EMPTY = Network("", "", "", 6697, true, "", "disconnected", null)

    /** Values escape `;` and the rest the way IRCv3 escapes tag values */
    private fun unescape(value: String): String {
        val out = StringBuilder(value.length)
        var i = 0
        while (i < value.length) {
            val c = value[i]
            if (c != '\\' || i + 1 >= value.length) {
                out.append(c)
                i++
                continue
            }
            when (val next = value[i + 1]) {
                ':' -> out.append(';')
                's' -> out.append(' ')
                'r' -> out.append('\r')
                'n' -> out.append('\n')
                else -> out.append(next)
            }
            i += 2
        }
        return out.toString()
    }

    /**
     * Read the attribute list off a `BOUNCER NETWORK` line.
     *
     * A null value means the attribute is being *removed*, which is a
     * different thing from being set to nothing — and is why splitting on `=`
     * and taking the second half is wrong here.
     */
    fun attributes(text: String): Map<String, String?> {
        val out = LinkedHashMap<String, String?>()
        if (text.isEmpty()) return out

        var piece = StringBuilder()
        val pieces = mutableListOf<String>()
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '\\' && i + 1 < text.length) {
                piece.append(c).append(text[i + 1])
                i += 2
                continue
            }
            if (c == ';') {
                pieces.add(piece.toString())
                piece = StringBuilder()
                i++
                continue
            }
            piece.append(c)
            i++
        }
        pieces.add(piece.toString())

        for (entry in pieces) {
            if (entry.isEmpty()) continue
            val at = entry.indexOf('=')
            if (at == -1) {
                out[unescape(entry)] = null
            } else {
                out[unescape(entry.substring(0, at))] = unescape(entry.substring(at + 1))
            }
        }
        return out
    }

    /**
     * A network, from the attributes a bouncer sent for it.
     *
     * [previous] is what was already known, because a bouncer may send only
     * what changed — `BOUNCER NETWORK 1 state=connected` after a full listing.
     */
    fun networkFrom(id: String, attributes: Map<String, String?>, previous: Network? = null): Network {
        val base = previous ?: EMPTY.copy(id = id)

        fun read(key: String, fallback: String): String =
            if (attributes.containsKey(key)) attributes[key].orEmpty() else fallback

        val host = read("host", base.host)
        val port = read("port", base.port.toString()).toIntOrNull()?.takeIf { it > 0 } ?: base.port

        return Network(
            id = id,
            host = host,
            port = port,
            tls = if (attributes.containsKey("tls")) attributes["tls"] == "1" else base.tls,
            nickname = read("nickname", base.nickname),
            state = read("state", base.state),
            // A name the bouncer has not given is the host, which is what it shows
            name = read("name", base.name).ifEmpty { host.ifEmpty { base.name } },
            error = if (attributes.containsKey("error")) attributes["error"] else base.error
        )
    }

    /** Whether a network line says this one is gone */
    fun isRemoval(attributes: Map<String, String?>): Boolean = attributes.containsKey("*")

    /**
     * Whether the thing we are connected to is a bouncer.
     *
     * It matters for more than display. Switchboard keeps one device on a
     * network at a time, because two connections under one nick collide — but a
     * bouncer is built to multiplex, and holding the phone off one because the
     * desktop is attached gives up the exact thing the bouncer was for.
     *
     * Two signals, either sufficient. `BOUNCER` in ISUPPORT is what soju and
     * Switchboard both advertise; the `soju.im/bouncer-networks` capability is
     * what a bouncer offers when it has networks to hand out. A bouncer that
     * says neither is indistinguishable from a server and is treated as one,
     * which is the safe way round: the cost of being wrong here is a nick
     * collision.
     */
    fun isBouncer(isupport: Map<String, String>, capabilities: Collection<String>): Boolean =
        isupport.containsKey("BOUNCER") || capabilities.contains("soju.im/bouncer-networks")
}
