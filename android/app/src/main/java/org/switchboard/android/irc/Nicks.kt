package org.switchboard.android.irc

/**
 * Which nick to try when the one you asked for is taken.
 *
 * The Kotlin half of `src/shared/nicks.ts`, checked against
 * `tests/fixtures/altnick.json`: the user's alternatives in order, each
 * tried once, and an underscore on the end when they run out.
 */
object Nicks {
    fun nextToTry(attempted: String, alternatives: List<String>, tried: List<String>): String {
        val used = (tried + attempted).map { it.lowercase() }.toSet()
        for (raw in alternatives) {
            val candidate = raw.trim()
            if (candidate.isEmpty()) continue
            if (candidate.lowercase() !in used) return candidate
        }
        return attempted + "_"
    }
}
