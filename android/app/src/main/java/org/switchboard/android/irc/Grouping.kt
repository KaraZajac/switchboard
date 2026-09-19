package org.switchboard.android.irc

/**
 * Whether a message joins the run above it, or starts its own.
 *
 * Every chat app draws a run of messages from one person as one block: an
 * avatar and a name on the first, and nothing but text under it. The rule for
 * when that run *breaks* was written twice — once in the desktop's
 * `MessageItem` and once here — and the two drifted, which is a thing you see
 * rather than a thing a test catches.
 *
 * What drifted: this side let a reply join the run, so a reply sent straight
 * after your own message drew no avatar and no name, only the quoted line and
 * the text — leaving the reply preview hanging in the gutter with nothing
 * underneath it to belong to. And the desktop had no day check at all, so a
 * run could span midnight in silence — this side has drawn a day divider all
 * along, which is why the check lives here rather than there.
 *
 * See `src/shared/grouping.ts` and `tests/fixtures/grouping.json`.
 */
object Grouping {

    /** What the rule needs to know about a message. Both clients have all of it. */
    data class Runnable(
        val nick: String,
        val type: String,
        /** ISO 8601, as it came off `server-time` or was stamped locally */
        val timestamp: String,
        /** The message this one answers, if any */
        val replyTo: String? = null
    )

    /** A run breaks after this long, however much the same person is talking */
    const val RUN_MINUTES = 5

    /**
     * Kinds that always stand alone.
     *
     * An emote reads as its own event — `kara waves` carries the name in the
     * sentence — and a system line is not somebody talking at all.
     */
    private val ALONE = listOf("action", "system")

    /**
     * `sameDay` is the caller's, not this rule's: which day a timestamp falls
     * on depends on the reader's timezone, and both clients already work that
     * out locally for the day divider. Passing it in keeps this answer the
     * same everywhere it is tested.
     */
    fun joinsRun(previous: Runnable?, message: Runnable, sameDay: Boolean = true): Boolean {
        if (previous == null) return false
        if (!sameDay) return false
        if (previous.nick != message.nick) return false
        if (previous.type != message.type) return false
        if (message.type in ALONE) return false
        // A reply carries a quoted line above it. Without a name under that,
        // there is nothing saying who is answering.
        if (!message.replyTo.isNullOrEmpty()) return false
        return minutesApart(previous.timestamp, message.timestamp) < RUN_MINUTES
    }

    /**
     * Unsigned, because history does not always arrive in order — a batch
     * played back out of sequence should not group on the strength of a
     * negative gap.
     */
    private fun minutesApart(a: String, b: String): Double {
        val first = parse(a) ?: return Double.POSITIVE_INFINITY
        val second = parse(b) ?: return Double.POSITIVE_INFINITY
        return kotlin.math.abs(second - first) / 60_000.0
    }

    private fun parse(value: String): Long? =
        runCatching { java.time.Instant.parse(value).toEpochMilli() }.getOrNull()
}
