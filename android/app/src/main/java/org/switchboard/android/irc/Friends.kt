package org.switchboard.android.irc

/**
 * "Tell me when this person turns up", in whichever dialect the network speaks.
 *
 * The Kotlin half of `src/shared/friends.ts`, checked against
 * `tests/fixtures/friends.json`. MONITOR is the one IRCv3 specified and the one
 * both clients were written against; WATCH is what the older families —
 * bahamut, plexus, UnrealIRCd — have had since long before. Switchboard only
 * ever sent MONITOR, so on DALnet and Rizon the friend list was a screen you
 * could add names to that would never once tell you anything.
 */
object Friends {

    enum class Kind { MONITOR, WATCH }

    /**
     * Which command this network takes, preferring MONITOR.
     *
     * Where a server offers both — UnrealIRCd does — MONITOR is the
     * better-specified of the two.
     */
    fun kind(isupport: Map<String, String>): Kind? = when {
        isupport.containsKey("MONITOR") -> Kind.MONITOR
        isupport.containsKey("WATCH") -> Kind.WATCH
        else -> null
    }

    /** How many names the network will hold for us, if it said */
    fun limit(isupport: Map<String, String>): Int? {
        val chosen = kind(isupport) ?: return null
        return isupport[chosen.name]?.toIntOrNull()?.takeIf { it > 0 }
    }

    /**
     * Anything longer than this and the line stops being one line.
     *
     * A message is 512 bytes including the command, the trailing CRLF and, on
     * the way back, a source prefix the server prepends. A hundred friends at
     * ten characters each was over the limit in one line, and the ones past the
     * cut were never watched — no error, because the server never saw them.
     */
    private const val PARAMS_BUDGET = 400

    /**
     * The lines that add or drop these nicks.
     *
     * Always a list, because a friend list long enough to be useful is long
     * enough to need more than one line.
     */
    fun lines(kind: Kind, nicks: List<String>, add: Boolean): List<String> {
        val wanted = nicks.filter { it.isNotEmpty() }
        if (wanted.isEmpty()) return emptyList()

        val sign = if (add) "+" else "-"
        val out = mutableListOf<String>()
        var batch = mutableListOf<String>()

        // MONITOR separates with a comma, WATCH repeats the sign on each name
        fun cost(nick: String) = if (kind == Kind.MONITOR) nick.length + 1 else nick.length + 2

        fun flush() {
            if (batch.isEmpty()) return
            out += when (kind) {
                Kind.MONITOR -> "MONITOR $sign " + batch.joinToString(",")
                Kind.WATCH -> "WATCH " + batch.joinToString(" ") { sign + it }
            }
            batch = mutableListOf()
        }

        for (nick in wanted) {
            val spent = batch.sumOf { cost(it) }
            if (batch.isNotEmpty() && spent + cost(nick) > PARAMS_BUDGET) flush()
            batch += nick
        }
        flush()

        return out
    }

    /**
     * Ask the network who on the list is here right now.
     *
     * MONITOR S answers with 730/731. WATCH's equivalent is `L`, which reports
     * every entry as online or offline — `WATCH S` is the other question.
     */
    fun statusLine(kind: Kind): String = if (kind == Kind.MONITOR) "MONITOR S" else "WATCH L"

    /**
     * Ask the network what is on the list at all.
     *
     * The two commands swap letters here, which is exactly the sort of thing
     * that makes a fallback look like it works until you read the replies:
     * MONITOR L answers with 732, and the WATCH command that answers with 606
     * is `S`.
     */
    fun listLine(kind: Kind): String = if (kind == Kind.MONITOR) "MONITOR L" else "WATCH S"
}
