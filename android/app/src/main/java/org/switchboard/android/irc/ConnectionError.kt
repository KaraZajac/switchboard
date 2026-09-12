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

        /** Anything else, including every non-TLS failure */
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

        return Problem.OTHER
    }

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

        Problem.OTHER -> raw?.trim()?.takeIf { it.isNotEmpty() } ?: "Could not connect"
    }
}
