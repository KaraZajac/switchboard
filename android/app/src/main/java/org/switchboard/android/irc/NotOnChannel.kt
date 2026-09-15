package org.switchboard.android.irc

/**
 * When the server disagrees with us about being in a channel.
 *
 * The Kotlin half of `src/shared/notonchannel.ts`. A channel is added to the
 * list when the server echoes our `JOIN` and taken out when it echoes our
 * `PART`. That is right whenever the server answers at all — and leaves a
 * channel stuck forever when it answers with a refusal instead.
 *
 * `PART #somewhere` answered with `403 No such channel` means we were not in
 * it, so the entry was stale; but nothing removed it, so it sat in the list
 * and every attempt to leave produced the same error. The only way out was to
 * delete the network.
 */
object NotOnChannel {

    /** `403 ERR_NOSUCHCHANNEL` and `442 ERR_NOTONCHANNEL` */
    val NUMERICS = listOf("403", "442")

    fun saysWeAreNotInIt(numeric: String): Boolean = numeric in NUMERICS

    /**
     * What to do with one of them.
     *
     * `leave` when we had the channel: our list was wrong and is now right,
     * and that is the outcome somebody asked for when they pressed leave — so
     * it is not worth a banner. `report` when we did not: the numeric is about
     * somewhere else, a mistyped `/topic` or a join that failed, and the
     * person needs to be told.
     */
    fun action(numeric: String, channel: String?, weHaveIt: (String) -> Boolean): String {
        if (!saysWeAreNotInIt(numeric)) return "report"
        if (channel.isNullOrEmpty() || !weHaveIt(channel)) return "report"
        return "leave"
    }
}
