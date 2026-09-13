package org.switchboard.android.irc

/**
 * What went wrong reaching a server, in words somebody can act on.
 *
 * The Kotlin half of `src/shared/connectionerror.ts`, checked against
 * `tests/fixtures/connectionerror.json`.
 *
 * A failed TLS handshake arrives as whatever the platform's own library calls
 * it — "No subjectAltNames on the certificate match" here, an
 * `ERR_TLS_CERT_ALTNAME_INVALID` on the desktop. Both were shown verbatim, and
 * the one they describe is the failure a person most needs to understand: a
 * certificate that does not match the address is what being intercepted looks
 * like.
 */
object ConnectionError {

    enum class Problem {
        /** The certificate is for some other address */
        WRONG_HOST,

        /** Signed by somebody this device does not trust */
        UNTRUSTED,

        /** Trusted and matching, but out of date */
        EXPIRED,

        /** The port is closed, or something between here and there is blocking it */
        REFUSED,
        /** The name does not resolve */
        NOT_FOUND,
        /** Nothing answered */
        TIMEOUT,
        /** No route from this network */
        UNREACHABLE,
        /** A connection that was made and then dropped */
        RESET,
        /** Anything else */
        OTHER
    }

    /** Which of the failures we have something to say about this is */
    fun problemOf(raw: String?): Problem {
        val text = raw.orEmpty().lowercase()
        if (text.isEmpty()) return Problem.OTHER

        // Android, then Node. Each platform has more than one phrasing
        // depending on which layer noticed.
        if (
            text.contains("altname") ||
            text.contains("hostname/ip does not match") ||
            text.contains("subject alternative dns name") ||
            text.contains("no subjectaltnames")
        ) {
            return Problem.WRONG_HOST
        }

        if (
            text.contains("self_signed") ||
            text.contains("self signed") ||
            text.contains("unable_to_verify_leaf_signature") ||
            text.contains("unable_to_get_issuer") ||
            text.contains("trust anchor for certification path not found")
        ) {
            return Problem.UNTRUSTED
        }

        if (text.contains("cert_has_expired") || text.contains("certificate expired")) {
            return Problem.EXPIRED
        }

        // The rest are not about certificates. Node names the errno; Android
        // writes it out, or says nothing at all and just reports how long it
        // waited — the last of which is what a timeout looks like here.
        if (text.contains("econnrefused") || text.contains("connection refused")) return Problem.REFUSED
        if (
            text.contains("enotfound") ||
            text.contains("eai_again") ||
            text.contains("eai_noname") ||
            text.contains("unable to resolve host") ||
            text.contains("no address associated") ||
            text.contains("nodename nor servname") ||
            text.contains("name or service not known")
        ) {
            return Problem.NOT_FOUND
        }
        if (
            text.contains("ehostunreach") ||
            text.contains("enetunreach") ||
            text.contains("network is unreachable") ||
            text.contains("no route to host")
        ) {
            return Problem.UNREACHABLE
        }
        if (
            text.contains("econnreset") ||
            text.contains("connection reset") ||
            text.contains("socket hang up") ||
            text.contains("connection abort") ||
            text.contains("epipe") ||
            text.contains("broken pipe")
        ) {
            return Problem.RESET
        }
        if (
            text.contains("etimedout") ||
            text.contains("timed out") ||
            text.contains("timeout") ||
            WAITED.containsMatchIn(text)
        ) {
            return Problem.TIMEOUT
        }
        return Problem.OTHER
    }

    /** Android's connect timeout: how long it waited, and nothing else */
    private val WAITED = Regex("""after \d+ms\s*$""")

    /**
     * The sentence to show.
     *
     * "Nothing was sent" is the part that matters and it is true: the
     * handshake is checked before a single byte of registration goes out, so a
     * refused certificate never saw the password.
     */
    fun describe(raw: String?, host: String): String = when (problemOf(raw)) {
        Problem.WRONG_HOST ->
            "The certificate $host presented is for a different address. " +
                "This may not be the server you meant — nothing was sent."

        Problem.UNTRUSTED ->
            "The certificate $host presented is signed by an authority this " +
                "device does not trust. Nothing was sent."

        Problem.EXPIRED ->
            "The certificate $host presented has expired. Nothing was sent."

        Problem.REFUSED ->
            "$host refused the connection. Nothing is listening on that port, " +
                "or something between here and there is blocking it."
        Problem.NOT_FOUND ->
            "$host could not be found. Check the address, and that this device is online."
        Problem.TIMEOUT ->
            "$host did not answer. It may be down, or something between here and " +
                "there is dropping the connection."
        Problem.UNREACHABLE -> "There is no route to $host from this network."
        Problem.RESET -> "The connection to $host was dropped."
        Problem.OTHER -> raw?.trim()?.takeIf { it.isNotEmpty() } ?: "Could not connect"
    }
}
