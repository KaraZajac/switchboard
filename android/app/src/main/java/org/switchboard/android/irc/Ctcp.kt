package org.switchboard.android.irc

import java.time.Instant

/**
 * Answering the questions other clients ask about this one.
 *
 * The Kotlin half of `src/shared/ctcp.ts`, checked against
 * `tests/fixtures/ctcp.json`. CTCP is a question wrapped in a control byte
 * inside an ordinary message, answered with a NOTICE wrapped the same way.
 * `VERSION` and `SOURCE` are the two anybody actually sends.
 *
 * Switchboard answered these privately and stayed silent when they were asked
 * of a channel — which is how people ask. Somebody surveying a room got an
 * answer from every client in it except this one, and reported, reasonably,
 * that Switchboard does not respond to CTCP.
 *
 * The silence was not an oversight. A CTCP to a channel is a question put to
 * everybody at once, and a room full of clients each answering it privately is
 * the flood that gave CTCP its reputation. The answer is not to stay quiet, it
 * is to answer at a rate that cannot become a flood.
 */
object Ctcp {

    /**
     * What we answer, and what we say we answer.
     *
     * One list with the desktop's, so a person who asks the same question of a
     * phone and a desktop gets the same reply. `CLIENTINFO` is how the
     * convention says to ask what the rest of the list is.
     */
    val ANSWERS = listOf("CLIENTINFO", "PING", "SOURCE", "TIME", "VERSION")

    const val SOURCE_URL = "https://github.com/KaraZajac/switchboard"

    /**
     * How much answering is reasonable, and over what.
     *
     * One window for both limits, because two windows of different lengths is
     * a rule nobody can hold in their head. Thirty seconds, three answers to
     * any one person, ten to everybody.
     *
     * Three rather than one because asking two or three things in a row is
     * what asking looks like: somebody sends `VERSION`, reads it, and sends
     * `SOURCE`. A cooldown of one answer per person swallowed the second,
     * which is the complaint we started with in a smaller form.
     */
    const val WINDOW_MS = 30_000L
    const val PER_ASKER = 3
    const val TOTAL = 10

    /**
     * The answer to one question, or null for one we do not answer.
     *
     * Everything outside the list goes unanswered, which is the polite reading
     * of the convention — and the safe one, since an unknown verb with a
     * payload is as likely to be somebody probing as somebody asking.
     */
    fun reply(
        verb: String,
        args: String,
        version: String,
        platform: String,
        now: Instant
    ): String? = when (verb.uppercase()) {
        "VERSION" -> "VERSION Switchboard $version ($platform)"
        "SOURCE" -> "SOURCE $SOURCE_URL"
        "CLIENTINFO" -> "CLIENTINFO " + ANSWERS.joinToString(" ")
        // To the second, written out rather than left to the runtime's
        // formatter. JavaScript always prints milliseconds and Java omits them
        // when they are zero, so the two clients answered the same question
        // with two different strings.
        "TIME" -> "TIME " + now.truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
        // Echoed exactly: the asker is timing the round trip and compares what
        // comes back with what it sent
        "PING" -> "PING $args"
        else -> null
    }
}

/**
 * How often this client is willing to answer.
 *
 * Two limits, because there are two ways an answer becomes a flood. One person
 * asking over and over is held off by the per-asker cooldown. A crowd asking at
 * once — which is what a channel full of bots reacting to the same line looks
 * like — is held off by the burst cap, and that one matters more: without it a
 * stranger can make this client send as many messages as they have nicks, and
 * the network kills the client rather than them.
 *
 * Deliberately generous to the ordinary case. Somebody surveying a channel asks
 * once and is answered; asking twice inside half a minute is not a survey.
 */
class CtcpGuard(
    private val windowMs: Long = Ctcp.WINDOW_MS,
    private val perAsker: Int = Ctcp.PER_ASKER,
    private val total: Int = Ctcp.TOTAL
) {
    private val answered = mutableMapOf<String, MutableList<Long>>()
    private var recent = mutableListOf<Long>()

    /**
     * Whether to answer this one, counting it if so.
     *
     * Asking and recording are one call on purpose: a caller that checks and
     * then forgets to record has no rate limit at all, and nothing about the
     * shape of the code would say so.
     */
    @Synchronized
    fun allow(asker: String, now: Long): Boolean {
        fun fresh(times: List<Long>) = times.filter { now - it < windowMs }.toMutableList()

        recent = fresh(recent)
        if (recent.size >= total) return false

        val key = asker.lowercase()
        val mine = fresh(answered[key] ?: emptyList())
        if (mine.size >= perAsker) {
            answered[key] = mine
            return false
        }

        mine.add(now)
        answered[key] = mine
        recent.add(now)

        // Kept from growing without limit on a busy network: a person with
        // nothing left inside the window can no longer stop an answer
        if (answered.size > 512) {
            answered.entries.removeAll { fresh(it.value).isEmpty() }
        }

        return true
    }
}
