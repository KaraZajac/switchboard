package org.switchboard.android.irc

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * draft/metadata-2 — the profile behind a nick.
 *
 * Avatar, display name, pronouns, status, colour. Subscribing is what makes it
 * live: without a SUB the server answers a direct GET and never tells you when
 * someone changes theirs, so every profile silently goes stale.
 */
internal object Metadata {

    /** The keys we render, matching `src/shared/types/metadata.ts` */
    val KEYS = listOf("avatar", "display-name", "homepage", "pronouns", "status", "color")

    /** What the server said it will hold, from `draft/metadata-2=…` */
    data class Limits(
        val maxSubs: Int? = null,
        val maxKeys: Int? = null,
        val maxValueBytes: Int? = null
    )

    /**
     * Read the limits out of the capability value.
     *
     * rIRCd advertises `max-subs=50,max-keys=50,max-value-bytes=4096`, and a
     * value over the last of those is refused rather than truncated — so a
     * profile with a long bio in it is not saved anywhere, and the user was
     * told that it had been.
     */
    fun limitsFrom(value: String?): Limits {
        if (value.isNullOrBlank()) return Limits()

        var subs: Int? = null
        var keys: Int? = null
        var valueBytes: Int? = null

        for (token in value.split(',')) {
            val at = token.indexOf('=')
            if (at == -1) continue

            val key = token.substring(0, at).trim()
            val count = token.substring(at + 1).trim().toIntOrNull() ?: continue
            if (count <= 0) continue

            when (key) {
                "max-subs" -> subs = count
                "max-keys" -> keys = count
                "max-value-bytes" -> valueBytes = count
            }
        }

        return Limits(subs, keys, valueBytes)
    }

    private fun limitsOf(session: IrcSession): Limits =
        limitsFrom(session.state.available["draft/metadata-2"])

    /**
     * Whether a value is short enough for this server to keep.
     *
     * Counted in UTF-8 bytes, which is what the limit is in — a bio in
     * Japanese hits it at a third of the characters an English one does.
     */
    fun valueFits(session: IrcSession, value: String): Boolean {
        val limit = limitsOf(session).maxValueBytes ?: return true
        return value.toByteArray(Charsets.UTF_8).size <= limit
    }

    /**
     * Subscribe, trimmed to what the server will take.
     *
     * Asking for more keys than `max-subs` gets the whole subscription
     * refused, which costs every profile on the network rather than the one
     * key past the limit.
     */
    fun subscribe(session: IrcSession) {
        if (!session.state.capabilities.contains("draft/metadata-2")) return

        val maxSubs = limitsOf(session).maxSubs
        val keys = if (maxSubs == null) KEYS else KEYS.take(maxSubs)
        if (keys.isEmpty()) return

        session.send("METADATA", "*", "SUB", *keys.toTypedArray())
    }

    fun sync(session: IrcSession, target: String) {
        if (!session.state.capabilities.contains("draft/metadata-2")) return
        session.send("METADATA", target, "SYNC")
    }

    /**
     * Subscribe, then publish our own profile.
     *
     * Metadata does not survive a disconnect on most servers, so what is stored
     * locally is the source of truth and goes up on every connect — and after
     * 001, never at the end of capability negotiation, because with SASL those
     * are seconds apart and anything in between comes back as 451.
     */
    fun publishProfile(session: IrcSession) {
        if (!session.state.capabilities.contains("draft/metadata-2")) return

        subscribe(session)

        val profile = buildMap {
            session.config.avatarUrl?.takeIf { it.isNotBlank() }?.let { put("avatar", it) }
            putAll(session.config.profile.filterValues { it.isNotBlank() })
        }
        for ((key, value) in profile) {
            if (key !in KEYS) continue
            // Over the server's limit is refused outright, and one refused key
            // must not take the rest of the profile with it.
            if (!valueFits(session, value)) continue
            session.send("METADATA", "*", "SET", key, value)
        }
    }

    private fun remember(session: IrcSession, target: String, key: String, value: String) {
        val store = session.state.metadata.getOrPut(target.lowercase()) { mutableMapOf() }
        if (value.isEmpty()) store.remove(key) else store[key] = value
    }

    internal fun emitValue(session: IrcSession, target: String, key: String, value: String) {
        remember(session, target, key, value)
        session.emit("irc:metadata", buildJsonObject {
            put("serverId", session.state.serverId)
            put("target", target)
            put("key", key)
            put("value", value)
        })
    }
}

internal fun registerMetadataHandlers() {

    // RPL_KEYVALUE — <me> <target> <key> <visibility> :<value>
    Handlers.on("761") { session, message ->
        val target = message.param(1) ?: return@on
        val key = message.param(2) ?: return@on
        Metadata.emitValue(session, target, key, message.param(4).orEmpty())
    }

    // RPL_KEYNOTSET — the key has no value, which is a value to us
    Handlers.on("766") { session, message ->
        val target = message.param(1) ?: return@on
        val key = message.param(2) ?: return@on
        Metadata.emitValue(session, target, key, "")
    }

    // RPL_METADATAEND / RPL_METADATASUBOK / RPL_METADATASUBS — confirmation only
    Handlers.on("762") { _, _ -> }
    Handlers.on("770") { _, _ -> }
    Handlers.on("772") { _, _ -> }

    // RPL_METADATASYNCLATER — <me> <target> [<retry-after>]
    Handlers.on("774") { session, message ->
        val target = message.param(1) ?: return@on
        val retryAfter = message.param(2)?.toLongOrNull() ?: 10L
        session.emit("irc:metadata-later", buildJsonObject {
            put("serverId", session.state.serverId)
            put("target", target)
            put("retryAfterSeconds", retryAfter)
        })
    }

    /** A live change, pushed because we subscribed */
    Handlers.on("METADATA") { session, message ->
        val target = message.param(0) ?: return@on

        // :nick METADATA <target> <key> <visibility> :<value>, and with no
        // value at all the key was cleared.
        val key = message.param(1) ?: return@on
        val value = if (message.params.size >= 4) message.params.last() else ""
        Metadata.emitValue(session, target, key, value)
    }
}

/**
 * Standard replies: FAIL, WARN, NOTE.
 *
 * A machine-readable error with a command and a code, which is what makes it
 * possible to say something useful instead of printing a server's prose.
 */
internal fun registerErrorHandlers() {

    for (severity in listOf("FAIL", "WARN", "NOTE")) {
        Handlers.on(severity) { session, message ->
            session.emit("irc:standard-reply", buildJsonObject {
                put("serverId", session.state.serverId)
                put("severity", severity)
                put("command", message.param(0))
                put("code", message.param(1))
                put("context", message.params.drop(2).dropLast(1).joinToString(" "))
                put("message", message.params.lastOrNull())
            })

            if (severity == "FAIL") {
                session.emit("irc:error", buildJsonObject {
                    put("serverId", session.state.serverId)
                    put("message", message.params.lastOrNull() ?: "The server refused that")
                })
            }
        }
    }

    // The errors worth surfacing rather than swallowing
    val messages = mapOf(
        "401" to "No such nick",
        "403" to "No such channel",
        "404" to "Cannot send to channel",
        "405" to "You have joined too many channels",
        "421" to "Unknown command",
        "442" to "You are not on that channel",
        "451" to "You have not registered",
        "461" to "Not enough parameters",
        "471" to "Channel is full",
        "473" to "Channel is invite-only",
        "474" to "You are banned from that channel",
        "475" to "Wrong channel key",
        "482" to "You need to be a channel operator"
    )

    for ((numeric, fallback) in messages) {
        Handlers.on(numeric) { session, message ->
            session.emit("irc:error", buildJsonObject {
                put("serverId", session.state.serverId)
                put("code", numeric)
                // `command` rather than `target`, because that is what the
                // desktop calls it — the store reads whichever client sent it
                put("command", message.param(1))
                put("message", message.params.lastOrNull()?.takeIf { it.isNotBlank() } ?: fallback)
            })
        }
    }
}
