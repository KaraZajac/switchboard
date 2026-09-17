package org.switchboard.android.irc

/**
 * Why we are in a channel.
 *
 * A `JOIN` for ourselves says where we now are and nothing about how we got
 * there, and the three ways are not the same thing at all. Only one of them is
 * a decision, and only a decision belongs in the config both devices read —
 * see `rememberJoin`, and the desktop's `JoinReason` in `src/main/irc/client.ts`,
 * which this is the twin of.
 */
enum class JoinReason {
    /**
     * Somebody asked for it: `/join`, a channel tapped in the list, an `irc://`
     * link, `/cycle`. The only one worth writing into the shared config.
     */
    USER,

    /**
     * This connection carrying out a list it already had: the auto-join at
     * registration, a rejoin after a kick, a server's `draft/auto-join` hint.
     * Not news — the list is where it came from.
     */
    DIAL,

    /**
     * Nobody here asked at all. The server put us there: UnrealIRCd's
     * `set::auto-join`, services rejoining an account where it usually is, an
     * operator's `SAJOIN`, a `+L` forward out of a channel that was full.
     */
    SERVER
}
