package org.switchboard.android.irc

/**
 * draft/multiline — one message that happens to have line breaks in it.
 *
 * The capability value carries what the server will accept, and going over it
 * is not a truncated message: it is `FAIL BATCH MULTILINE_MAX_BYTES` and
 * nothing delivered at all. So the splitting is the client's job.
 *
 * Kept alongside `src/main/irc/features/multiline.ts`, which does the same
 * thing in the same order, and checked against the same corpus.
 */
object Multiline {

    /** What the server said it will take in one batch, from `draft/multiline=…` */
    data class Limits(val maxBytes: Int? = null, val maxLines: Int? = null)

    /**
     * Read the limits out of the capability value.
     *
     * A key we cannot make a positive number of is not a limit of zero — it is
     * a value we do not understand, and the safe reading of that is
     * "unlimited": the server will say so if we are wrong, and the alternative
     * is refusing to send anything at all.
     */
    fun limitsFrom(value: String?): Limits {
        if (value.isNullOrBlank()) return Limits()

        var bytes: Int? = null
        var lines: Int? = null

        for (token in value.split(',')) {
            val at = token.indexOf('=')
            if (at == -1) continue

            val key = token.substring(0, at).trim()
            val count = token.substring(at + 1).trim().toIntOrNull() ?: continue
            if (count <= 0) continue

            if (key == "max-bytes") bytes = count
            if (key == "max-lines") lines = count
        }

        return Limits(bytes, lines)
    }

    /**
     * Group lines into batches none of which exceeds the limits.
     *
     * A single line longer than `maxBytes` goes on its own rather than being
     * dropped: splitting inside it would change what someone wrote, and a
     * server refusing one line is better than this client quietly deciding
     * their message was too long to send.
     */
    fun split(lines: List<String>, limits: Limits): List<List<String>> =
        split(lines, limits, lines).map { batch -> batch }

    /**
     * The same grouping, carrying something alongside each line.
     *
     * [items] is in step with [lines]; the batches come back as items, so a
     * caller that needs more than the text — whether a line was one we had to
     * cut, say — does not have to work out the correspondence again.
     */
    fun <T> split(lines: List<String>, limits: Limits, items: List<T>): List<List<T>> {
        if (limits.maxBytes == null && limits.maxLines == null) return listOf(items)

        val batches = mutableListOf<List<T>>()
        var current = mutableListOf<T>()
        var bytes = 0

        for ((index, line) in lines.withIndex()) {
            val size = line.toByteArray(Charsets.UTF_8).size
            val overBytes =
                limits.maxBytes != null && current.isNotEmpty() && bytes + size > limits.maxBytes
            val overLines = limits.maxLines != null && current.size >= limits.maxLines

            if (overBytes || overLines) {
                batches.add(current)
                current = mutableListOf()
                bytes = 0
            }

            current.add(items[index])
            bytes += size
        }

        if (current.isNotEmpty()) batches.add(current)
        return batches
    }

    /**
     * The parts of a received multiline message, as the one message they were.
     *
     * A part tagged `draft/multiline-concat` continues the one before it with
     * no line break — it is how a sender says "this was one long line the
     * protocol made me split". Joining everything with a newline instead puts
     * breaks in the middle of their sentence.
     */
    fun combine(parts: List<IrcMessage>): String {
        val text = StringBuilder()
        for ((index, part) in parts.withIndex()) {
            if (index > 0 && !part.hasTag("draft/multiline-concat")) text.append('\n')
            text.append(part.param(1).orEmpty())
        }
        return text.toString()
    }
}
