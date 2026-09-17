package org.switchboard.android.irc

/**
 * What a link actually points at.
 *
 * A URL in a message is one of four things and looks like one thing: a
 * picture to show, a clip to play, a file to offer, or a page to describe.
 * Guessing from the extension gets the first two right most of the time and
 * everything else wrong — `example.org/photo` has no extension and is still a
 * photo, and an APK shared from a filehost is `…/f/abc123` with none at all.
 *
 * So the server is asked. `Content-Type` is the answer to "what is this", and
 * it is the one the far end is authoritative about; the extension is a guess
 * made before anybody looked.
 *
 * Kept alongside `src/shared/attachment.ts`, and checked against the same
 * corpus.
 */
object Attachment {

    enum class Kind { IMAGE, VIDEO, AUDIO, FILE, PAGE }

    private val IMAGE = listOf("jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "ico")
    private val VIDEO = listOf("mp4", "webm", "mov", "m4v", "mkv", "ogv")
    private val AUDIO = listOf("mp3", "ogg", "oga", "wav", "flac", "m4a", "opus", "aac")

    /**
     * What to make of a link.
     *
     * [contentType] is what the server said, where anybody has asked it. It
     * wins: a host that says `image/png` for a URL ending in `.txt` is
     * describing its own resource, and a client that argued would be wrong.
     */
    fun kind(url: String, contentType: String? = null): Kind {
        val stated = (contentType ?: "").substringBefore(';').trim().lowercase()

        if (stated.isNotEmpty()) {
            if (stated.startsWith("image/")) return Kind.IMAGE
            if (stated.startsWith("video/")) return Kind.VIDEO
            if (stated.startsWith("audio/")) return Kind.AUDIO
            if (stated == "text/html" || stated == "application/xhtml+xml") return Kind.PAGE
            return Kind.FILE
        }

        val extension = extensionOf(url) ?: return Kind.PAGE
        return when (extension) {
            in IMAGE -> Kind.IMAGE
            in VIDEO -> Kind.VIDEO
            in AUDIO -> Kind.AUDIO
            // Not known to be media and nobody has asked the server. Resolving
            // it is what the fetch is for; until then it is a link like any
            // other.
            else -> Kind.PAGE
        }
    }

    /**
     * What to call the file: the last path segment, unescaped.
     *
     * A query string is dropped because `?v=2` is not part of what something
     * is called, and the host stands in where there is no segment at all, so
     * a card is never headed with an empty string.
     */
    fun name(url: String): String {
        val path = pathOf(url) ?: return url
        val last = path.split('/').lastOrNull { it.isNotEmpty() }
            ?: return hostOf(url) ?: url

        // A stray `%` is not an escape. `URLDecoder` throws on it and so does
        // `decodeURIComponent` on the desktop, and both answer with the name
        // as written — which is what somebody called the file.
        return runCatching { java.net.URLDecoder.decode(last, "UTF-8") }.getOrDefault(last)
    }

    /**
     * How big it is, for somebody deciding whether to tap it on mobile data.
     *
     * Powers of 1024 under the names everybody writes, which is what every
     * file manager and chat client does. Null where the server did not say, so
     * a card leaves the line out rather than printing a confident zero.
     */
    fun humanSize(bytes: Long?): String? {
        if (bytes == null || bytes < 0) return null
        if (bytes < 1024) return "$bytes B"

        val units = listOf("KB", "MB", "GB", "TB")
        var size = bytes.toDouble() / 1024
        var unit = 0
        while (size >= 1024 && unit < units.size - 1) {
            size /= 1024
            unit++
        }
        return String.format(java.util.Locale.US, "%.2f %s", size, units[unit])
    }

    private fun extensionOf(url: String): String? {
        val path = pathOf(url) ?: url.substringBefore('?').substringBefore('#')
        val last = path.split('/').lastOrNull().orEmpty()
        val dot = last.lastIndexOf('.')
        if (dot <= 0 || dot == last.length - 1) return null
        return last.substring(dot + 1).lowercase()
    }

    /**
     * The path, without asking `java.net.URI` whether it approves.
     *
     * It does not, for a good deal of what people paste: a bare `%` is an
     * invalid escape and `URI` throws rather than shrugging, where the web
     * platform the desktop is built on carries on and hands back the path. The
     * two clients have to read a link the same way, so this reads it the
     * tolerant way.
     *
     * Null where there is no scheme at all, which is not a link.
     */
    private fun pathOf(url: String): String? {
        val bare = url.substringBefore('#').substringBefore('?')
        val scheme = bare.indexOf("://")
        if (scheme == -1) return null

        val afterHost = bare.substring(scheme + 3)
        val slash = afterHost.indexOf('/')
        return if (slash == -1) "" else afterHost.substring(slash)
    }

    /**
     * The host, read by hand.
     *
     * Also what a link card falls back to when a page sets no `og:site_name`,
     * which plenty do not — see `LinkCard`.
     */
    fun hostOf(url: String): String? {
        val bare = url.substringBefore('#').substringBefore('?')
        val scheme = bare.indexOf("://")
        if (scheme == -1) return null
        return bare.substring(scheme + 3).substringBefore('/').substringAfter('@')
            .substringBefore(':')
            .takeIf { it.isNotEmpty() }
    }
}
