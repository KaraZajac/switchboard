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
import org.switchboard.android.irc.Commands
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

/**
 * Send what was typed, or run it.
 *
 * Following the desktop this goes to `message:send`, which runs `commands.ts`
 * on the far side. Holding the connection there is nobody to run them but us —
 * and until this called [Commands], `/msg NickServ IDENTIFY hunter2` was
 * delivered to the channel as a public message.
 */
fun SwitchboardEngine.say(serverId: String, target: String, text: String) =
    act(serverId, "message:send", JsonPrimitive(target), JsonPrimitive(text)) { connection ->
        val command = Commands.run(connection, target, text)
        when {
            !command.handled -> connection.say(target, command.message ?: text)
            // No subject: the message already names the command, and the
            // banner would otherwise read "Unknown command: /x — /x".
            command.error != null -> store.noteRefusal(command.error)
        }
    }

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
    // Quiet: nobody needs a banner because the server did not hear them start
    // typing, and offline it would fire on every keystroke.
    act(serverId, "message:typing", JsonPrimitive(target), JsonPrimitive(state), quiet = true) {
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

    if (holds(serverId)) {
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
    serverId: String?,
    key: String,
    value: String
): ProfileSaved {
    if (isHolding || !remote.isLinked || serverId == null) {
        // Your profile is yours, not one network's: it is written down first
        // and always, with no server selected and none configured. Publishing
        // is a separate question, and its answer is per network.
        val stored = rememberProfileKey(serverId, key, value)

        val connection = serverId?.let { connections[it] }
            ?: return ProfileSaved(stored, false, if (serverId == null) null else "Not connected to this network")

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
/**
 * Write one profile key down.
 *
 * The config's own copy always, so that saving works with nothing connected
 * and no networks added — a profile is a thing about you, and refusing to
 * remember it until you have somewhere to send it is the wrong way round.
 * The named server, if there is one, gets it too, because that is the copy it
 * publishes on connect.
 */
private fun SwitchboardEngine.rememberProfileKey(
    serverId: String?,
    key: String,
    value: String
): Boolean {
    if (!vault.isUnlocked) return false

    val kept = vault.setDefaultProfileKey(key, value)
    if (kept) noteVaultChanged()

    if (serverId == null) return kept

    val servers = vaultServers()
    if (servers.none { it.id == serverId }) return kept

    resealWith(servers.map { server ->
        if (server.id != serverId) return@map server
        val profile = server.profile.toMutableMap()
        if (value.isEmpty()) profile.remove(key) else profile[key] = value
        server.copy(profile = profile)
    })
    return true
}

/** Your profile as the config holds it, whatever networks exist */
fun SwitchboardEngine.savedProfile(): Map<String, String> = vault.defaultProfile()

// ── accounts ─────────────────────────────────────────────────────────

/**
 * How this network does accounts.
 *
 * IRC has two answers and they need different screens. A modern server
 * advertises `draft/account-registration` and the whole thing can happen in the
 * client. Everywhere else there is a bot called NickServ that you talk to in
 * English, and the client's job is to know the phrases and save the password.
 */
data class AccountAbilities(
    /** The server will create an account for us over the protocol */
    val canRegister: Boolean,
    /** It insists on an email address it can send a code to */
    val emailRequired: Boolean,
    /** Shortest password it will take, when it said */
    val minPasswordLength: Int?,
    /** It will let us register before we are even on the network */
    val beforeConnect: Boolean,
    /** SASL mechanisms it offers, so a saved password can be used at connect */
    val saslMechanisms: List<String>
)

/**
 * Read the capability values, which is where all of this is stated.
 *
 * `draft/account-registration=before-connect,email-required,min-password-length=10`
 * and `sasl=PLAIN,SCRAM-SHA-256`. Nothing here is guessed: a client that offers
 * to register on a network that will not is offering a dead end.
 */
fun SwitchboardEngine.accountAbilities(serverId: String): AccountAbilities =
    // Our own connection knows first-hand; following a desktop, the snapshot
    // carried them across.
    accountAbilitiesOf(
        connections[serverId]?.state?.available
            ?: store.capabilityValues[serverId]
            ?: emptyMap()
    )

/**
 * The same reading the desktop makes of the same string.
 *
 * Split out from the lookup so it can be held to `tests/fixtures/accounts.json`
 * alongside `src/shared/accounts.ts` — both clients put the same form in front
 * of the user, so both have to fill it in from the same values.
 */
fun accountAbilitiesOf(available: Map<String, String>): AccountAbilities {
    val registration = available["draft/account-registration"]

    val values = registration?.split(",")?.map { it.trim() }.orEmpty()
    val minimum = values.firstOrNull { it.startsWith("min-password-length=") }
        ?.substringAfter('=')?.toIntOrNull()

    return AccountAbilities(
        canRegister = registration != null,
        emailRequired = values.contains("email-required"),
        minPasswordLength = minimum,
        beforeConnect = values.contains("before-connect"),
        saslMechanisms = available["sasl"]?.split(",")?.map { it.trim().uppercase() }
            ?.filter { it.isNotEmpty() }
            .orEmpty()
    )
}

/**
 * The mechanism to save a password under.
 *
 * SCRAM by preference, because the password never crosses the wire; PLAIN where
 * that is all there is. Null means the network offers neither, and the password
 * has to go to NickServ as a message instead.
 */
fun bestSaslMechanism(mechanisms: List<String>): String? = when {
    mechanisms.contains("SCRAM-SHA-256") -> "SCRAM-SHA-256"
    mechanisms.contains("PLAIN") -> "PLAIN"
    else -> null
}

/**
 * Whether both devices can be on this network at the same time.
 *
 * IRC lets two connections share one nick when the server says so, and the
 * server's condition is always the same: both must have authenticated to the
 * same account. rIRCd states it plainly — `same_account && multiclient` —
 * because the account is the only thing that makes the second connection *you*
 * rather than an impostor.
 *
 * So this is the precondition, not the permission: do we have credentials to
 * arrive as? Whether the network then allows it is the network's answer, and it
 * gives that answer by letting us keep the nick or not.
 *
 * A saved identify command is not enough. NickServ logs you in *after*
 * registration, by which time the nick has already been refused.
 */
fun canShareConnection(config: ServerConfig): Boolean =
    !config.saslMechanism.isNullOrBlank() && !config.saslPassword.isNullOrBlank()

/**
 * Whether this network already logs us in without being asked.
 *
 * Either SASL credentials or an identify command counts: both mean the next
 * connection arrives as this account on its own, which is the only thing the
 * question is really about.
 */
fun SwitchboardEngine.logsInAutomatically(serverId: String): Boolean {
    val server = vaultServers().find { it.id == serverId } ?: return false
    return !server.saslPassword.isNullOrBlank() || !server.identifyCommand.isNullOrBlank()
}

/**
 * Log in the way networks without account registration expect.
 *
 * This is a plain message to a bot, and that is all it has ever been. What
 * makes it worth a function is what happens around it: the same line is saved
 * as the network's identify command, so the next connection does it without
 * being asked, which is the actual thing people want when they ask for
 * "friendly NickServ support".
 */
suspend fun SwitchboardEngine.identifyWithServices(
    serverId: String,
    account: String,
    password: String,
    remember: Boolean = true
) {
    val command = "PRIVMSG NickServ :IDENTIFY $account $password"
    if (remember) {
        vaultServers().find { it.id == serverId }?.let { server ->
            updateServer(serverId, server.copy(identifyCommand = command))
        }
    }
    act(serverId, "message:send", JsonPrimitive("NickServ"), JsonPrimitive("IDENTIFY $account $password")) {
        it.say("NickServ", "IDENTIFY $account $password")
    }
}

/**
 * Remember an account so the next connection logs in by itself.
 *
 * SASL rather than an identify command wherever the network offers it: it
 * happens before registration completes, so nothing is ever said or joined
 * under the wrong identity, and there is no window where the nick is
 * unprotected.
 */
suspend fun SwitchboardEngine.rememberAccount(
    serverId: String,
    account: String,
    password: String
) {
    val server = vaultServers().find { it.id == serverId } ?: return
    val mechanism = bestSaslMechanism(accountAbilities(serverId).saslMechanisms)

    if (mechanism == null) {
        identifyWithServices(serverId, account, password)
        return
    }

    updateServer(
        serverId,
        server.copy(
            saslMechanism = mechanism,
            saslUsername = account,
            saslPassword = password
        )
    )
}

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

/**
 * Watch for somebody turning up.
 *
 * Recorded in three places, and all three are needed. The server is told, so it
 * notifies us. The store is told, so the friends list shows them straight away
 * rather than waiting for a `MONITOR L` round trip. And the vault is told,
 * because MONITOR lives on the connection and dies with it — a watch that is
 * not written down stops working the first time the phone changes network, and
 * says nothing about having stopped.
 */
fun SwitchboardEngine.watchNicks(serverId: String, nicks: List<String>) {
    act(serverId, "monitor:add", nicks.asJson()) { it.monitorAdd(nicks) }

    val watched = store.watchedFor(serverId).toMutableList()
    for (nick in nicks) if (watched.none { it.equals(nick, true) }) watched.add(nick)
    store.setWatched(serverId, watched)
    rememberWatched(serverId, watched)
}

fun SwitchboardEngine.unwatchNicks(serverId: String, nicks: List<String>) {
    act(serverId, "monitor:remove", nicks.asJson()) { it.monitorRemove(nicks) }

    val watched = store.watchedFor(serverId)
        .filterNot { held -> nicks.any { it.equals(held, true) } }
    store.setWatched(serverId, watched)
    rememberWatched(serverId, watched)
}

/** Keep the friend list in the shared config, where a reconnect can find it */
private fun SwitchboardEngine.rememberWatched(serverId: String, nicks: List<String>) {
    val current = vault.payloadNow() ?: return
    val monitor = current.monitor.toMutableMap()
    if (nicks.isEmpty()) monitor.remove(serverId) else monitor[serverId] = nicks

    if (vault.resealPayload(current.copy(monitor = monitor)) != null) noteVaultChanged()
}

/**
 * Who we are watching.
 *
 * The desktop keeps this in its database, so following it is a straight read.
 * Holding the connection, MONITOR L is the only source and it answers
 * asynchronously — the store collects the reply and this returns what it has.
 */
suspend fun SwitchboardEngine.watchedNicks(serverId: String): List<String> {
    if (holds(serverId)) {
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

    if (holds(serverId)) {
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

    if (holds(serverId)) {
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
    // Our own connection has no stored markers to read; the desktop does.
    if (holds(serverId)) return null
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
/**
 * Whether the networks can be edited here.
 *
 * Always, now. This used to be `vault.isUnlocked || remote.isLinked`, from
 * when the phone had no config of its own and a desktop was the only way to
 * get one — so a phone by itself could not add a server, and the screen said
 * so and offered nothing. The config is made on first launch and opens itself
 * from the keystore, so there is nothing to wait for.
 */
val SwitchboardEngine.canEditServers: Boolean get() = true

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
        // A profile set before this network existed still belongs to you on it
        val stored = config.copy(
            id = id,
            sortOrder = vault.servers().size,
            profile = if (config.profile.isEmpty()) vault.defaultProfile() else config.profile
        )
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
    val config = vaultServers().find { it.id == serverId }

    // Our own socket wherever we can have one: with no desktop there is no
    // choice, and with a desktop that shares the network there is no reason to
    // ask it for something we can do ourselves.
    if (config != null && (!remote.isLinked || canShareConnection(config))) {
        openConnection(config)
        return
    }
    scope.launch { ask("server:connect", JsonPrimitive(serverId)) }
}

fun SwitchboardEngine.disconnectServer(serverId: String) {
    // Ours if it is ours. Asking the desktop to drop its connection because
    // this phone wants to leave a network would take both of us off it.
    if (holds(serverId) || !remote.isLinked) {
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
/**
 * Remember, in the shared config, that we are in this channel.
 *
 * "Join on connect" should not be a list someone maintains by hand. Joining a
 * channel is the act of saying you want to be in it, and IRC gives no other
 * signal — so the join *is* the setting, and leaving is how you unset it.
 *
 * It goes in the vault rather than in a local list because both clients read
 * their channels from there: join `#help` on the phone in the morning and the
 * desktop is in it that evening, which is the whole reason the config is
 * shared. The write is skipped when nothing changed, so a reconnect that
 * rejoins twelve channels does not seal twelve new versions of the config.
 */
internal fun SwitchboardEngine.rememberJoin(serverId: String, channel: String) {
    if (!vault.isUnlocked) return
    val servers = vault.servers()
    val server = servers.find { it.id == serverId } ?: return
    if (server.autoJoin.any { it.equals(channel, ignoreCase = true) }) return

    resealWith(servers.map {
        if (it.id == serverId) it.copy(autoJoin = it.autoJoin + channel) else it
    })
}

/** And that we are not, so the next connection does not walk back in */
internal fun SwitchboardEngine.forgetJoin(serverId: String, channel: String) {
    if (!vault.isUnlocked) return
    val servers = vault.servers()
    val server = servers.find { it.id == serverId } ?: return
    if (server.autoJoin.none { it.equals(channel, ignoreCase = true) }) return

    resealWith(servers.map {
        if (it.id == serverId) {
            it.copy(autoJoin = it.autoJoin.filterNot { name -> name.equals(channel, true) })
        } else it
    })
}

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
