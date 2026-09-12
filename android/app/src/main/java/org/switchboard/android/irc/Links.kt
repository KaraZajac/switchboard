package org.switchboard.android.irc

/**
 * Finding the links in a line of text.
 *
 * The Kotlin half of `src/shared/links.ts`, checked against
 * `tests/fixtures/links.json`. The two clients each had their own pattern and
 * they disagreed, so the same message produced different links depending on
 * which device you were holding: the desktop kept the full stop at the end of
 * a sentence inside the URL and the phone dropped it, and both stopped dead at
 * the first closing bracket — so every Wikipedia link with a disambiguation in
 * it arrived truncated, on both.
 */
object Links {

    data class Found(val url: String, val start: Int, val end: Int)

    /**
     * Schemes worth making clickable.
     *
     * No word boundary in front of it: a colour code leaves its digits against
     * the scheme, and a boundary between `2` and `h` is not one.
     */
    private val SCHEME = Regex("(?:https?|ftp)://", RegexOption.IGNORE_CASE)

    /** Ends a URL wherever it appears */
    private val STOPS = setOf(' ', '\t', '\n', '\r', '<', '>', '"', '\'', '`')

    /** Punctuation that ends a sentence rather than a URL */
    private val TRAILING = setOf('.', ',', '!', '?', ';', ':', '”', '’')

    private val CLOSERS = mapOf(')' to '(', ']' to '[', '}' to '{')

    fun find(text: String): List<Found> {
        val found = mutableListOf<Found>()
        var at = 0

        while (at < text.length) {
            val match = SCHEME.find(text, at) ?: break
            val start = match.range.first

            var end = start
            while (end < text.length) {
                val char = text[end]
                if (char in STOPS || char.code < 0x20) break
                end++
            }

            end = trimSentence(text, start, end)

            if (end > start + match.value.length) {
                found.add(Found(text.substring(start, end), start, end))
                at = end
            } else {
                at = match.range.last + 1
            }
        }

        return found
    }

    /**
     * Give back whatever belonged to the sentence rather than to the URL.
     *
     * Repeatedly, because `(https://example.com/a).` ends in two of them and
     * taking one off exposes the other.
     */
    private fun trimSentence(text: String, start: Int, end: Int): Int {
        var stop = end
        while (stop > start) {
            val last = text[stop - 1]

            if (last in TRAILING) {
                stop--
                continue
            }

            val opener = CLOSERS[last]
            if (opener != null && !opens(text, start, stop - 1, opener, last)) {
                stop--
                continue
            }

            return stop
        }
        return stop
    }

    /** Whether the URL itself opened this bracket, which makes the closer part of it */
    private fun opens(text: String, start: Int, end: Int, opener: Char, closer: Char): Boolean {
        var depth = 0
        for (at in start until end) {
            when (text[at]) {
                opener -> depth++
                closer -> depth--
            }
        }
        return depth > 0
    }

    /**
     * Whether a link is one we are willing to hand to Android.
     *
     * Everything here ends up in an `ACTION_VIEW` intent, which will be
     * attempted by whatever app claims that scheme. That is fine for a link
     * somebody typed in a channel and not fine for a profile's `homepage`,
     * which is a metadata key — a string a stranger chose.
     *
     * The Kotlin half of `safeExternalUrl` in `src/shared/links.ts`, checked
     * against `tests/fixtures/links.json`. `ftp` is deliberately absent even
     * though [find] returns it: nothing modern opens one, and "the link does
     * nothing" beats "the link starts a program we did not choose".
     */
    fun safeExternal(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isEmpty() || trimmed.length > 2048) return null

        val uri = runCatching { java.net.URI(trimmed) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme !in SAFE_SCHEMES) return null

        // http and https without a host are not links to anywhere. `mailto` has
        // no host by design, so it is the exception rather than an oversight.
        if (scheme != "mailto" && uri.host.isNullOrEmpty()) return null

        return trimmed
    }

    private val SAFE_SCHEMES = setOf("http", "https", "mailto")
}
