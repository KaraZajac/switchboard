package org.switchboard.android.irc

/**
 * What a channel is set to, in words.
 *
 * The Kotlin half of `src/shared/chanmodes.ts`, checked against
 * `tests/fixtures/chanmodes.json`.
 *
 * `CHANMODES` has been parsed since the beginning — the permissions code reads
 * it, the mask lists read it — and there has never been anywhere to see a
 * channel's settings, let alone change one. The only way to make a channel
 * invite-only was `/mode #channel +i`, which means knowing that `i` is the
 * letter.
 */
object ChanModes {

    /**
     * PARAM always takes one, PARAM_ON_SET only when set, FLAG is on or off.
     * List modes are collections rather than settings and are not offered here
     * at all — see [MaskLists].
     */
    enum class Kind { PARAM, PARAM_ON_SET, FLAG }

    data class Mode(
        val letter: String,
        val kind: Kind,
        /** What to call it */
        val label: String,
        /** What it does, in one line */
        val hint: String,
        /** What to call the value, where it takes one */
        val placeholder: String? = null
    )

    /**
     * The ones every ircd means the same thing by.
     *
     * Not exhaustive on purpose: a letter here is one where being wrong would
     * be worse than saying nothing, so anything a network is free to redefine
     * stays out and is shown as itself.
     */
    private val KNOWN = mapOf(
        "i" to Triple("Invite only", "Nobody can join without an invitation.", null),
        "m" to Triple("Moderated", "Only voiced people and operators can speak.", null),
        "n" to Triple("No outside messages", "Only people in the channel can send to it.", null),
        "p" to Triple("Private", "Hidden from the channel list.", null),
        "s" to Triple("Secret", "Hidden from the channel list and from WHOIS.", null),
        "t" to Triple("Topic locked", "Only operators can change the topic.", null),
        "k" to Triple("Password", "Everyone joining has to know it.", "Channel password"),
        "l" to Triple("Limit", "How many people may be here at once.", "Number of people")
    )

    /**
     * Which modes this network has, and what each one is.
     *
     * List modes are left out: they are not settings but collections, and they
     * have a panel of their own.
     */
    fun settingsFor(chanmodes: String?, prefix: String?): List<Mode> {
        val parts = (chanmodes ?: "").split(',')
        val typeB = parts.getOrElse(1) { "" }
        val typeC = parts.getOrElse(2) { "" }
        val typeD = parts.getOrElse(3) { "" }
        val ranks = Powers.parsePrefix(prefix).modes

        val modes = mutableListOf<Mode>()
        fun add(letters: String, kind: Kind) {
            for (letter in letters) {
                val mode = letter.toString()
                // A letter that is also a rank is not a channel setting
                if (ranks.contains(mode)) continue

                val known = KNOWN[mode]
                modes += if (known != null) {
                    Mode(mode, kind, known.first, known.second, known.third)
                } else {
                    Mode(
                        mode, kind, "+$mode", "A mode this network calls +$mode.",
                        if (kind == Kind.FLAG) null else "Value"
                    )
                }
            }
        }

        add(typeB, Kind.PARAM)
        add(typeC, Kind.PARAM_ON_SET)
        add(typeD, Kind.FLAG)
        return modes
    }

    /**
     * The MODE arguments for turning one setting on or off.
     *
     * Null when there is nothing to send — turning a limit on with no number,
     * for instance, which the server would answer with an error about a command
     * we chose to send.
     */
    fun change(mode: Mode, on: Boolean, value: String?): List<String>? {
        val sign = if (on) "+" else "-"

        if (mode.kind == Kind.FLAG) return listOf("$sign${mode.letter}")

        if (!on) {
            // Unsetting a key needs the key on most servers, and giving it
            // where it is not needed is harmless — leaving it out where it is
            // needed is not.
            return if (mode.kind == Kind.PARAM && !value.isNullOrEmpty()) {
                listOf("-${mode.letter}", value)
            } else {
                listOf("-${mode.letter}")
            }
        }

        val wanted = (value ?: "").trim()
        if (wanted.isEmpty()) return null
        return listOf("+${mode.letter}", wanted)
    }
}
