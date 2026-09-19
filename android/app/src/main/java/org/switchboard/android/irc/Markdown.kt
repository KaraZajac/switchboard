package org.switchboard.android.irc

/**
 * The markdown people already type, turned into what IRC understands.
 *
 * The Kotlin half of `src/shared/markdown.ts`. `**bold**` and `*italics*` are
 * what everybody writes now, and on IRC they arrive as literal asterisks — so
 * the habit is either unlearned or the channel fills with punctuation. IRC has
 * had real bold and italics since the eighties; they are control bytes rather
 * than characters, which is the only reason nobody types them.
 *
 * The conversion happens on the way out, so a message sent from here is bold
 * *for everybody* — irssi, HexChat, a bouncer's log — rather than bold only
 * for the two people running this client.
 *
 * Spoilers are the exception. There is no IRC code for "cover this until
 * asked", so `||...||` stays as text and each client draws it.
 */
object Markdown {

    private data class Mark(val open: String, val code: String)

    /** Longest first, so `***` is not read as `*` twice */
    private val MARKS = listOf(
        Mark("***", "" + Formatting.BOLD + Formatting.ITALIC),
        Mark("**", Formatting.BOLD.toString()),
        Mark("__", Formatting.UNDERLINE.toString()),
        Mark("~~", Formatting.STRIKETHROUGH.toString()),
        Mark("*", Formatting.ITALIC.toString()),
        Mark("_", Formatting.ITALIC.toString())
    )

    private val ALL_CODES = charArrayOf(
        Formatting.BOLD, Formatting.COLOUR, Formatting.HEX_COLOUR, Formatting.RESET,
        Formatting.MONOSPACE, Formatting.REVERSE, Formatting.ITALIC,
        Formatting.STRIKETHROUGH, Formatting.UNDERLINE
    )

    private val URL = Regex("""^(?:https?|ircs?)://\S+""")

    private fun isWord(c: Char?) = c != null && c.isLetterOrDigit()

    /**
     * Whether a mark opens here.
     *
     * An underscore inside a word is part of the word: `some_file_name` is a
     * name. Asterisks need no such rule, because nobody writes
     * `some*file*name` and means it literally.
     */
    private fun opens(text: String, at: Int, open: String): Boolean {
        val after = text.getOrNull(at + open.length) ?: return false
        if (after == ' ' || after == '\t') return false
        if (open[0] == '_' && isWord(text.getOrNull(at - 1))) return false
        return true
    }

    private fun closes(text: String, at: Int, open: String): Boolean {
        val before = text.getOrNull(at - 1) ?: return false
        if (before == ' ' || before == '\t') return false
        if (open[0] == '_' && isWord(text.getOrNull(at + open.length))) return false
        return true
    }

    /** How long a run that must not be touched is, or 0 if one does not start here */
    private fun literalRun(text: String, at: Int): Int {
        if (text.startsWith("||", at)) {
            val end = text.indexOf("||", at + 2)
            if (end != -1) return end + 2 - at
        }
        if (text.getOrNull(at) == '`') {
            val end = text.indexOf('`', at + 1)
            if (end != -1) return end + 1 - at
        }
        URL.find(text.substring(at))?.let { return it.value.length }
        return 0
    }

    /** Where the run opened at [from] closes, skipping what must not be touched */
    private fun closingAt(text: String, from: Int, open: String): Int {
        var i = from
        while (i < text.length) {
            if (text[i] == '\\') { i += 2; continue }

            val literal = literalRun(text, i)
            if (literal > 0) { i += literal; continue }

            // A longer mark starting here is that mark, not this one closing
            // early: the `**` inside `***x***` belongs to the run.
            val longer = MARKS.firstOrNull { it.open.length > open.length && text.startsWith(it.open, i) }
            if (longer != null) { i += longer.open.length; continue }

            if (text.startsWith(open, i) && closes(text, i, open)) return i
            i++
        }
        return -1
    }

    /**
     * `**bold**` becomes the bold byte, the text, and the byte again.
     *
     * Left alone: backticks, because a run of code means what it says; text
     * already carrying a control byte, because the composer's own buttons put
     * those there and a message is not marked up twice; a URL, because
     * asterisks are legal in one; and `||spoilers||`, which have no code.
     */
    fun toIrc(text: String): String {
        if (text.any { it in ALL_CODES }) return text

        val out = StringBuilder()
        var i = 0
        while (i < text.length) {
            if (text[i] == '\\' && i + 1 < text.length && text[i + 1] in "*_~`|\\") {
                out.append(text[i + 1]); i += 2; continue
            }

            val literal = literalRun(text, i)
            if (literal > 0) { out.append(text, i, i + literal); i += literal; continue }

            val mark = MARKS.firstOrNull { text.startsWith(it.open, i) && opens(text, i, it.open) }
            if (mark != null) {
                val end = closingAt(text, i + mark.open.length, mark.open)
                // Something worth marking has to be inside it: `*!*@host` is a
                // ban mask, and asterisks around punctuation are punctuation.
                val inside = if (end == -1) "" else text.substring(i + mark.open.length, end)
                if (end != -1 && inside.any { it.isLetterOrDigit() }) {
                    out.append(mark.code).append(toIrc(inside)).append(mark.code)
                    i = end + mark.open.length
                    continue
                }
            }

            out.append(text[i]); i++
        }
        return out.toString()
    }

    /** One run of a line, and whether it is covered until somebody asks */
    data class Run(val text: String, val hidden: Boolean)

    private const val SPOILER = "||"

    /**
     * Split a line into what is covered and what is not.
     *
     * Left to each client to draw, because "covered until asked" is a gesture
     * rather than a colour.
     */
    fun spoilers(text: String): List<Run> {
        val out = mutableListOf<Run>()
        val plain = StringBuilder()
        var i = 0

        while (i < text.length) {
            if (text.startsWith(SPOILER, i)) {
                val end = text.indexOf(SPOILER, i + SPOILER.length)
                if (end != -1) {
                    val inside = text.substring(i + SPOILER.length, end)
                    // `||||` covers nothing and is four characters somebody typed; and a
                    // run that begins or ends with a space is not one either, by the rule
                    // the marks use. `if (a || b || c)` is a line of code somebody pasted,
                    // and covering ` b ` would hide part of it and eat the bars.
                    if (inside.isNotEmpty() && !inside.first().isWhitespace() && !inside.last().isWhitespace()) {
                        if (plain.isNotEmpty()) { out.add(Run(plain.toString(), false)); plain.clear() }
                        out.add(Run(inside, true))
                        i = end + SPOILER.length
                        continue
                    }
                }
            }
            plain.append(text[i]); i++
        }

        if (plain.isNotEmpty()) out.add(Run(plain.toString(), false))
        return out
    }

    /**
     * The markdown in what somebody typed, command and all.
     *
     * A slash command is mostly not prose, and running the conversion over one
     * would be a disaster: `/mode #x +b *!*@host` would come out with the mask
     * italicised and the ban would land on the wrong thing. So the composers
     * used to skip every line beginning with a slash — which is safe, and also
     * meant `/me **waves**` sent the asterisks. Emotes are exactly the place
     * people reach for emphasis.
     *
     * Which commands carry prose is already written down: the catalogue says
     * what each one takes, and the five whose last argument is `<message>` or
     * `<action>` are the five that end in something a person wrote. The count
     * of words before it says how much to step over — one for
     * `/msg <nick> <message>` and none for `/say <message>` — so a target is
     * never touched, and neither is any command the catalogue does not
     * describe this way.
     *
     * `prepare` is whatever else the composer does to prose — replacing
     * `:smile:` with the emoji — so that it lands on exactly the same span. It
     * used to run over the whole line or none of it, which is why `/me :wave:`
     * sent the colons.
     */
    fun forSend(typed: String, prepare: (String) -> String = { it }): String {
        fun convert(prose: String): String = toIrc(prepare(prose))
        if (!typed.startsWith("/")) return convert(typed)

        val said = Regex("""^/(\S+)(\s+)([\s\S]+)$""").find(typed) ?: return typed
        val (name, gap, args) = said.destructured

        val usage = CommandList.find(name)?.usage ?: return typed
        if (!Regex("""<(message|action)>$""").containsMatchIn(usage)) return typed

        // `/msg <nick|#channel> <message>` steps over one word, `/say <message>`
        // over none. Whitespace is kept as it was typed rather than rebuilt.
        val skip = usage.trim().split(Regex("""\s+""")).size - 1
        var at = 0
        repeat(skip) {
            while (at < args.length && !args[at].isWhitespace()) at++
            while (at < args.length && args[at].isWhitespace()) at++
            if (at >= args.length) return typed
        }

        return "/" + name + gap + args.substring(0, at) + convert(args.substring(at))
    }
}
