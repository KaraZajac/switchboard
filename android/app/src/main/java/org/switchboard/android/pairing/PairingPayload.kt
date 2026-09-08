package org.switchboard.android.pairing

/**
 * What the phone scanned, or what someone pasted.
 *
 * A port of `src/shared/pairing.ts` on the desktop, checked against the same
 * cases in `tests/fixtures/pairing.json` — the desktop writes these strings and
 * this reads them, so the two have to agree about every shape, including the
 * ones that should be refused.
 */
data class PairingPayload(val ticket: String, val code: String?)

const val PAIRING_SCHEME = "switchboard"
const val PAIRING_HOST = "pair"

object Pairing {

    /** Build the URI a desktop encodes into its QR code */
    fun encode(ticket: String, code: String?): String {
        val params = StringBuilder("ticket=").append(urlEncode(ticket))
        if (!code.isNullOrEmpty()) params.append("&code=").append(urlEncode(code))
        return "$PAIRING_SCHEME://$PAIRING_HOST?$params"
    }

    /**
     * Read whatever arrived.
     *
     * Accepts the URI form and a bare ticket, because a ticket is what earlier
     * builds put in the QR and what someone copying by hand will paste.
     */
    fun parse(input: String): PairingPayload? {
        val text = input.trim()
        if (text.isEmpty()) return null

        if (text.lowercase().startsWith("$PAIRING_SCHEME://")) {
            val query = text.substringAfter('?', "")
            if (query.isEmpty()) return null

            val params = query.split('&').mapNotNull { pair ->
                val key = pair.substringBefore('=', "")
                if (key.isEmpty()) null else key to urlDecode(pair.substringAfter('=', ""))
            }.toMap()

            val ticket = params["ticket"]?.trim().orEmpty()
            if (ticket.isEmpty()) return null
            return PairingPayload(ticket, params["code"]?.trim()?.ifEmpty { null })
        }

        // A bare ticket. Anything carrying a URI scheme is some other app's link
        // and would fail much later with nothing to point at; a sentence is not
        // a ticket either.
        if (text.any { it.isWhitespace() }) return null
        if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(text)) return null
        return PairingPayload(text, null)
    }

    // URLEncoder turns a space into '+', which URLSearchParams on the desktop
    // reads back as a space — but a '+' inside a ticket must survive as a '+'.
    private fun urlEncode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun urlDecode(value: String): String =
        runCatching { java.net.URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
}
