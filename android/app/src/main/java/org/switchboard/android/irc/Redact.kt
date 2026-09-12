package org.switchboard.android.irc

/**
 * Taking the secrets out of a line before anything else sees it.
 *
 * The Kotlin half of `src/shared/redact.ts`, checked against
 * `tests/fixtures/redact.json`.
 *
 * On the desktop this exists because every line sent was emitted on a debug
 * stream and that stream was handed to every paired device: PASS, and
 * AUTHENTICATE, which for SASL PLAIN is base64 of the account name and
 * password together and decodes in one step. The same rule lives here so that
 * anything this phone logs or shows of its own wire is held to it too, and so
 * the two clients do not disagree about what counts as a secret.
 */
object Redact {

    private const val HIDDEN = "***"

    /**
     * How many words after a services verb are safe to keep.
     *
     * Not one rule for all of them: `IDENTIFY kara hunter2` names the account
     * first and `REGISTER hunter2 kara@example.org` names the password first.
     */
    private val SERVICE_SECRETS = mapOf(
        "IDENTIFY" to 1,
        "GHOST" to 1,
        "RELEASE" to 1,
        "REGAIN" to 1,
        "SETPASS" to 1,
        "REGISTER" to 0
    )

    /** What a line with no secret in it looks like: itself */
    fun line(line: String): String {
        val tagged = if (line.startsWith("@")) line.indexOf(' ') + 1 else 0
        if (tagged == 0 && line.startsWith("@")) return line

        val head = line.substring(0, tagged)
        val parts = line.substring(tagged).split(" ")
        val verb = parts.getOrNull(0)?.uppercase() ?: return line

        return when (verb) {
            "PASS" -> if (parts.size < 2) line else "$head${parts[0]} $HIDDEN"

            // `+` and `*` are protocol tokens: an empty response and an abort
            "AUTHENTICATE" -> {
                val payload = parts.getOrNull(1)
                if (payload == null || payload == "+" || payload == "*") line
                else "$head${parts[0]} $HIDDEN"
            }

            "OPER" -> if (parts.size < 3) line else "$head${parts[0]} ${parts[1]} $HIDDEN"

            "PRIVMSG", "NS", "NICKSERV" -> services(head, parts, line)

            // draft/account-registration — REGISTER <account> <email> <password>.
            // The same word as the NickServ one and a different command
            // entirely: this is sent at the top level, so it fell through to
            // `else` and the password went into the debug stream in full.
            "REGISTER" ->
                if (parts.size < 4) line
                else "$head${parts.take(3).joinToString(" ")} $HIDDEN"

            // VERIFY <account> <code>. Single-use and short-lived, and also
            // the whole of what stands between somebody and the account for
            // the minute it is alive.
            "VERIFY" -> if (parts.size < 3) line else "$head${parts[0]} ${parts[1]} $HIDDEN"

            // draft/webpush — the endpoint is where our notifications are
            // delivered and `auth` is the secret they are encrypted to.
            "WEBPUSH" -> if (parts.size < 3) line else "$head${parts[0]} ${parts[1]} $HIDDEN"

            else -> line
        }
    }

    private fun services(head: String, parts: List<String>, line: String): String {
        val verb = parts[0].uppercase()
        val from = if (verb == "PRIVMSG") 2 else 1
        if (parts.size <= from) return line

        if (verb == "PRIVMSG") {
            val target = parts[1].lowercase().trimStart('@', '+')
            if (!target.startsWith("nickserv") && !target.startsWith("chanserv")) return line
        }

        val words = parts.drop(from).toMutableList()
        words[0] = words[0].removePrefix(":")
        val keep = SERVICE_SECRETS[words[0].uppercase()] ?: return line
        if (words.size < 2) return line

        // The password is the last word, always
        val keepCount = minOf(keep, words.size - 2).coerceAtLeast(0)
        val kept = words.take(1 + keepCount)
        val prefix = parts.take(from).joinToString(" ")
        val colon = if (parts[from].startsWith(":")) ":" else ""
        return "$head$prefix $colon${kept.joinToString(" ")} $HIDDEN"
    }
}
