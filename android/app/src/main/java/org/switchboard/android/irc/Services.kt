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
}
