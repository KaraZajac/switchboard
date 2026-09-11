package org.switchboard.android.irc

/**
 * Commands you make up yourself.
 *
 * The Kotlin half of `src/shared/aliases.ts`, checked against
 * `tests/fixtures/aliases.json`.
 *
 * Every client has had these for decades — `/j` for join, a one-word shortcut
 * for the four lines you type every time you sit down. Without them the only
 * commands are the ones somebody else decided you needed.
 *
 * Deliberately not a scripting language. An alias is text substitution with
 * numbered parameters, which covers what people actually write and cannot
 * loop, cannot read a file and cannot be a security question.
 */
object Aliases {

    /**
     * @param name the word after the slash, without it
     * @param expansion what to run instead — may be several lines, and may
     *   contain `$1`…`$9`, `$*` for everything, `$N-` for the Nth onwards
     */
    data class Alias(val name: String, val expansion: String)

    /** How deep one alias may go into another before we call it a loop */
    private const val MAX_DEPTH = 10

    /** @param error set when the line was refused rather than run */
    data class Expansion(val lines: List<String>, val error: String? = null)

    private val PARAMETER = Regex("""\$(\$|\*|\d+-?)""")

    /**
     * Fill in the parameters of one expansion.
     *
     * A parameter nobody supplied becomes nothing rather than the literal
     * `$3`, which would otherwise be sent to the server as text. `$$` is a
     * literal dollar, because an alias that inserts a price is a reasonable
     * thing to want.
     */
    fun fillParameters(expansion: String, args: List<String>): String =
        PARAMETER.replace(expansion) { match ->
            when (val token = match.groupValues[1]) {
                "$" -> "$"
                "*" -> args.joinToString(" ")
                else ->
                    if (token.endsWith("-")) {
                        val from = token.dropLast(1).toIntOrNull()
                        if (from == null || from < 1) "" else args.drop(from - 1).joinToString(" ")
                    } else {
                        val at = token.toIntOrNull()
                        if (at == null || at < 1) match.value else args.getOrElse(at - 1) { "" }
                    }
            }
        }

    /**
     * What a typed line becomes once aliases are applied.
     *
     * Text that is not a command comes back unchanged, and so does a command
     * that is not an alias — expansion happens here and dispatch elsewhere.
     *
     * An alias may call another, which is how `/j` is built on `/join`. It may
     * not call itself, directly or in a ring: that is a hang, and a client that
     * hangs on something the user typed is worse than one that refuses it.
     */
    fun expand(text: String, aliases: List<Alias>, depth: Int = 0): Expansion {
        if (!text.startsWith("/") || text.startsWith("//")) return Expansion(listOf(text))
        if (depth > MAX_DEPTH) return Expansion(emptyList(), "That alias expands into itself")

        val space = text.indexOf(' ')
        val name = (if (space == -1) text.drop(1) else text.substring(1, space)).lowercase()
        val rest = if (space == -1) "" else text.substring(space + 1).trim()

        val alias = aliases.firstOrNull { it.name.lowercase() == name }
            ?: return Expansion(listOf(text))

        val args = if (rest.isEmpty()) emptyList() else rest.split(Regex("\\s+"))
        val filled = fillParameters(alias.expansion, args)

        val lines = mutableListOf<String>()
        for (line in filled.split('\n')) {
            val one = line.trim()
            if (one.isEmpty()) continue

            val next = expand(one, aliases, depth + 1)
            if (next.error != null) return next
            lines.addAll(next.lines)
        }
        return Expansion(lines)
    }

    /** Whether a name can be an alias at all */
    fun validName(name: String): Boolean = Regex("^[a-zA-Z0-9_-]+$").matches(name.trim())

    /**
     * The lines to send when a connection is ready.
     *
     * One per line, a leading slash meaning a command and anything else raw
     * IRC — which is what every other client's "perform" does. Blank lines and
     * comments are dropped so the box can be annotated.
     */
    fun performLines(script: String?): List<String> =
        (script ?: "").split('\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
}
