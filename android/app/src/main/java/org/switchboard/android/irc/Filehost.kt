package org.switchboard.android.irc

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Base64

/**
 * Sending a file to the network's own filehost.
 *
 * The Kotlin half of `src/shared/filehost.ts`, checked against
 * `tests/fixtures/filehost.json`. `draft/filehost` is an ISUPPORT token rather
 * than a capability: the network names an HTTP endpoint, a client POSTs the
 * bytes, and the reply is the URL to paste into the channel. It is the only
 * file transfer in IRC that works through a NAT, which is to say the only one
 * that works.
 *
 * The desktop has had this since it had a file picker. The phone had no attach
 * button at all — which is the wrong way round, because the photograph is on
 * the phone and sharing one is most of what a phone is for.
 */
object Filehost {

    /**
     * Where this network takes uploads, or null if it takes none.
     *
     * Either spelling, because the token keeps its `draft/` prefix until the
     * specification is ratified and servers sit on both sides of that — see
     * [Isupport.value].
     */
    fun url(isupport: Map<String, String>, overTls: Boolean = true): String? {
        val value = Isupport.value(isupport, "FILEHOST") ?: return null
        if (value.isEmpty()) return null

        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        if (!uri.isAbsolute) return null
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return null
        if (uri.host.isNullOrEmpty()) return null

        /*
         * The spec: a client MUST refuse a plaintext upload URI when the IRC
         * connection is encrypted. Worth saying why, because "we already send
         * the password over it" reads it backwards. Somebody who connected
         * over TLS has said what they expect of this network, and the upload
         * URI is a string that network chose — so a plaintext one is either a
         * misconfiguration or somebody redirecting the files, and either way
         * the file and its address go somewhere nobody agreed to.
         *
         * Defaulting to strict, so a caller that forgets to say gets the safe
         * answer rather than the permissive one.
         */
        if (overTls && scheme != "https") return null

        return value
    }

    /**
     * The `Content-Disposition` for an upload, with the name intact.
     *
     * Quoting the name and hoping is not enough. A filename on a phone may
     * contain a quote, a backslash or a comma, and the quoted-string form says
     * what to do about it — escape it — which is what stops `my "best"
     * shot.png` arriving as `my `.
     *
     * A header value is ASCII, and both runtimes refuse to send one outside it
     * rather than guessing an encoding. So a photo named in Japanese did not
     * upload at all. The real name travels in `filename*` per RFC 6266, and
     * the quoted form carries a stand-in that keeps the extension.
     *
     * `inline`, following the spec's own example: a file sent as `attachment`
     * downloads when somebody opens the link, and an image posted in a channel
     * should open.
     */
    fun contentDisposition(fileName: String): String {
        // A newline would be a second header and a NUL ends the string in some
        // parsers. Neither belongs in a filename anybody meant to use.
        val clean = fileName.filter { it.code >= 0x20 && it.code != 0x7f }.trim()
            .ifEmpty { "file" }

        val plain = asciiOnly(clean)
        val escaped = plain.replace("\\", "\\\\").replace("\"", "\\\"")
        val ascii = "inline; filename=\"$escaped\""

        // Nothing was lost, so there is nothing for the second form to carry
        if (plain == clean) return ascii

        return "$ascii; filename*=UTF-8''${encodeRfc5987(clean)}"
    }

    /** The same name with everything a header cannot carry taken out */
    private fun asciiOnly(name: String): String {
        val stripped = name
            .map { if (it.code in 0x20..0x7e) it else '_' }
            .joinToString("")
            .replace(Regex("_+"), "_")

        // Judged on the stem, not the extension: `写真.jpg` keeps a `.jpg`
        // either way, and `_.jpg` is not a name — it is what is left of one.
        val dot = stripped.lastIndexOf('.')
        val stem = if (dot > 0) stripped.substring(0, dot) else stripped
        if (stem.replace(Regex("[_\\s]"), "").isNotEmpty()) return stripped

        val extension =
            if (dot > 0) stripped.substring(dot + 1).replace(Regex("[^A-Za-z0-9]"), "") else ""
        return if (extension.isNotEmpty()) "file.$extension" else "file"
    }

    /**
     * Percent-encode for the `filename*` form.
     *
     * `!'()*` are not `attr-char` in RFC 5987, and a receiver following the
     * grammar rejects the whole parameter — so a name with an apostrophe in it
     * silently loses its accents everywhere.
     */
    private fun encodeRfc5987(value: String): String = buildString {
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val c = byte.toInt().toChar()
            if (c.isLetterOrDigit() && c.code < 0x80 || c in "-._~") {
                append(c)
            } else {
                append('%').append("%02X".format(byte.toInt() and 0xff))
            }
        }
    }

    /**
     * Whether this filehost will take a file of this type.
     *
     * From `Accept-Post`, which the spec lets a server return from `OPTIONS`
     * on the upload URI. Asking first is worth one round trip: the alternative
     * is sending a video over a phone connection and being told at the end of
     * it that this network only takes images.
     *
     * A server that says nothing accepts everything, which is what the spec
     * means by MAY — refusing on silence would break every filehost that has
     * not implemented `OPTIONS`.
     */
    fun acceptsType(acceptPost: String?, contentType: String): Boolean {
        val offered = acceptPost?.trim()
        if (offered.isNullOrEmpty()) return true

        val type = contentType.substringBefore(';').trim().lowercase()
        if (type.isEmpty()) return false

        for (raw in offered.split(',')) {
            // `image/*; q=0.8` — the parameters are not part of the match
            val pattern = raw.substringBefore(';').trim().lowercase()
            if (pattern.isEmpty()) continue

            if (pattern == "*/*" || pattern == type) return true

            val group = pattern.substringBefore('/')
            if (pattern.endsWith("/*") && group.isNotEmpty() && type.startsWith("$group/")) {
                return true
            }
        }

        return false
    }

    /**
     * What to tell somebody whose file was refused before it was sent.
     *
     * Names what the server does take, because "that file type is not allowed"
     * on its own leaves them guessing which of their photos might work.
     */
    fun describeAccepted(acceptPost: String?): String? {
        val offered = acceptPost?.trim()
        if (offered.isNullOrEmpty()) return null

        val kinds = offered.split(',')
            .map { it.substringBefore(';').trim() }
            .filter { it.isNotEmpty() && it != "*/*" }

        return if (kinds.isNotEmpty()) kinds.joinToString(", ") else null
    }

    /**
     * Whether it is safe to prove who we are to this filehost.
     *
     * The upload carries the account password in a Basic header, because that
     * is how the draft says to authenticate. Over plain http that hands the
     * password to anyone on the path — and unlike the IRC connection, which
     * STS and the user's own port choice protect, this URL is whatever the
     * server said.
     */
    fun mayAuthenticate(url: String): Boolean =
        runCatching { URI(url).scheme?.lowercase() == "https" }.getOrDefault(false)

    /**
     * The URL of the file that was just uploaded.
     *
     * The filehost answers 201 with a `Location`, which the draft allows to be
     * relative — and a relative one pasted into a channel is a link to nothing.
     */
    fun uploaded(location: String?, base: String): String? {
        val trimmed = location?.trim()
        if (trimmed.isNullOrEmpty()) return null

        val resolved = runCatching { URI(base).resolve(trimmed) }.getOrNull() ?: return null
        // The filehost chose this string and the next thing that happens to it
        // is being pasted into a channel — so it is a link this person
        // publishes to everyone there. `Location: javascript:…` resolves
        // perfectly well and is not a file anybody uploaded.
        val scheme = resolved.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return null
        return resolved.toString()
    }

    /**
     * What this filehost says it takes, or null if it does not say.
     *
     * `OPTIONS` on the upload URI, which the spec requires servers to answer.
     * Worth one round trip on a phone above all: the alternative is sending a
     * video over mobile data and being told at the end of it that this network
     * only takes images.
     *
     * Never throws. A filehost that does not answer — which is most of them
     * today, spec or no spec — must not become a filehost you cannot use.
     */
    fun acceptedTypes(endpoint: String): String? = runCatching {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "OPTIONS"
            connectTimeout = 5_000
            readTimeout = 5_000
            instanceFollowRedirects = false
        }
        try {
            connection.getHeaderField("Accept-Post")
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

    /** What went wrong, in a sentence worth showing */
    class Refused(message: String) : Exception(message)

    /**
     * POST the bytes and return the link.
     *
     * Blocking: the caller is on a background dispatcher. Streamed rather than
     * held in memory, because the thing being shared from a phone is usually a
     * photograph and sometimes a video.
     */
    fun upload(
        endpoint: String,
        bytes: InputStream,
        length: Long,
        fileName: String,
        contentType: String,
        account: String? = null,
        password: String? = null
    ): String {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 120_000
            instanceFollowRedirects = false

            setRequestProperty("Content-Type", contentType)
            setRequestProperty("Content-Disposition", contentDisposition(fileName))
            if (length > 0) setFixedLengthStreamingMode(length)

            if (!account.isNullOrEmpty() && !password.isNullOrEmpty() && mayAuthenticate(endpoint)) {
                val credentials = Base64.getEncoder()
                    .encodeToString("$account:$password".toByteArray())
                setRequestProperty("Authorization", "Basic $credentials")
            }
        }

        try {
            connection.outputStream.use { out -> bytes.copyTo(out) }

            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_CREATED) {
                val said = runCatching {
                    (connection.errorStream ?: connection.inputStream)
                        .bufferedReader().readText().trim().take(200)
                }.getOrDefault("")
                throw Refused(
                    if (said.isEmpty()) "The filehost refused that ($code)."
                    else "The filehost refused that ($code): $said"
                )
            }

            val location = connection.getHeaderField("Location")
                ?: runCatching { connection.inputStream.bufferedReader().readText().trim() }
                    .getOrNull()

            return uploaded(location, endpoint)
                ?: throw Refused("The filehost did not say where the file went.")
        } finally {
            connection.disconnect()
        }
    }
}
