package org.switchboard.android.irc

/**
 * Looking for something that was said, without having to remember where.
 *
 * The Kotlin half of `src/shared/search.ts`. Search was the last thing in this
 * client that made you name a network first: direct messages, mentions and
 * friends all stopped being per-network because the question people ask is
 * about a person or a phrase, not about a place.
 *
 * What is shared is small on purpose — which of two results comes first, and
 * how the place is written. How a store searches itself is its own business,
 * and the two stores are not alike.
 */
object Search {

    /** One line somebody said, and enough about where to go back to it */
    data class Found(
        val serverId: String,
        /** What the network is called here, for reading */
        val network: String,
        val channel: String,
        val nick: String,
        val content: String,
        val timestamp: String
    )

    /**
     * Where it was said, written the way a person would write it.
     *
     * `#channel@network`, the same shape as a friend's `nick@network` — on IRC
     * neither half means anything alone. `#general` is a different room on
     * every network there is.
     */
    fun whereSaid(channel: String, network: String): String =
        if (network.isNotEmpty()) "$channel@$network" else channel

    /**
     * Results from every network as one list, newest first.
     *
     * Time is the only order that means anything across networks: each store
     * has its own idea of how well a line matches and those numbers are not
     * comparable. What somebody remembers instead is roughly when.
     *
     * Ties broken by network then channel, so a run of lines from the same
     * second — a paste, a bot, a netsplit — does not shuffle between searches.
     */
    fun newestFirst(found: List<Found>): List<Found> =
        found.sortedWith(
            compareByDescending<Found> { it.timestamp }
                .thenBy { it.network.lowercase() }
                .thenBy { it.channel.lowercase() }
        )
}
