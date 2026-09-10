package org.switchboard.android.irc

/**
 * Which client-only tags this network will actually carry.
 *
 * The Kotlin half of `src/shared/clienttags.ts`, checked against
 * `tests/fixtures/clienttags.json`. A client tag — `+typing`, `+draft/react`,
 * `+reply` — is one the server is meant to pass along without caring what it
 * means. Servers are allowed to refuse, and say which in ISUPPORT:
 *
 *     Libera    CLIENTTAGDENY=*,-typing
 *     FurNet    CLIENTTAGDENY=*,-draft/typing,-typing,-draft/channel-context,-draft/reply
 *
 * `*` denies everything, and a name after a `-` puts one back. Neither client
 * read the token, so on Libera a reaction went out, had its tag stripped in
 * passing, and arrived as a TAGMSG that meant nothing — no reaction, no error,
 * and a button that appeared to do its job.
 *
 * The other half is spelling. Two names exist for most of these while the
 * drafts settle, and a network may carry one and not the other: FurNet allows
 * `draft/reply` and denies `reply`, which is exactly the one we were sending.
 */
object ClientTags {

    /** Whether the network will pass this client tag along, named without its `+` */
    fun carries(deny: String?, tag: String): Boolean {
        if (deny.isNullOrEmpty()) return true

        var allowed = true
        for (entry in deny.split(",")) {
            val token = entry.trim()
            if (token.isEmpty()) continue

            when {
                token == "*" -> allowed = false
                token.startsWith("-") ->
                    if (token.substring(1).equals(tag, ignoreCase = true)) allowed = true
                token.equals(tag, ignoreCase = true) -> allowed = false
            }
        }
        return allowed
    }

    /**
     * The first of these names the network will carry, or null for none.
     *
     * Ask with the preferred spelling first. Null is the answer to "can I do
     * this here at all", which is a question worth being able to answer before
     * offering somebody a button.
     */
    fun toUse(deny: String?, names: List<String>): String? = names.firstOrNull { carries(deny, it) }

    /** The spellings we know for each thing that rides on a client tag */
    val TYPING = listOf("typing", "draft/typing")
    val REACT = listOf("draft/react", "react")
    val UNREACT = listOf("draft/unreact", "unreact")
    val REPLY = listOf("reply", "draft/reply")
    val CHANNEL_CONTEXT = listOf("draft/channel-context", "channel-context")
}
