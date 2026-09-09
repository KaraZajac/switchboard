package org.switchboard.android.irc

/**
 * Folding a nick or channel name the way the server does.
 *
 * IRC names are case-insensitive, but not in the way a programming language
 * means it. Which characters count as the same letter is the server's
 * decision, announced as `CASEMAPPING` in ISUPPORT, and getting it wrong
 * splits one person into two or merges two into one.
 *
 * Two traps, both of which a plain `lowercase()` walks straight into:
 *
 * 1. Under `rfc1459` — the default when a server says nothing, which is what
 *    the RFC requires — `[ ] \ ~` are the uppercase forms of `{ } | ^`. They
 *    are common in nicks (`bob[away]`, `n\a`), so treating them as distinct is
 *    not a corner case.
 * 2. `lowercase()` folds the whole of Unicode. An `ascii` server folds only
 *    A–Z, so `İ` and `i̇` are two different people to it and one person to us.
 *    That matters here rather than in theory: servers advertising `UTF8ONLY`
 *    accept non-ASCII nicks.
 *
 * Kept alongside `src/shared/casemap.ts`, and checked against the same corpus.
 */
object Casemap {

    enum class Mapping { ASCII, RFC1459, RFC1459_STRICT }

    /**
     * The mapping named in ISUPPORT, or the default.
     *
     * An unknown name falls back to rfc1459 rather than to ASCII: it is the
     * conservative reading, since the extra characters it folds are ones a
     * server that named something else is unlikely to treat as distinct.
     */
    fun mappingOf(value: String?): Mapping = when (value) {
        "ascii" -> Mapping.ASCII
        "rfc1459-strict" -> Mapping.RFC1459_STRICT
        else -> Mapping.RFC1459
    }

    /** A name as the server would compare it */
    fun fold(name: String, mapping: Mapping = Mapping.RFC1459): String {
        val out = StringBuilder(name.length)
        for (char in name) {
            out.append(
                when {
                    // A–Z only, leaving every other alphabet alone
                    char in 'A'..'Z' -> char + 32
                    mapping == Mapping.ASCII -> char
                    char == '[' -> '{'
                    char == ']' -> '}'
                    char == '\\' -> '|'
                    // `~` is uppercase `^` in rfc1459 and not in the strict
                    // variant, which is the only difference between the two.
                    char == '~' && mapping == Mapping.RFC1459 -> '^'
                    else -> char
                }
            )
        }
        return out.toString()
    }
}
