package org.switchboard.android.irc

import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * A conversation as text.
 *
 * The Kotlin half of `src/shared/transcript.ts`, checked against
 * `tests/fixtures/transcript.json`.
 *
 * Everything said is in the store and nothing could get it out. No log files,
 * no "save this conversation", no way to hand a channel to somebody who does
 * not run this client — and a history you cannot export is a history you
 * cannot keep when you stop using the app.
 *
 * One format wherever it is asked for: the desktop writing a file and this
 * offering a share sheet produce the same lines, close enough to what irssi
 * and WeeChat log that existing tools can read them.
 */
object Transcript {

    /** @param type `privmsg`, `notice`, `action` or `system` */
    data class Line(
        val nick: String,
        val content: String,
        /** ISO 8601 */
        val timestamp: String,
        val type: String
    )

    private val CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss")
    private val DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    /**
     * One line.
     *
     * `[HH:MM:SS] <nick> text` for a message, `* nick text` for an action, and
     * a bare `-!- text` for everything the client said — the shapes irssi and
     * WeeChat use, because a log nothing else can read has one reader.
     */
    fun line(message: Line, keepFormatting: Boolean = false, localTime: Boolean = false): String {
        val clock = runCatching {
            val at = Instant.parse(message.timestamp)
            CLOCK.format(at.atZone(if (localTime) ZoneId.systemDefault() else ZoneOffset.UTC))
        }.getOrDefault("--:--:--")

        val text = if (keepFormatting) message.content else Formatting.strip(message.content)

        return when (message.type) {
            "action" -> "[$clock] * ${message.nick} $text"
            "notice" -> "[$clock] -${message.nick}- $text"
            "system" -> "[$clock] -!- $text"
            else -> "[$clock] <${message.nick}> $text"
        }
    }

    /**
     * A whole conversation, with a header saying what it is.
     *
     * The header matters more than it looks: a file called `#general.txt` in a
     * year has no way to say which network it came from, and two networks have
     * a `#general`.
     */
    fun of(
        network: String,
        channel: String,
        messages: List<Line>,
        keepFormatting: Boolean = false,
        localTime: Boolean = false
    ): String {
        val out = mutableListOf(
            "# $channel on $network",
            "# ${messages.size} message${if (messages.size == 1) "" else "s"}"
        )
        if (messages.isNotEmpty()) {
            out += "# ${dayOf(messages.first().timestamp)} to ${dayOf(messages.last().timestamp)}"
        }
        out += ""

        // A day marker between days, so a month of scrollback is readable
        // rather than a wall of timestamps that all look alike.
        var day = ""
        for (message in messages) {
            val today = dayOf(message.timestamp)
            if (today != day) {
                if (day.isNotEmpty()) out += ""
                out += "--- $today ---"
                day = today
            }
            out += line(message, keepFormatting, localTime)
        }

        out += ""
        return out.joinToString("\n")
    }

    /**
     * What to call the file.
     *
     * Network and channel, because the channel alone is ambiguous, and every
     * character a filesystem might object to replaced rather than dropped —
     * two channels differing only in punctuation must not become one file.
     */
    fun filename(network: String, channel: String): String {
        fun safe(value: String) = value
            .replace(Regex("[^a-zA-Z0-9#&_.-]+"), "_")
            // No run of dots survives. Nothing here can escape a directory —
            // the separators are already gone — but a filename is handed to
            // the operating system, and leaving `..` in one to be reasoned
            // about later is how that stops being true.
            .replace(Regex("\\.{2,}"), ".")

        // Trimmed at both ends: a trailing dot meets the extension and makes
        // the `..` this just removed.
        val name = "${safe(network)}-${safe(channel)}"
            .replace(Regex("^[._-]+|[._-]+$"), "")
        return "${name.ifEmpty { "conversation" }}.txt"
    }

    private fun dayOf(timestamp: String): String = runCatching {
        DAY.format(Instant.parse(timestamp).atZone(ZoneOffset.UTC))
    }.getOrDefault("unknown date")
}
