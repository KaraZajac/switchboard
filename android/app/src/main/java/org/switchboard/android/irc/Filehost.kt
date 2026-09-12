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
     * Both spellings, because the token was renamed when the draft moved and
     * servers are on both sides of that.
     */
    fun url(isupport: Map<String, String>): String? {
        val value = isupport["FILEHOST"] ?: isupport["draft/FILEHOST"] ?: return null
        if (value.isEmpty()) return null

        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        if (!uri.isAbsolute) return null
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return null
        if (uri.host.isNullOrEmpty()) return null
        return value
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
            // The quotes matter: a filename with a space in it is ordinary on a
            // phone, and unquoted it ends the header early.
            setRequestProperty(
                "Content-Disposition",
                "attachment; filename=\"${fileName.replace("\"", "")}\""
            )
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
