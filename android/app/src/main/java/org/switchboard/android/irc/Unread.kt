package org.switchboard.android.irc

import org.switchboard.android.isChannel

/**
 * What a conversation and a network look like when something has happened.
 *
 * The Kotlin half of `src/shared/unread.ts`, checked against
 * `tests/fixtures/unread.json`.
 *
 * Three states and nothing else, because a sidebar is read at a glance and a
 * glance holds three things: grey for quiet, white for something said, a
 * number for somebody saying your name.
 *
 * This phone put a grey count on every unread channel, so "something was said"
 * and "you were named" were both numbers and you had to read them to tell
 * which. It counted direct messages toward the network badge as well, which
 * double-counts them now that people have their own button, and it ignored
 * muting entirely.
 */
object Unread {

    data class Conversation(
        val name: String,
        val unread: Int,
        val mentions: Int,
        val muted: Boolean
    )

    /** Grey, white, or the one you are looking at */
    enum class RowLook { SELECTED, UNREAD, QUIET }

    fun rowLook(unread: Int, muted: Boolean, selected: Boolean): RowLook = when {
        selected -> RowLook.SELECTED
        // A muted conversation stays grey however much was said in it
        unread > 0 && !muted -> RowLook.UNREAD
        else -> RowLook.QUIET
    }

    /** The number on a row, or null where there is nothing to count */
    data class Badge(val count: Int, val muted: Boolean)

    fun rowBadge(mentions: Int, muted: Boolean): Badge? =
        if (mentions <= 0) null else Badge(mentions, muted)

    /**
     * What a count says, and how wide the circle around it has to be.
     *
     * Capped, because a number wider than the icon it sits on stops being a
     * badge. The diameter lives here rather than in each client's styling so
     * the two draw the same circle: one that is round at a single digit and an
     * oval at two is the thing this replaced.
     */
    fun badgeLabel(count: Int): String =
        if (count > 99) "99+" else maxOf(0, count).toString()

    fun badgeDiameter(count: Int): Int = when (badgeLabel(count).length) {
        0, 1 -> 18
        2 -> 22
        else -> 26
    }

    /** The pill on the left edge of the rail */
    enum class Chip { TALL, SHORT, NONE }

    data class RailLook(val chip: Chip, val mentions: Int, val mentionsMuted: Boolean)

    /**
     * @param conversations everything on this network, channels and people
     *   alike. People are filtered out here so neither client can forget to:
     *   their unread belongs to the Messages button, and counting it twice
     *   makes a network look busy because somebody sent you one line.
     */
    fun railLook(
        conversations: List<Conversation>,
        active: Boolean,
        serverMuted: Boolean
    ): RailLook {
        val channels = conversations.filter { isChannel(it.name) }
        val audible = channels.filter { !it.muted }

        val mentions = channels.sumOf { maxOf(0, it.mentions) }
        val hasUnread = !serverMuted && audible.any { it.unread > 0 }

        return RailLook(
            chip = when {
                active -> Chip.TALL
                hasUnread -> Chip.SHORT
                else -> Chip.NONE
            },
            mentions = mentions,
            // False with no mentions at all, so the flag never describes a
            // badge that is not there.
            mentionsMuted = mentions > 0 &&
                (serverMuted || channels.none { it.mentions > 0 && !it.muted })
        )
    }
}
