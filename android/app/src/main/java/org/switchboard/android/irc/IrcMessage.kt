package org.switchboard.android.irc

/**
 * IRC line parsing and serialising, matching `src/main/irc/parser.ts` and
 * `serializer.ts` on the desktop.
 *
 * The two implementations are held together by `tests/fixtures/irc-messages.json`,
 * which both test suites read. When the phone takes over a connection the desktop
 * was holding, it has to see the same messages the desktop would have seen — a
 * parser that disagrees about, say, an empty trailing parameter is a bug the user
 * only meets during a failover, which is the worst possible time.
 */

data class IrcSource(val nick: String, val user: String?, val host: String?)

data class IrcMessage(
    val tags: Map<String, String?> = emptyMap(),
    val prefix: String? = null,
    val source: IrcSource? = null,
    val command: String,
    val params: List<String> = emptyList()
) {
    /** Parameter at [index], or null — most handlers want this, not an exception */
    fun param(index: Int): String? = params.getOrNull(index)

    val nick: String? get() = source?.nick

    fun tag(key: String): String? = tags[key]

    /** A tag that is present with no value reads as "" here and true on the wire */
    fun hasTag(key: String): Boolean = tags.containsKey(key)
}

class IrcParseException(message: String) : Exception(message)

private val TAG_ESCAPES = mapOf(
    "\\:" to ";",
    "\\s" to " ",
    "\\\\" to "\\",
    "\\r" to "\r",
    "\\n" to "\n"
)

private val TAG_UNESCAPES = mapOf(
    ';' to "\\:",
    ' ' to "\\s",
    '\\' to "\\\\",
    '\r' to "\\r",
    '\n' to "\\n"
)

object Irc {

    fun parse(rawLine: String): IrcMessage {
        var line = rawLine
        if (line.endsWith("\r\n")) line = line.dropLast(2)
        else if (line.endsWith("\n")) line = line.dropLast(1)

        var pos = 0
        var tags: Map<String, String?> = emptyMap()
        var prefix: String? = null

        if (line.getOrNull(pos) == '@') {
            val space = line.indexOf(' ', pos)
            if (space == -1) throw IrcParseException("Malformed IRC message: tags without command")
            tags = parseTags(line.substring(1, space))
            pos = space + 1
            while (line.getOrNull(pos) == ' ') pos++
        }

        if (line.getOrNull(pos) == ':') {
            val space = line.indexOf(' ', pos)
            if (space == -1) throw IrcParseException("Malformed IRC message: prefix without command")
            prefix = line.substring(pos + 1, space)
            pos = space + 1
            while (line.getOrNull(pos) == ' ') pos++
        }

        val rest = line.substring(pos)
        val parts = rest.split(" ")
        val command = parts[0].uppercase()

        val params = mutableListOf<String>()
        var i = 1
        while (i < parts.size) {
            if (parts[i].startsWith(":")) {
                // Trailing: the rest of the line, colon and all inner spaces kept
                params.add(parts.subList(i, parts.size).joinToString(" ").substring(1))
                break
            }
            // Runs of spaces produce empty splits, which are not parameters
            if (parts[i].isNotEmpty()) params.add(parts[i])
            i++
        }

        return IrcMessage(
            tags = tags,
            prefix = prefix,
            source = prefix?.let { parsePrefix(it) },
            command = command,
            params = params
        )
    }

    fun serialise(
        command: String,
        params: List<String> = emptyList(),
        tags: Map<String, String?> = emptyMap(),
        prefix: String? = null
    ): String {
        val parts = mutableListOf<String>()

        if (tags.isNotEmpty()) {
            parts.add("@" + tags.entries.joinToString(";") { (key, value) ->
                if (value == null) key else "$key=${escapeTagValue(value)}"
            })
        }

        if (prefix != null) parts.add(":$prefix")
        parts.add(command)

        params.forEachIndexed { index, param ->
            if (index == params.size - 1 && trailing(command, param)) {
                parts.add(":$param")
            } else {
                parts.add(param)
            }
        }

        return parts.joinToString(" ")
    }

    fun serialise(command: String, vararg params: String): String = serialise(command, params.toList())

    /**
     * Commands whose last parameter is a piece of human text.
     *
     * These always take the trailing form, single word or not — it is what every
     * other client sends, and a bare last word invites a sloppy relay to split it.
     */
    private val TEXT_TRAILING = setOf(
        "PRIVMSG", "NOTICE", "TOPIC", "PART", "QUIT", "KICK", "AWAY", "SETNAME", "WALLOPS", "USER"
    )

    /**
     * Whether the last parameter goes in the trailing form.
     *
     * Free-form text always does. A structured token does so only when it has no
     * other form — empty, containing a space, or starting with a colon. Marking
     * every last parameter as trailing is legal but produces lines nothing else
     * sends (`CAP LS :302`, `METADATA * SUB a b :c`), and a server that matches a
     * subcommand as a literal token then quietly does nothing.
     */
    private fun trailing(command: String, param: String): Boolean {
        if (command.uppercase() in TEXT_TRAILING) return true
        return param.isEmpty() || param.contains(' ') || param.startsWith(":")
    }

    private fun parseTags(tagString: String): Map<String, String?> {
        val tags = LinkedHashMap<String, String?>()
        for (part in tagString.split(";")) {
            val eq = part.indexOf('=')
            if (eq == -1) {
                tags[part] = null
            } else {
                tags[part.substring(0, eq)] = unescapeTagValue(part.substring(eq + 1))
            }
        }
        return tags
    }

    private fun unescapeTagValue(value: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < value.length) {
            if (value[i] == '\\' && i == value.length - 1) {
                // A lone trailing backslash is dropped, per the message-tags spec
                break
            }
            if (value[i] == '\\' && i + 1 < value.length) {
                val seq = value.substring(i, i + 2)
                // An unknown escape loses its backslash and keeps its character
                out.append(TAG_ESCAPES[seq] ?: value[i + 1].toString())
                i += 2
            } else {
                out.append(value[i])
                i++
            }
        }
        return out.toString()
    }

    private fun escapeTagValue(value: String): String {
        val out = StringBuilder()
        for (char in value) out.append(TAG_UNESCAPES[char] ?: char.toString())
        return out.toString()
    }

    private fun parsePrefix(prefix: String): IrcSource {
        val bang = prefix.indexOf('!')
        val at = prefix.indexOf('@')

        if (bang != -1 && at != -1 && at > bang) {
            return IrcSource(
                nick = prefix.substring(0, bang),
                user = prefix.substring(bang + 1, at),
                host = prefix.substring(at + 1)
            )
        }
        if (at != -1) {
            return IrcSource(prefix.substring(0, at), null, prefix.substring(at + 1))
        }
        return IrcSource(prefix, null, null)
    }
}
