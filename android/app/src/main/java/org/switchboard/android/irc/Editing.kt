package org.switchboard.android.irc

/**
 * Which of your own messages you can still change.
 *
 * The Kotlin half of `src/shared/editing.ts`. Both clients offered Edit in two
 * places it does not work: on a server that does not carry edits, where the
 * new text arrives as a *second message* because an edit is only a `PRIVMSG`
 * wearing a client tag; and on an action, where `/me waves` is CTCP-wrapped
 * and the edit sends plain text, turning something you did into something you
 * said.
 */
object Editing {

    /**
     * Both spellings. A capability loses its `draft/` prefix when it is
     * ratified, and a client that only knows the draft name stops offering the
     * feature on the day the servers stop being drafts.
     */
    private val EDIT_CAPS = setOf("draft/message-edit", "message-edit")

    fun editsAllowed(capabilities: Collection<String>): Boolean =
        capabilities.any { it in EDIT_CAPS }

    /** Whether this message is yours, and of a kind an edit would not spoil */
    fun canEdit(
        type: String,
        nick: String,
        deleted: Boolean,
        myNick: String,
        capabilities: Collection<String>
    ): Boolean {
        if (!editsAllowed(capabilities)) return false
        // Nothing to amend, and the server would refuse the attempt
        if (deleted) return false
        // Plain text only: an action, a notice and a system line each mean
        // something the edit would not carry.
        if (type != "privmsg") return false
        if (myNick.isEmpty()) return false
        return nick.lowercase() == myNick.lowercase()
    }
}
