package org.switchboard.android.irc

/**
 * People you would rather not hear from.
 *
 * The Kotlin half of `src/shared/ignore.ts`, checked against
 * `tests/fixtures/ignore.json`.
 *
 * The one tool every client has had since the eighties and this one did not.
 * [Powers.actionsFor] carried an `ignore` action the whole time with a comment
 * saying it stays out of the menu until there is a list behind it, because a
 * menu item that does nothing is the thing that rule exists to stop.
 *
 * An ignore is a mask, not a person: somebody who changes nick is the same
 * person, and `*!*@their.host` still matches.
 */
object Ignore {

    /**
     * What an ignore covers.
     *
     * Deliberately not joins, parts and quits: those are what keeps the member
     * list right, so dropping them makes somebody you ignored linger in the
     * roster after they leave, for good.
     */
    data class Scope(
        /** Channel messages, private messages, actions and notices */
        val messages: Boolean = true,
        /** Invitations and CTCP requests */
        val requests: Boolean = true
    )

    data class Entry(
        /** `nick!user@host`, with `*` and `?` wildcards */
        val mask: String,
        /** Which network, or [EVERYWHERE] */
        val network: String = EVERYWHERE,
        val scope: Scope = Scope(),
        /** When it was added, so a list can be ordered by newest */
        val added: Long = 0
    )

    const val EVERYWHERE = "*"

    /** Somebody, as much of them as we know */
    data class Who(val nick: String, val user: String? = null, val host: String? = null)

    /**
     * Turn what somebody typed into a mask.
     *
     * A bare nick becomes `nick!*@*`, which is what "ignore this person" means
     * to anybody who types it. A partial mask is completed rather than guessed
     * at: `*@host` is plainly about a host and becomes `*!*@host`.
     */
    fun toMask(typed: String): String {
        val value = typed.trim()
        if (value.isEmpty()) return ""

        if (!value.contains('!') && !value.contains('@')) return "$value!*@*"
        if (!value.contains('!')) {
            val user = value.substringBefore('@')
            val host = value.substringAfter('@')
            return "*!$user@$host"
        }
        if (!value.contains('@')) return "$value@*"
        return value
    }

    /**
     * Whether a mask matches somebody.
     *
     * `*` is any run of characters and `?` is exactly one, which is what every
     * ircd means by them. Case-insensitive, because IRC is: ignoring `Kara`
     * and then being messaged by `kara` would be a memorable way to fail.
     *
     * A user or host we do not know is treated as unknown rather than empty —
     * on a network without `userhost-in-names` a roster entry has a nick and
     * nothing else, and `*!*@*` should still match it.
     */
    fun matches(mask: String, who: Who): Boolean {
        val target = "${who.nick}!${who.user ?: "*"}@${who.host ?: "*"}"
        return glob(mask.lowercase(), target.lowercase())
    }

    /** Every entry that covers this person on this network */
    fun covering(list: List<Entry>, network: String, who: Who): List<Entry> =
        list.filter { (it.network == EVERYWHERE || it.network == network) && matches(it.mask, who) }

    /** Whether this person is ignored on this network, for this kind of thing */
    fun isIgnored(
        list: List<Entry>,
        network: String,
        who: Who,
        kind: String = "messages"
    ): Boolean = covering(list, network, who).any {
        if (kind == "requests") it.scope.requests else it.scope.messages
    }

    /**
     * Add one, replacing any entry for the same mask on the same network.
     *
     * Two entries for one mask cannot both be right, and the newer one is the
     * decision somebody just made.
     */
    fun with(list: List<Entry>, entry: Entry): List<Entry> {
        val mask = entry.mask.lowercase()
        return list.filterNot { it.mask.lowercase() == mask && it.network == entry.network } + entry
    }

    /**
     * Take one off, by mask and network — which is what the list shows.
     * Removing "whoever matches this person" would take unrelated entries too.
     */
    fun without(list: List<Entry>, mask: String, network: String): List<Entry> {
        val wanted = mask.lowercase()
        return list.filterNot { it.mask.lowercase() == wanted && it.network == network }
    }

    /**
     * Glob matching, the way an ircd does it.
     *
     * Iterative with a backtrack point rather than recursive: a mask is
     * attacker-supplied in the sense that a nick is, and `*a*a*a*a*a*b`
     * against a long name is the textbook way to make a recursive matcher take
     * a very long time.
     */
    private fun glob(pattern: String, value: String): Boolean {
        var p = 0
        var v = 0
        var star = -1
        var mark = 0

        while (v < value.length) {
            when {
                p < pattern.length && (pattern[p] == '?' || pattern[p] == value[v]) -> { p++; v++ }
                p < pattern.length && pattern[p] == '*' -> { star = p++; mark = v }
                star != -1 -> { p = star + 1; mark++; v = mark }
                else -> return false
            }
        }

        while (p < pattern.length && pattern[p] == '*') p++
        return p == pattern.length
    }
}
