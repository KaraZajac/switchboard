package org.switchboard.android.irc

/**
 * What to say when nothing was listening.
 *
 * Both clients hand a server's message to whoever registered for that command
 * and drop it where nobody did. For the replies that carry data that is
 * exactly right: a client that printed every unclaimed `RPL_` would fill the
 * server tab with the answers to questions it asked itself, and there are
 * hundreds of them.
 *
 * It is wrong for the refusals. A refusal is the server's answer to something
 * the user just did, and dropping it means they watch nothing happen and are
 * never told why — you message somebody who is blocking strangers and the
 * message simply vanishes; you join a channel that forwards elsewhere and end
 * up somewhere you did not ask for; the server password is wrong and the
 * connection closes with no reason given. Every one of those is a numeric no
 * client can be expected to have a handler for, and every one of them says in
 * plain English what went wrong.
 *
 * Kept alongside `src/shared/numerics.ts`, and checked against the same corpus.
 */
object Numerics {

    /** A numeric nothing was listening for, and the text to show for it */
    data class Unclaimed(val code: String, val message: String)

    /**
     * Numerics outside the error block that still report a message going
     * nowhere.
     *
     * `716`–`718` belong with the four hundreds and are not among them because
     * the server that invented them had run out of room: they are what a
     * network with `CALLERID` says when somebody is refusing messages from
     * strangers. Without them a private message to a person in `+g` disappears
     * with no sign it was ever sent — which is the exact failure this object
     * exists for.
     */
    private val ALSO = setOf("716", "717", "718")

    /** Whether a numeric belongs to the block servers use for refusals */
    private fun isRefusal(command: String): Boolean {
        if (command.length != 3 || !command.all { it.isDigit() }) return false
        val number = command.toInt()
        return (number in 400..599) || command in ALSO
    }

    /**
     * The text of a numeric, put back together for a person to read.
     *
     * The parameters run `<us> [context...] :<description>` — our own nick
     * first, because a numeric is addressed to somebody, then whatever the
     * refusal was about, then the sentence. The nick is dropped: the user knows
     * who they are.
     *
     * Joined with a colon or a space depending on how the description starts,
     * because the two families were written to read differently. `No such
     * channel` is a sentence of its own and wants `#chan: No such channel`; `is
     * in +g mode` was written to follow a nick and wants `bob is in +g mode`. A
     * lowercase first letter is what distinguishes them, and it is the server's
     * own choice rather than a guess about it.
     */
    private fun readable(params: List<String>): String? {
        val description = params.lastOrNull()?.trim()
        if (description.isNullOrEmpty()) return null

        // A lone parameter is read as the sentence rather than as a nick,
        // because that is the form servers actually send: `464 :Password
        // incorrect`, before registration has given them a name to address it
        // to. A numeric carrying a nick and nothing else is not a message any
        // server sends.
        val context = params.drop(1).dropLast(1).filter { it.isNotEmpty() }
        if (context.isEmpty()) return description

        val joined = context.joinToString(" ")
        val continues = description.first() in 'a'..'z'
        return if (continues) "$joined $description" else "$joined: $description"
    }

    /** What to report for a numeric no handler claimed, or null to stay quiet */
    fun unclaimed(command: String, params: List<String>): Unclaimed? {
        if (!isRefusal(command)) return null
        val message = readable(params) ?: return null
        return Unclaimed(command, message)
    }
}
