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
        ADMIN, DEADMIN, FOUNDER, DEFOUNDER,
        KICK, BAN, MUTE, UNMUTE
    }

    /** The rungs a menu has words for, weakest first */
    enum class Rung { VOICE, HALFOP, OP, ADMIN, FOUNDER }

    /**
     * The mode letter this network uses for a rung, or null where it has none.
     *
     * Asked by name rather than by position because position is not portable:
     * the top rung is `q` on the servers that have one and `x` on rIRCd, which
     * keeps `q` for its quiet list. A client that assumed `q` sent
     * `MODE #chan +q nick` to promote somebody and silenced them instead.
     *
     * Only the letters a person has a word for. A network whose top prefix is
     * some other letter has no founder as far as this is concerned — granting
     * a mode nobody can name is worse than not offering to.
     */
    fun modeForRole(prefix: String?, rung: Rung): Char? {
        val modes = parsePrefix(prefix).modes
        val candidates = when (rung) {
            Rung.FOUNDER -> listOf('q', 'x')
            Rung.ADMIN -> listOf('a')
            Rung.OP -> listOf('o')
            Rung.HALFOP -> listOf('h')
            Rung.VOICE -> listOf('v')
        }
        return candidates.firstOrNull { modes.contains(it) }
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

    /**
     * What to call the people standing on one rung.
     *
     * By mode letter rather than by symbol, because the letters are the
     * portable half: every network that has an admin calls the mode `a` and
     * they disagree about whether it shows as `&` or `!`. `q` and `x` are both
     * the top — `q` on the servers that have it, `x` on rIRCd, which keeps `q`
     * for its quiet list and says so in ISUPPORT rather than expecting anyone
     * to guess.
     *
     * A letter with no name is named after itself. `Mode +z` says something
     * true about a group nobody has a word for, where "Online" would say
     * something false — which is what this client did with rIRCd's `^`.
     */
    fun roleName(mode: Char): String = when (mode) {
        'q', 'x' -> "Founders"
        'a' -> "Admins"
        'o' -> "Operators"
        'h' -> "Half-ops"
        'v' -> "Voiced"
        else -> "Mode +$mode"
    }

    /** Higher is more privileged; 0 is somebody wearing nothing */
    data class Role(val rank: Int, val label: String)

    val NO_ROLE = Role(0, "Members")

    /**
     * The group a member belongs in, and how high it sits.
     *
     * Only the strongest prefix counts: somebody who is both an operator and
     * voiced is an operator, in one group rather than two. Ranked the other way
     * up from [rankOf] on purpose — a list is drawn from the top down.
     */
    fun roleOf(prefixes: List<String>, prefixValue: String?): Role {
        val scheme = parsePrefix(prefixValue)
        val at = rankOf(prefixes.joinToString(""), scheme)
        if (at >= scheme.symbols.length) return NO_ROLE

        return Role(scheme.symbols.length - at, roleName(scheme.modes[at]))
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

    /**
     * Whether you could change a channel's settings and lists.
     *
     * Half-operator upwards where the network has one, operator upwards where
     * it does not — the same line [actionsFor] draws before offering a kick,
     * and here so that a panel does not draw it again by hand.
     *
     * It was drawn by hand twice and backwards both times: [rankOf] returns 0
     * for the *most* privileged, so a `>= 2` test meant "voiced or nothing".
     */
    fun canModerate(prefix: String?, mine: String): Boolean {
        val scheme = parsePrefix(prefix)
        val opRank = rankOfMode('o', scheme) ?: return false
        val halfopRank = rankOfMode('h', scheme)
        return rankOf(mine, scheme) <= (halfopRank ?: opRank)
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
        // about the channel, so no rank is needed and no network can refuse
        // it. Never against yourself, which would silence your own messages.
        if (!isSelf) actions.add(if (ignored) Action.UNIGNORE else Action.IGNORE)

        fun rungRank(rung: Rung): Int? =
            modeForRole(prefix, rung)?.let { rankOfMode(it, scheme) }

        val opRank = rungRank(Rung.OP)
        val halfopRank = rungRank(Rung.HALFOP)
        val voiceRank = rungRank(Rung.VOICE)
        val adminRank = rungRank(Rung.ADMIN)
        val founderRank = rungRank(Rung.FOUNDER)

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

        /*
         * And the rungs above operator, where the network has them.
         *
         * These were missing entirely, which on a network with founders meant
         * the one person who could hand the channel on had no way to do it —
         * the menu stopped at Make operator.
         *
         * You need the rung to grant it: only a founder makes a founder. That
         * is what every ircd that has these does, and unlike kicking they
         * agree about it, so this is the one place it is safe to be strict.
         */
        if (adminRank != null && myRank <= adminRank) {
            offer(adminRank, Action.ADMIN, Action.DEADMIN)
        }
        if (founderRank != null && myRank <= founderRank) {
            offer(founderRank, Action.FOUNDER, Action.DEFOUNDER)
        }

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
