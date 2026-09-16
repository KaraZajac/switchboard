package org.switchboard.android.push

import org.switchboard.android.irc.Irc
import org.switchboard.android.mentionsYou

/**
 * What a push says, once it is open.
 *
 * rIRCd puts one formatted IRC line in the payload — `format_message` with the
 * CRLF trimmed — so what arrives is exactly what would have come down the
 * socket had the phone been holding one. That is the useful shape: everything
 * needed to draw a notification is already there, in a form this app has a
 * parser for.
 *
 * Which conversation it belongs to is the one thing the line does not say
 * plainly. `PRIVMSG #design :…` is the channel; `PRIVMSG kara :…` is addressed
 * to us, and the conversation is named after whoever sent it. Telling those
 * apart needs our own nick on that network, which the push does not carry —
 * the endpoint does, because there is one per server and the instance is the
 * server's id.
 */
object Pushed {

    /** A push worth showing somebody */
    data class Notice(
        /** The conversation it belongs in: a channel, or the sender for a DM */
        val conversation: String,
        /** Who said it */
        val nick: String,
        /** What they said */
        val text: String,
        /** Whether it names us, which decides whether the phone makes a sound */
        val mentioned: Boolean
    )

    private val CHANNEL_PREFIXES = "#&+!"

    /**
     * Read a pushed line, or null for one there is nothing to show about.
     *
     * Null rather than an exception: a push body is attacker-reachable and
     * arrives on a background thread, and there is no user waiting on an error.
     * A server that pushes something unexpected gets silence rather than a
     * crash in a broadcast receiver.
     */
    fun read(line: String, myNick: String, highlightWords: List<String> = emptyList()): Notice? {
        val message = runCatching { Irc.parse(line.trim()) }.getOrNull() ?: return null

        // PRIVMSG and NOTICE are the two that carry something somebody said.
        // A server pushing anything else is telling us to wake up rather than
        // to draw something, and there is nothing here to draw.
        val command = message.command.uppercase()
        if (command != "PRIVMSG" && command != "NOTICE") return null

        val nick = message.nick?.takeIf { it.isNotBlank() } ?: return null
        val target = message.param(0)?.takeIf { it.isNotBlank() } ?: return null
        val text = message.param(1)?.takeIf { it.isNotBlank() } ?: return null

        // Our own message, echoed back to us. A server that pushes it has told
        // us about something we did, which is not news.
        if (nick.equals(myNick, ignoreCase = true)) return null

        val toChannel = target.first() in CHANNEL_PREFIXES
        val conversation = if (toChannel) target else nick

        return Notice(
            conversation = conversation,
            nick = nick,
            text = text,
            // A direct message is a mention by definition: somebody typed your
            // name to reach you at all.
            mentioned = !toChannel || mentionsYou(text, myNick, highlightWords)
        )
    }
}
