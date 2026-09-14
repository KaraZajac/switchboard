package org.switchboard.android.irc

/**
 * Recognising the services bots.
 *
 * Most of IRC has no `draft/account-registration`. It has a bot called NickServ
 * that sends you a notice in English and waits, and for a great many people
 * that notice is the first thing that happens after they connect — often the
 * only thing, because a client that shows it as an ordinary message from an
 * ordinary stranger gives them no reason to act on it.
 *
 * So the phrases are matched. Not to parse them: only to know that *this* is
 * the moment to offer the login screen, which is the difference between a
 * client that helps and one that watches.
 */
object Services {

    /** Bots that speak for the network rather than for a person */
    private val KNOWN = setOf(
        "nickserv", "chanserv", "authserv", "hostserv", "memoserv",
        "operserv", "botserv", "saslserv", "services", "services."
    )

    fun isServices(nick: String): Boolean {
        val name = nick.lowercase()
        return KNOWN.contains(name) || KNOWN.any { name.startsWith("$it@") } ||
            name.endsWith("@services.") || name.startsWith("services@")
    }

    /**
     * Whether this notice is asking us to log in.
     *
     * The wording differs by network — Atheme, Anope and rIRCd each have their
     * own — so this matches on what they have in common rather than on any one
     * of them. Being wrong in the permissive direction costs a banner nobody
     * needed; being wrong the other way costs the whole point of noticing.
     */
    fun asksForIdentification(text: String): Boolean {
        val line = text.lowercase()

        val aboutThisNick = line.contains("nickname is registered") ||
            line.contains("nick is registered") ||
            line.contains("this nickname is owned") ||
            line.contains("is a registered nick")

        val tellsYouHow = line.contains("identify") || line.contains("/msg nickserv")

        return aboutThisNick || (tellsYouHow && line.contains("password"))
    }

    /**
     * Whether it says we succeeded.
     *
     * Worth knowing separately: a client that offers "log in" to somebody who
     * just logged in is not paying attention, and on a network with no
     * `account-notify` this notice is the only signal there is.
     */
    fun confirmsIdentification(text: String): Boolean {
        val line = text.lowercase()
        return line.contains("you are now identified") ||
            line.contains("you are now logged in") ||
            line.contains("password accepted") ||
            line.contains("now recognized")
    }

    /**
     * The services commands whose arguments are a password, or a proof of one.
     *
     * `IDENTIFY`, `REGISTER`, `GHOST` and the rest take the password on the
     * line, and the line is a message like any other: echoed back by the
     * server, filed under the NickServ conversation, kept in history. A
     * password kept in plain text in the message history is a password on
     * disk in a file that is not the one meant to hold it. `SET PASSWORD`
     * keeps its second word, which names the setting rather than the secret.
     */
    private val SECRET_COMMANDS = setOf(
        "identify", "id", "register", "ghost", "recover", "release", "regain",
        "drop", "verify", "confirm", "login", "auth", "sidentify", "group", "set"
    )

    private const val MASK = "•••"

    /**
     * What a line said to services is kept and shown as.
     *
     * Only to a services bot, only for the commands that carry a secret, and
     * only when there is anything after the verb to hide. Everything else — a
     * message to a person that happens to say "identify", `NickServ INFO kara`
     * — is left as it was. The desktop half is `secretsMasked` in
     * `src/shared/services.ts`, and both are checked against the corpus.
     */
    fun secretsMasked(target: String, text: String): String {
        if (!isServices(target)) return text
        val words = text.trim().split(Regex("\\s+"))
        if (words.size < 2) return text
        val verb = words[0].lowercase()
        if (verb !in SECRET_COMMANDS) return text
        if (verb == "set") {
            if (words[1].lowercase() != "password" || words.size < 3) return text
            return "${words[0]} ${words[1]} $MASK"
        }
        return "${words[0]} $MASK"
    }
}
