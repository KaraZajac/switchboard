package org.switchboard.android.irc

/**
 * Which thing is holding the connections, in one word.
 *
 * The Kotlin half of `src/shared/holding.ts`. Both clients show this and both
 * had their own idea of it, which is how a phone came to say `SERVER` for the
 * same arrangement a desktop called nothing at all. It is one sentence about
 * one fact, so it is decided once.
 *
 * The phone also said it twice: a green banner reading "This phone is holding
 * the connections" sat above a pill reading `LIVE`. A banner that says
 * everything is normal is a banner people learn to skip, and then miss when it
 * stops being true.
 */
object Holding {

    enum class Holder { LIVE, BOUNCER, DESKTOP, CONNECTING, TAKING_OVER, OFFLINE }

    /**
     * @param holding whether this device is holding rather than following
     * @param connecting whether it is on its way there
     * @param peerHolding whether another device is holding them right now.
     *   Separate from [everPaired] on purpose: somebody else holding this, and
     *   being part of a pair at all, have different answers most of the time,
     *   and one name for both is how a phone came to name a desktop that was
     *   switched off.
     * @param followingAlwaysOn when following, whether the peer is an
     *   always-on Switchboard
     * @param everPaired whether there is another device in the picture at all.
     *   Only ever chooses between TAKING OVER and CONNECTING: on a phone that
     *   has never been paired, "taking over" names something the person has no
     *   idea about, while a socket dialling has an ordinary name.
     * @param allThroughBouncer when holding, whether *every* network it holds
     *   is reached through a bouncer. All rather than any, because the word
     *   has to be true of the whole picture: with one network through a soju
     *   and two straight to the server, the honest word is LIVE.
     */
    fun who(
        holding: Boolean,
        connecting: Boolean,
        peerHolding: Boolean,
        followingAlwaysOn: Boolean,
        everPaired: Boolean,
        allThroughBouncer: Boolean
    ): Holder = when {
        holding -> if (allThroughBouncer) Holder.BOUNCER else Holder.LIVE
        peerHolding && !connecting -> if (followingAlwaysOn) Holder.BOUNCER else Holder.DESKTOP
        connecting -> if (everPaired) Holder.TAKING_OVER else Holder.CONNECTING
        else -> Holder.OFFLINE
    }

    /** The word itself, spelled the way the desktop spells it */
    fun label(holder: Holder): String = when (holder) {
        Holder.LIVE -> "LIVE"
        Holder.BOUNCER -> "BOUNCER"
        Holder.DESKTOP -> "DESKTOP"
        Holder.CONNECTING -> "CONNECTING"
        Holder.TAKING_OVER -> "TAKING OVER"
        Holder.OFFLINE -> "OFFLINE"
    }
}
