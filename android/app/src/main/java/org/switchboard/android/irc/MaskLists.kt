package org.switchboard.android.irc

/**
 * The lists a channel keeps: bans, quiets, exceptions, invites.
 *
 * The Kotlin half of `src/shared/masklists.ts`, checked against
 * `tests/fixtures/masklists.json`.
 *
 * We shipped a ban action with nowhere to see what is banned. You could put
 * somebody on a list and never find them again — not to lift it, not to check
 * whether the mask you guessed at actually matched. Half a feature, and the
 * wrong half.
 *
 * These are the CHANMODES type A modes: the ones that take a mask and
 * accumulate. Which letters exist comes from ISUPPORT; what they mean is
 * convention, and that part is here.
 */
object MaskLists {

    /**
     * @param mode the letter, as used in `MODE #channel +b`
     * @param label what to call the list
     * @param hint what being on it does, in one line
     * @param entry what one entry is called, for "Lift this ban"
     */
    data class MaskList(val mode: String, val label: String, val hint: String, val entry: String)

    /**
     * The four every network means the same thing by.
     *
     * `q` is here but [listsFor] will only offer it where it is not a prefix:
     * on Unreal and InspIRCd the same letter means channel owner.
     */
    private val KNOWN = mapOf(
        "b" to Triple("Bans", "Anyone matching cannot join, and is removed if they are here.", "ban"),
        "q" to Triple("Quiets", "Anyone matching can be here but cannot speak.", "quiet"),
        "e" to Triple(
            "Ban exceptions",
            "Anyone matching may join even if a ban would have stopped them.",
            "exception"
        ),
        "I" to Triple(
            "Invite exceptions",
            "Anyone matching may join an invite-only channel without an invite.",
            "invite exception"
        )
    )

    /**
     * The lists this network actually keeps.
     *
     * Read off CHANMODES rather than assumed: a network without `+e` should not
     * get a tab that will only ever be empty, and one with a mode we have never
     * seen should not have it hidden.
     */
    fun listsFor(chanmodes: String?, prefix: String?): List<MaskList> {
        val typeA = (chanmodes ?: "").substringBefore(',')
        val scheme = Powers.parsePrefix(prefix)

        return typeA.mapNotNull { letter ->
            val mode = letter.toString()
            // A letter that is also a prefix is a rank, not a list
            if (scheme.modes.contains(mode)) return@mapNotNull null

            val known = KNOWN[mode]
            if (known != null) MaskList(mode, known.first, known.second, known.third)
            else MaskList(mode, "+$mode list", "A list this network keeps under mode +$mode.", "+$mode entry")
        }
    }

    /**
     * @param mask the mask itself, e.g. `*!*@example.org`
     * @param setBy who put it there, where the server says
     * @param setAt when, in seconds since the epoch, where the server says
     */
    data class Entry(val mask: String, val setBy: String? = null, val setAt: Long? = null)

    data class ListReply(
        val mode: String,
        val channel: String,
        val done: Boolean,
        val entry: Entry? = null
    )

    /**
     * Which numerics carry which list.
     *
     * The odd one out is 728: unlike the rest it names its own mode in a
     * parameter, for networks with more than one mask list beyond bans. So the
     * mode cannot simply be read off the numeric.
     */
    private const val IN_PARAMS = "in-params"
    private val NUMERICS = mapOf(
        "367" to (("b") to false),
        "368" to (("b") to true),
        "346" to (("I") to false),
        "347" to (("I") to true),
        "348" to (("e") to false),
        "349" to (("e") to true),
        "728" to ((IN_PARAMS) to false),
        "729" to ((IN_PARAMS) to true)
    )

    /** Whether this numeric is part of a mask list at all */
    fun isListNumeric(command: String): Boolean = command in NUMERICS

    /**
     * Read one line of a list.
     *
     * The shapes differ more than they look. RPL_BANLIST is
     * `<me> <channel> <mask> [<who> <when>]` — the last two optional and absent
     * on plenty of servers. RPL_QUIETLIST is `<me> <channel> <mode> <mask> ...`,
     * one parameter longer. Reading the second as the first puts the mode
     * letter in the list as though somebody had banned the letter `q`.
     */
    fun readReply(command: String, params: List<String>): ListReply? {
        val shape = NUMERICS[command] ?: return null

        val channel = params.getOrNull(1).orEmpty()
        if (channel.isEmpty()) return null

        val mode = if (shape.first == IN_PARAMS) params.getOrNull(2).orEmpty() else shape.first
        if (mode.isEmpty()) return null

        if (shape.second) return ListReply(mode, channel, done = true)

        val at = if (shape.first == IN_PARAMS) 3 else 2
        val mask = params.getOrNull(at).orEmpty()
        if (mask.isEmpty()) return null

        val stamp = params.getOrNull(at + 2)?.toLongOrNull()
        return ListReply(
            mode, channel, done = false,
            entry = Entry(
                mask = mask,
                setBy = params.getOrNull(at + 1),
                setAt = if (stamp != null && stamp > 0) stamp else null
            )
        )
    }

    /**
     * Whether this looks like a mask rather than a bare nick.
     *
     * `MODE #chan +b kara` is legal and most servers expand it, but some do not
     * — and a list full of bare words is a list nobody can read.
     */
    fun looksLikeMask(value: String): Boolean =
        value.contains('!') || value.contains('@') || value.contains('*')

    /**
     * What to actually send for something typed into a ban box.
     *
     * A bare nick becomes `nick!*@*`, which is what almost every server would
     * have done anyway and what the person plainly meant. Anything with mask
     * punctuation in it is left exactly as typed — guessing at a half-written
     * mask would be worse than sending it.
     */
    fun maskToSet(typed: String): String {
        val value = typed.trim()
        if (value.isEmpty()) return ""
        return if (looksLikeMask(value)) value else "$value!*@*"
    }
}
