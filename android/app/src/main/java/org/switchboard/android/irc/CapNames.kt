package org.switchboard.android.irc

/**
 * Capabilities that go by more than one name.
 *
 * The Kotlin half of `src/shared/capnames.ts`. The IRCv3 process renames
 * things: a draft gets a vendor prefix, or loses one, and for years afterwards
 * two servers offer the same feature under two names. A client that knows only
 * one of them does not fail — it negotiates nothing and the feature is quietly
 * absent, which is the worst shape a bug can have, because everything looks
 * connected.
 *
 * soju offers `soju.im/webpush` and Switchboard asked for `draft/webpush`, so
 * push to a phone through a soju never worked at all, and nothing anywhere
 * said so.
 *
 * The same idea as [ClientTags], one level up: there it is the spellings of a
 * message tag, here of a capability.
 */
object CapNames {

    /** Asking the server to wake this device when something arrives */
    val WEBPUSH = listOf("draft/webpush", "soju.im/webpush")

    /** The server will not send NAMES on joining; ask when you want it */
    val NO_IMPLICIT_NAMES = listOf("no-implicit-names", "soju.im/no-implicit-names")

    /**
     * The name this server used, or null if it offered none of them.
     *
     * The name rather than a boolean, because the one that was negotiated is
     * the one to use in anything sent afterwards.
     */
    fun negotiatedAs(negotiated: Collection<String>, names: List<String>): String? =
        names.firstOrNull { it in negotiated }

    /** Whether the server agreed to this feature, under any of its names */
    fun has(negotiated: Collection<String>, names: List<String>): Boolean =
        negotiatedAs(negotiated, names) != null
}
