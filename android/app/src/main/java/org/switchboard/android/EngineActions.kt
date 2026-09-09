package org.switchboard.android

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.switchboard.android.irc.ServerConfig
import java.time.Instant

/**
 * Everything the app can be asked to do.
 *
 * Split out of [SwitchboardEngine] because that class is about *which* client
 * is live and this one is about what a client can do — the failover machinery
 * and the feature surface were interleaved and both were harder to read for it.
 *
 * Each of these works in both modes. `act` sends a command, either down our own
 * socket or through the desktop; `ask` fetches something the desktop stores,
 * with a local answer where the phone can produce one.
 */

// ── saying things ────────────────────────────────────────────────────

fun SwitchboardEngine.say(serverId: String, target: String, text: String) =
    act(serverId, "message:send", JsonPrimitive(target), JsonPrimitive(text)) { it.say(target, text) }

fun SwitchboardEngine.reply(serverId: String, target: String, messageId: String, text: String) =
    act(
        serverId, "message:reply",
        JsonPrimitive(target), JsonPrimitive(messageId), JsonPrimitive(text)
    ) { it.reply(target, messageId, text) }

/** Change something already said. Old clients see a second message; that is the spec. */
fun SwitchboardEngine.editMessage(serverId: String, target: String, messageId: String, text: String) =
    act(
        serverId, "message:edit",
        JsonPrimitive(target), JsonPrimitive(messageId), JsonPrimitive(text)
    ) { it.edit(target, messageId, text) }

/** React to a message, or take the reaction back */
fun SwitchboardEngine.react(
    serverId: String,
    target: String,
    messageId: String,
    emoji: String,
    remove: Boolean = false
) =
    act(
        serverId, "message:react",
        JsonPrimitive(target), JsonPrimitive(messageId), JsonPrimitive(emoji), JsonPrimitive(remove)
    ) { it.react(target, messageId, emoji, remove) }

fun SwitchboardEngine.redact(serverId: String, target: String, messageId: String) =
    act(serverId, "message:redact", JsonPrimitive(target), JsonPrimitive(messageId)) {
        it.redact(target, messageId)
    }

fun SwitchboardEngine.setTyping(serverId: String, target: String, typing: Boolean) {
    val state = if (typing) "active" else "done"
    act(serverId, "message:typing", JsonPrimitive(target), JsonPrimitive(state)) {
        it.setTyping(target, state)
    }
}

// ── channels ─────────────────────────────────────────────────────────

fun SwitchboardEngine.join(serverId: String, channel: String) =
    act(serverId, "channel:join", JsonPrimitive(channel)) { it.join(channel) }

fun SwitchboardEngine.part(serverId: String, channel: String) =
    act(serverId, "channel:part", JsonPrimitive(channel)) { it.part(channel) }

fun SwitchboardEngine.setTopic(serverId: String, channel: String, topic: String) =
    act(serverId, "channel:topic", JsonPrimitive(channel), JsonPrimitive(topic)) {
        it.setTopic(channel, topic)
    }

fun SwitchboardEngine.kick(serverId: String, channel: String, nick: String, reason: String?) =
    act(
        serverId, "user:kick",
        JsonPrimitive(channel), JsonPrimitive(nick),
        reason?.let { JsonPrimitive(it) } ?: JsonNull
    ) { it.kick(channel, nick, reason) }

/** One channel on the network, as LIST describes it */
data class ChannelListing(val name: String, val users: Int, val topic: String)

/**
 * Browse what is on the network.
 *
 * A big network answers with thousands of lines, so both paths are bounded: the
 * desktop gives up after fifteen seconds, and holding the connection ourselves
 * we stop at whatever has arrived when the 323 comes or the wait runs out.
 */
suspend fun SwitchboardEngine.listChannels(serverId: String): List<ChannelListing> {
    // Both paths fill the store, because the screen renders from the store: the
    // holding path has to (entries trickle in as 322s), and the following path
    // must too or the screen shows nothing while this returns a full list.
    store.beginChannelList(serverId)

    if (isHolding) {
        val connection = connections[serverId] ?: run {
            store.endChannelList()
            return emptyList()
        }
        connection.list()
        withTimeoutOrNull(LIST_TIMEOUT_MS) {
            while (!store.channelListComplete) delay(150)
        }
        store.endChannelList()
        return store.channelListing.toList()
    }

    val answer = ask("channel:list", JsonPrimitive(serverId)) as? JsonArray
    val listing = answer?.mapNotNull { entry ->
        val row = entry as? JsonObject ?: return@mapNotNull null
        ChannelListing(
            name = row["name"].text() ?: return@mapNotNull null,
            users = row["userCount"]?.jsonPrimitive?.intOrNull ?: 0,
            topic = row["topic"].text().orEmpty()
        )
    }.orEmpty()

    store.setChannelList(serverId, listing)
    return listing
}

// ── people ───────────────────────────────────────────────────────────

fun SwitchboardEngine.whois(serverId: String, nick: String) =
    act(serverId, "user:whois", JsonPrimitive(nick)) { it.whois(nick) }

fun SwitchboardEngine.setNick(serverId: String, nick: String) =
    act(serverId, "user:nick", JsonPrimitive(nick)) { it.setNick(nick) }

fun SwitchboardEngine.setRealname(serverId: String, realname: String) =
    act(serverId, "user:setname", JsonPrimitive(realname)) { it.send("SETNAME", realname) }

fun SwitchboardEngine.setAway(serverId: String, message: String?) =
    act(
        serverId, "user:away",
        message?.let { JsonPrimitive(it) } ?: JsonNull
    ) { it.setAway(message) }

/**
 * What became of one profile key.
 *
 * "Saved" and "published" are different things and the difference matters: a
 * network without `draft/metadata-2` cannot show your pronouns to anyone, but
 * that is no reason to throw them away. Saying so is the caller's job.
 */
data class ProfileSaved(val saved: Boolean, val published: Boolean, val reason: String?)

/**
 * Set one of your own profile keys.
 *
 * Not routed through `act`, because unlike everything else here the answer
 * matters — this used to be fire-and-forget, so filling the form in on a
 * network that does not carry profiles looked exactly like success and lost
 * every word of it.
 */
suspend fun SwitchboardEngine.setProfile(
    serverId: String,
    key: String,
    value: String
): ProfileSaved {
    if (isHolding || !remote.isLinked) {
        // Keep it in the shared config first, so it survives and reaches the
        // desktop, then publish if this network can carry it.
        val stored = rememberProfileKey(serverId, key, value)
        val connection = connections[serverId]
            ?: return ProfileSaved(stored, false, "Not connected to this network")

        if (!connection.supportsMetadata) {
            return ProfileSaved(stored, false, NO_METADATA)
        }
        connection.setMetadata(key, value)
        return ProfileSaved(stored, true, null)
    }

    val answer = ask("metadata:set", JsonPrimitive(serverId), JsonPrimitive(key), JsonPrimitive(value))
        as? JsonObject
        ?: return ProfileSaved(false, false, "Could not reach the desktop")

    return ProfileSaved(
        saved = (answer["saved"] as? JsonPrimitive)?.booleanOrNull ?: false,
        published = (answer["published"] as? JsonPrimitive)?.booleanOrNull ?: false,
        reason = answer["reason"].text()
    )
}

private const val NO_METADATA =
    "This network does not support profiles, so nobody here will see it"

/** Put one key into the vault's copy of this server, so it outlives the session */
private fun SwitchboardEngine.rememberProfileKey(
    serverId: String,
    key: String,
    value: String
): Boolean {
    if (!vault.isUnlocked) return false
    val servers = vaultServers()
    if (servers.none { it.id == serverId }) return false

    resealWith(servers.map { server ->
        if (server.id != serverId) return@map server
        val profile = server.profile.toMutableMap()
        if (value.isEmpty()) profile.remove(key) else profile[key] = value
        server.copy(profile = profile)
    })
    return true
}

// ── accounts ─────────────────────────────────────────────────────────

/** draft/account-registration — ask this network for an account */
fun SwitchboardEngine.registerAccount(serverId: String, email: String?, password: String) =
    act(
        serverId, "account:register",
        email?.let { JsonPrimitive(it) } ?: JsonNull, JsonPrimitive(password)
    ) { it.registerAccount(email, password) }

/** And the code it emails back, without which the account stays unusable */
fun SwitchboardEngine.verifyAccount(serverId: String, account: String, code: String) =
    act(
        serverId, "account:verify",
        JsonPrimitive(account), JsonPrimitive(code)
    ) { it.verifyAccount(account, code) }

// ── the friend list (MONITOR) ────────────────────────────────────────

fun SwitchboardEngine.watchNicks(serverId: String, nicks: List<String>) =
    act(serverId, "monitor:add", nicks.asJson()) { it.monitorAdd(nicks) }

fun SwitchboardEngine.unwatchNicks(serverId: String, nicks: List<String>) =
    act(serverId, "monitor:remove", nicks.asJson()) { it.monitorRemove(nicks) }

/**
 * Who we are watching.
 *
 * The desktop keeps this in its database, so following it is a straight read.
 * Holding the connection, MONITOR L is the only source and it answers
 * asynchronously — the store collects the reply and this returns what it has.
 */
suspend fun SwitchboardEngine.watchedNicks(serverId: String): List<String> {
    if (isHolding) {
        connections[serverId]?.monitorList()
        return store.watchedFor(serverId)
    }
    val answer = ask("monitor:list", JsonPrimitive(serverId)) as? JsonArray ?: return emptyList()
    return answer.mapNotNull { it.text() }
}

// ── looking backwards ────────────────────────────────────────────────

/**
 * Older messages for a conversation.
 *
 * Two sources, and they are not alternatives. The desktop's database holds what
 * it has already seen, which is instant and works offline; `chathistory` asks
 * the network for what nobody saw, which is slower and may return nothing.
 * Asking for both is why scrolling up feels immediate and still reaches back
 * past the day this phone was paired.
 */
suspend fun SwitchboardEngine.loadOlder(serverId: String, channel: String): Int {
    // Nothing to page back from yet — the conversation is still arriving. This
    // is not "there is no history", and the caller must not record it as one.
    val oldest = store.messagesFor(serverId, channel).firstOrNull()?.timestamp
        ?: return NOT_YET

    if (isHolding) {
        val connection = connections[serverId] ?: return 0
        connection.requestHistoryBefore(channel, oldest)
        // The answer arrives as a batch, not as a return value
        return NOT_YET
    }

    // Ask the network too, so the desktop's database grows for next time
    ask(
        "chathistory:request",
        JsonPrimitive(serverId), JsonPrimitive(channel),
        JsonPrimitive(oldest), JsonPrimitive(HISTORY_PAGE)
    )

    val answer = ask(
        "history:fetch",
        JsonPrimitive(serverId), JsonPrimitive(channel),
        JsonPrimitive(oldest), JsonPrimitive(HISTORY_PAGE)
    ) as? JsonArray ?: return NOT_YET

    return store.prependHistory(serverId, channel, answer)
}

/** [loadOlder] could not ask yet; ask again rather than concluding anything */
const val NOT_YET = -1

/** One hit from a search, with enough context to jump to it */
data class SearchHit(
    val channel: String,
    val nick: String,
    val content: String,
    val timestamp: String,
    val id: String
)

/**
 * Find something that was said.
 *
 * Following the desktop this is a database query over everything it has ever
 * stored. Holding the connection there is no database — only what this phone
 * has in memory — so the same call answers from that instead of failing. The
 * results are narrower, and the UI says which it got.
 */
suspend fun SwitchboardEngine.searchMessages(
    serverId: String,
    query: String,
    channel: String? = null
): List<SearchHit> {
    val term = query.trim()
    if (term.isEmpty()) return emptyList()

    if (isHolding) {
        // Ask the network, where it can answer: the phone's own memory starts
        // at whenever it took over, which is a thin thing to call a search.
        val connection = connections[serverId]
        if (connection != null && connection.supportsSearch) {
            store.beginSearch()
            connection.search(term, channel)
            withTimeoutOrNull(SEARCH_TIMEOUT_MS) {
                while (!store.searchComplete) delay(150)
            }
            store.endSearch()
            if (store.searchResults.isNotEmpty()) return store.searchResults.toList()
        }
        return store.searchLocally(serverId, term, channel)
    }

    val answer = ask(
        "message:search",
        JsonPrimitive(serverId), JsonPrimitive(term),
        channel?.let { JsonPrimitive(it) } ?: JsonNull
    ) as? JsonArray ?: return emptyList()

    return answer.mapNotNull { entry ->
        val row = entry as? JsonObject ?: return@mapNotNull null
        SearchHit(
            channel = row["channel"].text() ?: return@mapNotNull null,
            nick = row["nick"].text().orEmpty(),
            content = row["content"].text().orEmpty(),
            timestamp = row["timestamp"].text().orEmpty(),
            id = row["id"].text().orEmpty()
        )
    }.asReversed()
}

// ── read markers ─────────────────────────────────────────────────────

/**
 * Where this conversation was left off, from whichever device left it.
 *
 * Read once, on opening: the line marks a place, and a place that moves as you
 * read is not one.
 */
suspend fun SwitchboardEngine.readMarkerFor(serverId: String, channel: String): String? {
    if (isHolding) return null
    return ask("read-marker:get", JsonPrimitive(serverId), JsonPrimitive(channel)).text()
}

/**
 * Say where we have read up to.
 *
 * The point of this on a phone: catching up in bed should not leave the desktop
 * showing the same forty unread messages in the morning.
 */
fun SwitchboardEngine.markReadUpTo(serverId: String, channel: String, timestamp: String) =
    act(
        serverId, "read-marker:set",
        JsonPrimitive(channel), JsonPrimitive(timestamp)
    ) { it.markRead(channel, timestamp) }

// ── the networks themselves ──────────────────────────────────────────

/**
 * Every network in the shared config.
 *
 * The unlocked vault is preferred because it is complete — the desktop's own
 * `server:list` reaches a phone with the credentials stripped out, which is
 * right for reading and wrong for editing. When the vault is locked that
 * stripped list is still worth showing: seeing your networks and being unable to
 * change them beats an empty screen.
 */
suspend fun SwitchboardEngine.listServers(): List<ServerConfig> {
    if (vault.isUnlocked) return vaultServers().sortedBy { it.sortOrder }

    val answer = ask("server:list") as? JsonArray ?: return emptyList()
    return answer.mapNotNull { entry ->
        val row = entry as? JsonObject ?: return@mapNotNull null
        ServerConfig(
            id = row["id"].text() ?: return@mapNotNull null,
            name = row["name"].text().orEmpty(),
            host = row["host"].text().orEmpty(),
            port = (row["port"] as? JsonPrimitive)?.intOrNull ?: 6697,
            tls = (row["tls"] as? JsonPrimitive)?.booleanOrNull ?: true,
            nick = row["nick"].text().orEmpty(),
            username = row["username"].text().orEmpty(),
            realname = row["realname"].text().orEmpty(),
            saslMechanism = row["saslMechanism"].text(),
            saslUsername = row["saslUsername"].text(),
            autoConnect = (row["autoConnect"] as? JsonPrimitive)?.booleanOrNull ?: true,
            autoJoin = (row["autoJoin"] as? JsonArray)?.mapNotNull { it.text() }.orEmpty(),
            sortOrder = (row["sortOrder"] as? JsonPrimitive)?.intOrNull ?: 0,
            websocketUrl = row["websocketUrl"].text(),
            profile = (row["profile"] as? JsonObject)
                ?.mapNotNull { (key, value) -> value.text()?.let { key to it } }
                ?.toMap()
                .orEmpty()
        )
    }.sortedBy { it.sortOrder }
}

/**
 * Your own profile as stored, rather than as the network echoed it back.
 *
 * A server without `draft/metadata-2` never echoes anything, so a form filled
 * only from received metadata comes back empty every time and looks like the
 * save was lost. This is what you actually set.
 */
suspend fun SwitchboardEngine.storedProfile(serverId: String): Map<String, String> =
    listServers().firstOrNull { it.id == serverId }?.profile.orEmpty()

/** Whether the shared config can be changed from here at all */
val SwitchboardEngine.canEditServers: Boolean get() = vault.isUnlocked || remote.isLinked

/**
 * Add a network.
 *
 * Holding the connection this goes straight into the vault, which is the shared
 * config — so a server added on the phone while the desktop was off is there
 * when the desktop comes back. Following, the desktop writes it and reseals,
 * and the new vault arrives here the usual way.
 */
suspend fun SwitchboardEngine.addServer(config: ServerConfig): String? {
    if (isHolding || !remote.isLinked) {
        if (!vault.isUnlocked) return null
        val id = config.id.ifBlank { java.util.UUID.randomUUID().toString() }
        val stored = config.copy(id = id, sortOrder = vault.servers().size)
        resealWith(vault.servers() + stored)
        if (stored.autoConnect) connectServer(stored.id)
        return id
    }
    return ask("server:add", config.toJson())?.text()
}

suspend fun SwitchboardEngine.updateServer(serverId: String, changes: ServerConfig) {
    if (isHolding || !remote.isLinked) {
        if (!vault.isUnlocked) return
        resealWith(vault.servers().map { if (it.id == serverId) changes.copy(id = serverId) else it })
        return
    }
    ask("server:update", JsonPrimitive(serverId), changes.toJson(omitBlankSecrets = true))
}

suspend fun SwitchboardEngine.removeServer(serverId: String) {
    disconnectServer(serverId)
    if (isHolding || !remote.isLinked) {
        if (!vault.isUnlocked) return
        resealWith(vault.servers().filterNot { it.id == serverId })
        store.forgetServer(serverId)
        return
    }
    ask("server:remove", JsonPrimitive(serverId))
    store.forgetServer(serverId)
}

/**
 * Open a network.
 *
 * Not routed through `act`: holding the connection, the whole point is that
 * there is no connection object yet — it has to be built out of the vault.
 */
fun SwitchboardEngine.connectServer(serverId: String) {
    if (isHolding || !remote.isLinked) {
        vaultServers().find { it.id == serverId }?.let { openConnection(it) }
        return
    }
    scope.launch { ask("server:connect", JsonPrimitive(serverId)) }
}

fun SwitchboardEngine.disconnectServer(serverId: String) {
    if (isHolding || !remote.isLinked) {
        closeConnection(serverId)
        return
    }
    scope.launch { ask("server:disconnect", JsonPrimitive(serverId)) }
}

// ── settings the two clients share ───────────────────────────────────

suspend fun SwitchboardEngine.getSetting(key: String): JsonElement? =
    ask("settings:get", JsonPrimitive(key))

suspend fun SwitchboardEngine.setSetting(key: String, value: JsonElement) {
    ask("settings:set", JsonPrimitive(key), value)
}

/** What a link points at, for the card under a message */
data class LinkPreview(
    val title: String?,
    val description: String?,
    val image: String?,
    val siteName: String?
)

suspend fun SwitchboardEngine.previewLink(url: String): LinkPreview? {
    val answer = ask("link-preview:fetch", JsonPrimitive(url)) as? JsonObject ?: return null
    return LinkPreview(
        title = answer["title"].text(),
        description = answer["description"].text(),
        image = answer["image"].text(),
        siteName = answer["siteName"].text()
    )
}

// ── plumbing ─────────────────────────────────────────────────────────

private const val LIST_TIMEOUT_MS = 15_000L
private const val SEARCH_TIMEOUT_MS = 10_000L
private const val HISTORY_PAGE = 50

/** Seal a new server list and offer it to whoever else holds the vault */
private fun SwitchboardEngine.resealWith(servers: List<ServerConfig>) {
    vault.reseal(servers, deviceName = "phone") ?: return
    noteVaultChanged()
}

private fun List<String>.asJson(): JsonArray =
    JsonArray(map { JsonPrimitive(it) })

private fun JsonElement?.text(): String? =
    (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull

/**
 * A server config as the desktop's handlers expect it.
 *
 * [omitBlankSecrets] is what stops an edit from erasing a password: the phone
 * is never shown the real one, so sending back the empty box it displayed would
 * clear it. The desktop guards against this too — belt and braces, because the
 * cost of getting it wrong is a network the user can no longer log in to.
 */
private fun ServerConfig.toJson(omitBlankSecrets: Boolean = false): JsonObject = buildJsonObject {
    put("name", name)
    put("host", host)
    put("port", port)
    put("tls", tls)
    put("nick", nick)
    put("username", username)
    put("realname", realname)
    put("autoConnect", autoConnect)
    put("autoJoin", autoJoin.asJson())
    put("saslMechanism", saslMechanism?.let { JsonPrimitive(it) } ?: JsonNull)
    put("saslUsername", saslUsername?.let { JsonPrimitive(it) } ?: JsonNull)
    put("websocketUrl", websocketUrl?.let { JsonPrimitive(it) } ?: JsonNull)

    val secrets = listOf(
        "password" to password,
        "saslPassword" to saslPassword,
        "identifyCommand" to identifyCommand
    )
    for ((key, value) in secrets) {
        if (omitBlankSecrets && value.isNullOrEmpty()) continue
        put(key, value?.let { JsonPrimitive(it) } ?: JsonNull)
    }
}
