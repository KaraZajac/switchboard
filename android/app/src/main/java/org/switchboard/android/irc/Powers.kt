package org.switchboard.android.irc

/**
 * What you may do to somebody in a channel.
 *
 * The Kotlin half of `src/shared/powers.ts`, checked against
 * `tests/fixtures/powers.json`.
 *
 * There is no IRCv3 specification for this, which is worth saying plainly
 * because it shapes everything below: no extension tells a client "you may
 * kick here". ISUPPORT gives the roles a network has (PREFIX) and which modes
 * take a mask (CHANMODES), and the rest is inference.
 *
 * So this errs toward offering an action a network might refuse, and never
 * toward hiding one it would have allowed — with one exception, which is the
 * case that prompted it: with no rank at all you get none of them, because
 * that is the one situation we can be certain about.
 */
object Powers {

    enum class Action {
        WHOIS, MESSAGE, IGNORE, UNIGNORE,
        VOICE, DEVOICE, HALFOP, DEHALFOP, OP, DEOP,
        KICK, BAN, MUTE, UNMUTE
    }

    data class Scheme(val modes: String, val symbols: String)

    /**
     * `PREFIX=(qaohv)~&@%+` into its two halves.
     *
     * Anything unparseable falls back to the pair every ircd has had since
     * before ISUPPORT existed.
     */
    fun parsePrefix(value: String?): Scheme {
        val match = Regex("^\\(([^)]*)\\)(.*)$").find((value ?: "").trim())
        val modes = match?.groupValues?.get(1).orEmpty()
        val symbols = match?.groupValues?.get(2).orEmpty()
        if (modes.isEmpty() || modes.length != symbols.length) return Scheme("ov", "@+")
        return Scheme(modes, symbols)
    }

    /**
     * How high somebody stands: 0 is the most privileged, and somebody wearing
     * nothing is one past the end — which makes "outranks" a comparison.
     */
    fun rankOf(symbols: String, scheme: Scheme): Int {
        var best = scheme.symbols.length
        for (symbol in symbols) {
            val at = scheme.symbols.indexOf(symbol)
            if (at != -1 && at < best) best = at
        }
        return best
    }

    private fun rankOfMode(mode: Char, scheme: Scheme): Int? =
        scheme.modes.indexOf(mode).takeIf { it != -1 }

    /**
     * Whether this network has a separate quiet mode, and which letter.
     *
     * `q` is the trap: on UnrealIRCd and InspIRCd it is a *prefix* — channel
     * owner — and on Solanum and rIRCd it is a list mode meaning quiet. Same
     * letter, opposite meanings, and offering "mute" where it makes somebody
     * the owner would be a memorable bug. A letter is a quiet mode when it
     * takes a mask and is not one of the prefixes.
     */
    fun quietMode(chanmodes: String?, scheme: Scheme): Char? {
        val typeA = (chanmodes ?: "").substringBefore(",")
        return if (typeA.contains('q') && !scheme.modes.contains('q')) 'q' else null
    }

    private fun hasBans(chanmodes: String?): Boolean =
        (chanmodes ?: "").substringBefore(",").contains('b')

    /**
     * The menu for one person, in order.
     *
     * @param mine the prefix symbols you are wearing in this channel
     * @param theirs the symbols they are wearing
     */
    fun actionsFor(
        prefix: String?,
        chanmodes: String?,
        mine: String,
        theirs: String,
        isSelf: Boolean,
        ignored: Boolean = false
    ): List<Action> {
        val scheme = parsePrefix(prefix)
        val myRank = rankOf(mine, scheme)
        val theirRank = rankOf(theirs, scheme)

        val actions = mutableListOf(Action.WHOIS)
        if (!isSelf) actions.add(Action.MESSAGE)
        // Ignoring somebody is a decision about your own client rather than
        // about the channel, so it belongs here — but neither client keeps an
        // ignore list yet, and a menu item that does nothing is the thing this
        // whole rule exists to stop. It goes in when the list behind it does.

        val opRank = rankOfMode('o', scheme)
        val halfopRank = rankOfMode('h', scheme)
        val voiceRank = rankOfMode('v', scheme)

        // No rank, nothing to offer: the one case we can be certain about, and
        // the one that had people pressing Kick and reading an error.
        if (opRank == null || myRank > (halfopRank ?: opRank)) return actions

        val amOp = myRank <= opRank
        val amHalfop = halfopRank != null && myRank <= halfopRank

        // Never against somebody standing above you, which is the one
        // permission rule every ircd agrees on.
        if (theirRank < myRank && !isSelf) return actions

        fun offer(rank: Int?, give: Action, take: Action) {
            if (rank == null) return
            if (theirs.contains(scheme.symbols[rank])) actions.add(take)
            else if (!isSelf) actions.add(give)
        }

        if (amOp || amHalfop) offer(voiceRank, Action.VOICE, Action.DEVOICE)
        if (amOp) offer(halfopRank, Action.HALFOP, Action.DEHALFOP)
        if (amOp) offer(opRank, Action.OP, Action.DEOP)

        // Kicking is where the networks disagree: rIRCd wants op, InspIRCd and
        // UnrealIRCd let a halfop do it. Offered to halfops, because a network
        // with the role usually means it to moderate, and a refusal costs a
        // line where hiding costs the feature.
        if (amOp || amHalfop) {
            if (!isSelf) actions.add(Action.KICK)
            if (quietMode(chanmodes, scheme) != null && !isSelf) actions.add(Action.MUTE)
        }

        if (amOp && !isSelf && hasBans(chanmodes)) actions.add(Action.BAN)

        return actions
    }

    /**
     * The mask to ban or quiet somebody with.
     *
     * `*!*@host` where the host is known, because a ban on the nick is undone
     * by changing it — one command, no privileges. `nick!*@*` is the fallback
     * and is worth doing rather than refusing, but it is the weaker thing.
     */
    fun banMask(nick: String, host: String?): String {
        val h = (host ?: "").trim()
        return if (h.isNotEmpty()) "*!*@$h" else "$nick!*@*"
    }

    /** Whether that mask is the weak kind, for a menu that would rather say so */
    fun maskIsWeak(host: String?): Boolean = (host ?: "").trim().isEmpty()
}
