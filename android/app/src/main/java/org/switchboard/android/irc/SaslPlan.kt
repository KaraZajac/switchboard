package org.switchboard.android.irc

/**
 * Whether to log in, how, and what to say when we cannot.
 *
 * The Kotlin half of `src/shared/saslplan.ts`, checked against
 * `tests/fixtures/saslplan.json`.
 *
 * The two clients disagreed about this quietly, in a way nothing on screen
 * would explain: this one authenticated whenever a password was saved and
 * defaulted the mechanism to PLAIN, and the desktop authenticated only when a
 * mechanism had been chosen and never checked there was a password to send. So
 * one config logged in here and sat there as a stranger at the desk.
 */
object SaslPlan {

    /**
     * @param mechanism what the user picked, or null for "work it out"
     * @param username the account name, or null to use the nick
     * @param clientCert the credential EXTERNAL uses instead of a password
     * @param unreadable credentials that are stored and cannot be read back
     */
    data class Config(
        val mechanism: String? = null,
        val username: String? = null,
        val password: String? = null,
        val clientCert: String? = null,
        val unreadable: List<String> = emptyList()
    )

    sealed interface Plan {
        /** Send `AUTHENTICATE <mechanism>` and carry on */
        data class Authenticate(val mechanism: String) : Plan

        /** Nothing was set up. Not an error — plenty of networks need no account. */
        data object Skip : Plan

        /** Set up, and cannot work. Say so rather than let the server answer 904. */
        data class Refuse(val reason: String) : Plan
    }

    private const val EXTERNAL = "EXTERNAL"

    /**
     * What to do about logging in.
     *
     * [offered] is the capability's value split out — `sasl=PLAIN,SCRAM-SHA-256`
     * — or null where the server named none, which the spec allows and means
     * "ask and find out".
     */
    fun of(config: Config, offered: List<String>?): Plan {
        val chosen = config.mechanism?.trim()?.uppercase()?.takeIf { it.isNotEmpty() }

        // Nothing chosen: PLAIN if there is a password to send with it, and
        // otherwise nothing at all. Somebody who filled in a username and a
        // password is expecting to be logged in, and those two fields are the
        // whole of what PLAIN needs.
        val mechanism = chosen ?: if (!config.password.isNullOrEmpty()) "PLAIN" else null
        if (mechanism == null) return Plan.Skip

        // A credential that is stored and cannot be read back is not one.
        if ("saslPassword" in config.unreadable) {
            return Plan.Refuse(
                "Your saved password for this network could not be read — it was encrypted " +
                    "by a keyring this computer no longer has. Enter it again in the network " +
                    "settings."
            )
        }

        if (mechanism == EXTERNAL) {
            if (config.clientCert.isNullOrEmpty()) {
                return Plan.Refuse(
                    "SASL EXTERNAL needs a client certificate, and this network has none set up."
                )
            }
        } else if (config.password.isNullOrEmpty()) {
            return Plan.Refuse(
                "SASL $mechanism needs a password, and this network has none saved."
            )
        }

        // What the server says it will take. Sending something not on the list
        // gets a bare 904 and somebody staring at "authentication failed" with
        // no way to know their account was never the problem.
        if (offered != null && offered.isNotEmpty() && mechanism !in offered) {
            return Plan.Refuse(
                "This server does not offer $mechanism. It accepts ${offered.joinToString(", ")}."
            )
        }

        return Plan.Authenticate(mechanism)
    }

    /** The account name to authenticate as, which falls back to the nick */
    fun account(config: Config, nick: String): String =
        config.username?.trim()?.takeIf { it.isNotEmpty() } ?: nick
}
