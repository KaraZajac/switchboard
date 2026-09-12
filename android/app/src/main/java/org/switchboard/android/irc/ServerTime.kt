package org.switchboard.android.irc

import java.time.Instant

/**
 * What a message's `time` tag is allowed to be.
 *
 * The Kotlin half of `src/shared/servertime.ts`, checked against
 * `tests/fixtures/servertime.json`.
 *
 * `server-time` says ISO 8601 in UTC with milliseconds. The tag was stored on
 * trust and later reached `Instant.parse`, which throws on anything malformed
 * — so a server, or anything one relays, could put `@time=soon` on a line and
 * crash the transcript export.
 */
object ServerTime {

    private val ISO_UTC = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$""")

    /** A timestamp we are willing to store, or null */
    fun valid(value: String?): String? {
        if (value == null) return null
        val m = ISO_UTC.matchEntire(value) ?: return null
        // Explicit indices: Kotlin destructures lists only five deep
        val n = m.groupValues
        val y = n[1].toInt(); val mo = n[2].toInt(); val d = n[3].toInt()
        val h = n[4].toInt(); val mi = n[5].toInt(); val s = n[6].toInt()

        if (y < 1970 || y > 9000) return null
        if (mo !in 1..12 || d !in 1..31) return null
        // 60 would be a leap second. ISO 8601 allows one; neither `java.time` nor
        // `Date.parse` accepts it, so refusing keeps the two clients identical.
        if (h > 23 || mi > 59 || s > 59) return null

        // Real calendar check: 2026-02-30 matches the pattern and is not a day
        val parsed = runCatching { Instant.parse(value) }.getOrNull() ?: return null
        val back = parsed.atZone(java.time.ZoneOffset.UTC)
        if (back.monthValue != mo || back.dayOfMonth != d) return null

        return value
    }

    /** The tag's time where it is one, and the clock otherwise */
    fun of(value: String?, now: () -> String = { Instant.now().toString() }): String =
        valid(value) ?: now()
}
