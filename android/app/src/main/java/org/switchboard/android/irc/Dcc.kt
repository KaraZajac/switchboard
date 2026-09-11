package org.switchboard.android.irc

/**
 * DCC — files and chat, directly between two clients.
 *
 * The Kotlin half of `src/shared/dcc.ts`, checked against
 * `tests/fixtures/dcc.json`.
 *
 * Older than most of IRC and still how most of it moves a file. We have
 * `draft/filehost`, which is the better answer and which almost no network
 * runs; until they do, a file somebody offers arrives as a DCC SEND and
 * neither client had anything to say about it.
 *
 * The address is a *32-bit integer in decimal*, not a dotted quad — the single
 * most common thing to get wrong, and getting it wrong means connecting
 * somewhere else entirely.
 *
 * Nothing here opens a socket. This is the reading and writing of one line.
 */
object Dcc {

    /**
     * @param filename unquoted; empty for chat
     * @param address dotted quad, converted from the integer the protocol uses
     * @param port zero means the sender is asking us to listen — reverse DCC
     * @param size bytes, where the sender said; zero when unknown
     * @param token reverse DCC pairs an offer with its answer by this
     */
    data class Offer(
        val kind: String,
        val filename: String,
        val address: String,
        val port: Int,
        val size: Long,
        val token: String? = null
    )

    private val KINDS = setOf("send", "chat", "accept", "resume")

    /**
     * Read a DCC line out of a CTCP body.
     *
     * The body is what sits between the delimiters, with the `DCC` verb still
     * on the front — this checks for it rather than assuming.
     */
    fun parse(body: String): Offer? {
        val trimmed = body.trim()
        if (!Regex("^DCC\\s", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) return null

        val rest = trimmed.drop(4).trim()
        val kind = rest.split(Regex("\\s+")).firstOrNull()?.lowercase() ?: return null
        if (kind !in KINDS) return null

        val after = rest.drop(kind.length).trim()
        val (filename, tail) = readFilename(after)
        val parts = tail.split(Regex("\\s+")).filter { it.isNotEmpty() }

        if (kind == "chat") {
            // `DCC CHAT chat <address> <port>` — the middle word is always
            // "chat", which readFilename has already taken off the front.
            val address = parts.getOrNull(0) ?: return null
            val port = parts.getOrNull(1) ?: return null
            return Offer("chat", "", addressFrom(address), port.toIntOrNull() ?: 0, 0)
        }

        val address = parts.getOrNull(0) ?: return null
        val port = parts.getOrNull(1) ?: return null

        return Offer(
            kind = kind,
            filename = filename,
            address = addressFrom(address),
            port = port.toIntOrNull() ?: 0,
            size = parts.getOrNull(2)?.toLongOrNull() ?: 0,
            token = parts.getOrNull(3)
        )
    }

    /**
     * Write one.
     *
     * The address goes as an integer because that is what the protocol says,
     * and a client that sends a dotted quad is one older clients cannot read.
     */
    fun format(offer: Offer): String {
        val address = integerFrom(offer.address)

        if (offer.kind == "chat") return "DCC CHAT chat $address ${offer.port}"

        val name = if (offer.filename.contains(' ')) "\"${offer.filename}\"" else offer.filename
        val tail = offer.token?.let { " $it" } ?: ""
        return "DCC ${offer.kind.uppercase()} $name $address ${offer.port} ${offer.size}$tail"
    }

    /**
     * What to actually call the file on disk.
     *
     * The name comes from whoever sent it, so it is not a name — it is input.
     * A path separator, a parent reference, a leading dot or a device name
     * reserved on Windows all have to be gone before this touches a filesystem.
     */
    fun safeFilename(offered: String): String {
        // The last component, whichever separator was used
        val base = offered.split('/', '\\').last()

        val cleaned = base
            .replace(Regex("[\\u0000-\\u001f<>:\"|?*]"), "")
            .replace(Regex("\\.{2,}"), ".")
            .replace(Regex("^[.\\s]+"), "")
            .trim()

        if (cleaned.isEmpty()) return "received-file"

        val stem = cleaned.substringBefore('.').uppercase()
        val reserved = Regex("^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$")
        return if (reserved.matches(stem)) "_$cleaned" else cleaned
    }

    /** Whether this offer is the sender asking us to listen instead */
    fun isReverse(offer: Offer): Boolean = offer.port == 0

    /**
     * An IPv4 address as the protocol carries it.
     *
     * Anything that is not a plain integer is passed through: IPv6 has no such
     * encoding, and some clients send a dotted quad regardless.
     */
    fun addressFrom(value: String): String {
        if (!Regex("^\\d+$").matches(value)) return value

        val number = value.toLongOrNull() ?: return value
        if (number < 0 || number > 0xffffffffL) return value

        return listOf(
            (number shr 24) and 0xff,
            (number shr 16) and 0xff,
            (number shr 8) and 0xff,
            number and 0xff
        ).joinToString(".")
    }

    /** And back, for an offer we are making */
    fun integerFrom(address: String): String {
        val parts = address.split('.')
        if (parts.size != 4) return address

        var number = 0L
        for (part in parts) {
            val octet = part.toIntOrNull() ?: return address
            if (octet < 0 || octet > 255) return address
            number = number * 256 + octet
        }
        return number.toString()
    }

    /**
     * Read a filename off the front, quoted or not.
     *
     * A quoted name may contain spaces, which is the only reason the quoting
     * exists — and a client that splits on whitespace first reads
     * "my file.txt" as a file called `"my` offered from an address called
     * `file.txt"`.
     */
    private fun readFilename(input: String): Pair<String, String> {
        if (input.startsWith("\"")) {
            val end = input.indexOf('"', 1)
            if (end != -1) return input.substring(1, end) to input.substring(end + 1).trim()
        }

        val space = input.indexOf(' ')
        if (space == -1) return input to ""
        return input.substring(0, space) to input.substring(space + 1).trim()
    }
}
