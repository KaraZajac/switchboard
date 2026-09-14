package org.switchboard.android.irc

import java.net.URLDecoder

/**
 * What an `irc://` link means — the Kotlin half of `src/shared/ircurl.ts`,
 * checked against `tests/fixtures/ircurl.json`.
 */
object IrcUrl {

    data class Link(
        val host: String,
        val port: Int,
        val tls: Boolean,
        /** With its `#`, or null for a link to the server alone */
        val channel: String?,
        /** A person, when the link said `,isnick` */
        val nick: String?
    )

    // A `#` here is a channel, not a fragment — the one place on the web it is not
    private val SHAPE = Regex("^(ircs?)://([^/?#\\s]+)(?:/([^?\\s]*))?(?:\\?[^\\s]*)?$", RegexOption.IGNORE_CASE)
    private val HOST_PORT = Regex("^(\\[[^\\]]+\\]|[^:]+)(?::(\\d+))?$")

    fun parse(raw: String): Link? {
        val match = SHAPE.find(raw.trim()) ?: return null
        val tls = match.groupValues[1].lowercase() == "ircs"
        val authority = match.groupValues[2].substringAfter('@')
        val hostPort = HOST_PORT.find(authority) ?: return null
        val host = hostPort.groupValues[1].removePrefix("[").removeSuffix("]")
        val port = hostPort.groupValues[2].toIntOrNull() ?: if (tls) 6697 else 6667
        if (host.isEmpty() || port !in 1..65535) return null

        val path = match.groupValues[3]
        val parts = path.split(',')
        var target = URLDecoder.decode(parts[0], "UTF-8")
        val modifiers = parts.drop(1).map { it.lowercase() }
        if (target.isEmpty()) return Link(host, port, tls, null, null)
        if ("isnick" in modifiers) return Link(host, port, tls, null, target)
        if (target.first() !in "#&!+") target = "#$target"
        return Link(host, port, tls, target, null)
    }
}
