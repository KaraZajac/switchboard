package org.switchboard.android.irc

/**
 * What a channel event says, in words.
 *
 * The Kotlin half of `src/shared/events.ts`, checked against
 * `tests/fixtures/events.json`: a join, part, quit, rename, kick or topic
 * change is worded the same on the phone as on the desktop.
 *
 * Joins, parts and quits are the noisy three, and hidden unless the shared
 * `showJoinsParts` setting says otherwise — the member list already says who
 * is here. Renames, kicks and topic changes are always shown.
 */
object Events {

    fun line(kind: String, nick: String, detail: String? = null, reason: String? = null): String {
        val why = if (reason.isNullOrEmpty()) "" else " ($reason)"
        return when (kind) {
            "join" -> "$nick joined the channel"
            "part" -> "$nick left the channel$why"
            "quit" -> "$nick quit$why"
            "nick" -> "$nick is now known as ${detail.orEmpty()}"
            "kick" -> "$nick was kicked by ${detail?.takeIf { it.isNotEmpty() } ?: "someone"}$why"
            "topic" -> if (detail.isNullOrEmpty()) "$nick cleared the topic" else "$nick changed the topic to: $detail"
            else -> "$nick $kind"
        }
    }

    /** The three the switch hides */
    fun isJoinOrPart(kind: String): Boolean = kind == "join" || kind == "part" || kind == "quit"
}
