package org.switchboard.android.irc

/**
 * Reading the numbers a server states in ISUPPORT.
 *
 * The same shape of problem as the capability values: the server says what it
 * will take, and a client that does not read it finds out by having something
 * refused. The failures differ in kind, which is why they are worth telling
 * apart —
 *
 * - `TARGMAX=PRIVMSG:1` and the message to two people comes back `407 :Too
 *   many recipients`, delivered to neither.
 * - `TOPICLEN=307` and a longer topic is silently cut to 307. Nothing fails;
 *   the user simply finds later that half their sentence is missing.
 *
 * Kept alongside `src/shared/isupport.ts`, and checked against the same corpus.
 */
object Isupport {

    /** A positive integer from a token, or null when it said nothing usable */
    fun number(isupport: Map<String, String>, token: String): Int? =
        isupport[token]?.trim()?.toIntOrNull()?.takeIf { it > 0 }

    /**
     * How many targets one command may carry.
     *
     * A name with no number after it means no limit for that command, which is
     * why an empty value cannot be read as zero. Null means the same: send what
     * you like and let the server say otherwise.
     */
    fun targetMax(isupport: Map<String, String>, command: String): Int? {
        val value = isupport["TARGMAX"] ?: return null
        val wanted = command.uppercase()

        for (entry in value.split(',')) {
            val at = entry.indexOf(':')
            if (at == -1) continue
            if (entry.substring(0, at).trim().uppercase() != wanted) continue
            return entry.substring(at + 1).trim().toIntOrNull()?.takeIf { it > 0 }
        }
        return null
    }

    /**
     * Split a comma-separated target list into groups the server will accept.
     *
     * One group when it stated no limit, which is also what a server that has
     * never heard of TARGMAX gets.
     */
    fun groupTargets(targets: String, max: Int?): List<String> {
        val names = targets.split(',').map { it.trim() }.filter { it.isNotEmpty() }
        if (names.isEmpty()) return emptyList()
        if (max == null || names.size <= max) return listOf(names.joinToString(","))

        return names.chunked(max).map { it.joinToString(",") }
    }

    /**
     * Whether text fits a stated maximum, counted the way the server counts.
     *
     * Bytes rather than characters: `TOPICLEN` and its neighbours are byte
     * counts, so a topic in Japanese runs out at a third of the characters an
     * English one does — and a client that measured characters would let it
     * through and watch it get cut.
     */
    fun fits(text: String, limit: Int?): Boolean =
        limit == null || text.toByteArray(Charsets.UTF_8).size <= limit

    /**
     * The channel a message was really addressed to.
     *
     * Ops and bots talk to half a room at a time: `PRIVMSG @#channel` reaches
     * everyone with `@` or better, `+#channel` everyone with a voice. Every
     * network advertises the prefixes it allows — `@+` on Libera and OFTC,
     * `~&@%+` on Rizon and Furnet — and neither client looked at the token, so
     * an ops-only line arrived as a conversation called `@#channel`, sitting
     * beside the real one and collecting its own unread count.
     */
    data class Addressed(val target: String, val status: String?)

    fun statusTarget(target: String, statusmsg: String?): Addressed {
        val allowed = statusmsg ?: ""
        if (allowed.isEmpty() || target.isEmpty()) return Addressed(target, null)
        if (!allowed.contains(target[0])) return Addressed(target, null)
        return Addressed(target.substring(1), target[0].toString())
    }

    /**
     * Whether the network advertised this token at all.
     *
     * The Kotlin half of `advertises` in `src/shared/isupport.ts`. A token may
     * arrive three ways: on its own (`WHOX`), with a value (`MONITOR=100`), or
     * with an equals sign and nothing after it (`WHOX=`), which the grammar
     * allows and which means the same as the bare form. The third stores an
     * empty string, which is falsy — so this is a presence question rather
     * than a test for truth, on both sides.
     */
    fun advertises(isupport: Map<String, String>, token: String): Boolean =
        isupport.containsKey(token)
}
