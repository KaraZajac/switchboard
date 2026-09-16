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
import org.switchboard.android.irc.Aliases
import org.switchboard.android.irc.Ignore
import org.switchboard.android.irc.Commands
import org.switchboard.android.irc.ServerConfig
import java.time.Instant
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import org.switchboard.android.irc.Filehost
import org.switchboard.android.irc.MaskLists
import org.switchboard.android.irc.Profile
import org.switchboard.android.irc.dialChanged
import org.switchboard.android.irc.TrustedCertificate

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
        // Aliases first, because one may turn a line into several — and each
        // still goes through the ordinary command path, or `/j` would reach
        // the channel as text.
        val expanded = Aliases.expand(text, savedAliases())
        if (expanded.error != null) {
            store.noteRefusal(expanded.error)
            return@act
        }

        for (line in expanded.lines) {
            val command = Commands.run(connection, target, line)
            when {
                !command.handled -> connection.say(target, command.message ?: line)
                // No subject: the message already names the command, and the
                // banner would otherwise read "Unknown command: /x — /x".
                command.error != null -> store.noteRefusal(command.error)
            }
            // The part that is not a line on the wire
            command.effect?.let { applyCommandEffect(serverId, target, it) }
        }
    }

/**
 * The part of a command that is not a line on the wire.
 *
 * Clearing a view and keeping an ignore list both live on this side, and
 * `Commands` has no business reaching into either — it says what it wants and
 * this does it. The ignore arms go through the same list a profile writes, so
 * `/ignore` and a tap in a profile are the same act.
 */
private fun SwitchboardEngine.applyCommandEffect(
    serverId: String,
    target: String,
    effect: Commands.Effect
) {
    when (effect) {
        is Commands.Effect.Clear -> store.clearConversation(serverId, target)

        // Everywhere, because a command typed in a channel says nothing about
        // which network it was meant for and the list is shared across both.
        is Commands.Effect.Ignore ->
            Ignore.toMask(effect.mask).takeIf { it.isNotEmpty() }
                ?.let { addIgnore(it, Ignore.EVERYWHERE) }

        is Commands.Effect.Unignore ->
            Ignore.toMask(effect.mask).takeIf { it.isNotEmpty() }
                ?.let { removeIgnore(it, Ignore.EVERYWHERE) }
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
    ) {
        // A network that will not carry reactions says so, and somebody has to
        // hear it. Silently doing nothing is what this replaces.
        if (!it.react(target, messageId, emoji, remove)) {
            store.noteRefusal("This network does not carry reactions.")
        }
    }

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

/**
 * Give or take a channel mode against one person.
 *
 * One call for op, halfop, voice, ban and quiet alike: they are the same line
 * on the wire, and which of them may be asked for is decided in [Powers]
 * rather than here. Relayed through the desktop when this phone is following
 * one, like every other action.
 */
fun SwitchboardEngine.setMemberMode(
    serverId: String,
    channel: String,
    change: String,
    target: String
) = act(
    serverId, "user:mode",
    JsonPrimitive(channel), JsonPrimitive(change), JsonPrimitive(target)
) { it.send("MODE", channel, change, target) }

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

// ── what a channel keeps, and what it is set to ──────────────────────

/**
 * Ask the server for one of a channel's mask lists.
 *
 * The answer arrives as `irc:masklist` and fills the store. Asking again while
 * one is still coming would interleave two copies of the same list, which the
 * protocol layer guards against.
 */
fun SwitchboardEngine.fetchMaskList(serverId: String, channel: String, mode: String) =
    act(serverId, "masklist:fetch", JsonPrimitive(channel), JsonPrimitive(mode), quiet = true) {
        // Marked as loading before asking, so the first line of the answer
        // replaces what we had rather than adding to it. Without this, an
        // entry somebody else lifted stays on the list until the app restarts.
        it.state.findChannel(channel)?.loadingLists?.add(mode)
        it.setMode(channel, "+$mode")
    }

/** Put something on one of those lists, or take it off */
fun SwitchboardEngine.setMaskListEntry(
    serverId: String,
    channel: String,
    mode: String,
    mask: String,
    adding: Boolean
) = act(
    serverId, "masklist:set",
    JsonPrimitive(channel), JsonPrimitive(mode), JsonPrimitive(mask), JsonPrimitive(adding)
) {
    it.setMode(channel, (if (adding) "+" else "-") + mode, MaskLists.maskToSet(mask))
}

/**
 * Ask what a channel is set to.
 *
 * A channel joined before this client started has modes nobody has seen, and
 * RPL_CHANNELMODEIS is the only answer to the question.
 */
fun SwitchboardEngine.fetchChannelModes(serverId: String, channel: String) =
    // Quiet, like every question the app asks on its own: opening the channel
    // sheet while the network is being redialled used to announce "that was
    // not sent" about a MODE query nobody typed.
    act(serverId, "channel:modes", JsonPrimitive(channel), quiet = true) { it.send("MODE", channel) }

/** Turn one of those settings on or off */
fun SwitchboardEngine.setChannelMode(serverId: String, channel: String, args: List<String>) =
    act(
        serverId, "channel:set-mode",
        JsonPrimitive(channel), JsonArray(args.map { JsonPrimitive(it) })
    ) {
        if (args.isNotEmpty()) it.setMode(channel, args[0], *args.drop(1).toTypedArray())
    }

/**
 * Which profile is being edited.
 *
 * IRC has no global anything — every network is told separately — so
 * "everywhere" is this client's own idea, kept in the vault where both devices
 * can see it and published to each network on connect. The same two words the
 * desktop's `metadata:set` takes, so the scope travels over the link unchanged.
 */
const val GLOBAL_SCOPE = "global"

private const val NO_METADATA =
    "This network does not support profiles, so nobody here will see it"

/**
 * Set one of your own profile keys.
 *
 * Not routed through `act`, because unlike everything else here the answer
 * matters — this used to be fire-and-forget, so filling the form in on a
 * network that does not carry profiles looked exactly like success and lost
 * every word of it.
 *
 * @param scope [GLOBAL_SCOPE] for the profile you carry everywhere, or a
 *   serverId for one network only. These used to be the same write: editing a
 *   profile anywhere set the network's copy *and* the default, so you could
 *   not be called something different in one place without changing what you
 *   were called in all of them.
 */
suspend fun SwitchboardEngine.setProfile(
    scope: String,
    key: String,
    value: String
): ProfileSaved {
    if (isHolding || !remote.isLinked) {
        return if (scope == GLOBAL_SCOPE) setGlobalProfileKey(key, value)
        else setServerProfileKey(scope, key, value)
    }

    val answer = ask("metadata:set", JsonPrimitive(scope), JsonPrimitive(key), JsonPrimitive(value))
        as? JsonObject
        ?: return ProfileSaved(false, false, "Could not reach the desktop")

    return ProfileSaved(
        saved = (answer["saved"] as? JsonPrimitive)?.booleanOrNull ?: false,
        published = (answer["published"] as? JsonPrimitive)?.booleanOrNull ?: false,
        reason = answer["reason"].text()
    )
}

/**
 * Change the profile you carry everywhere.
 *
 * Every network that has not been given one of its own is describing you, so
 * they all say the new thing now rather than at their next reconnect.
 */
private fun SwitchboardEngine.setGlobalProfileKey(key: String, value: String): ProfileSaved {
    if (!vault.isUnlocked) return ProfileSaved(false, false, "Locked")

    val stored = vault.setDefaultProfileKey(key, value)
    if (stored) noteVaultChanged()

    // Per field, not per network: an override is field by field, so a network
    // you gave a different display name still follows your pronouns — and
    // skipping the whole network meant it followed them only until the next
    // time anybody reconnected.
    var published = false
    for (server in vaultServers()) {
        if (server.profile.containsKey(key)) continue
        val connection = connections[server.id] ?: continue
        connection.refreshProfile()
        if (connection.supportsMetadata) published = true
    }

    // Saved either way — a profile is a thing about you, not about a network —
    // but say so when there is nowhere it can be seen.
    return ProfileSaved(
        stored,
        published,
        if (published) null else "Saved. No connected network here can show it to anyone"
    )
}

/**
 * Change what one network is told, and only that one.
 *
 * Stored as a difference from your profile rather than a copy of it, so a
 * network only stops following you where somebody meant it to — and a blank
 * where your profile has something is a deliberate blank, which is the only
 * way to have something everywhere except in one place.
 */
private fun SwitchboardEngine.setServerProfileKey(
    serverId: String,
    key: String,
    value: String
): ProfileSaved {
    if (!vault.isUnlocked) return ProfileSaved(false, false, "Locked")

    val servers = vaultServers()
    val server = servers.firstOrNull { it.id == serverId }
        ?: return ProfileSaved(false, false, "Not one of your networks")

    val typed = Profile.resolve(vault.defaultProfile(), server.profile).toMutableMap()
    typed[key] = value
    val profile = Profile.overrideFrom(vault.defaultProfile(), typed).orEmpty()

    resealWith(servers.map { if (it.id == serverId) it.copy(profile = profile) else it })

    val connection = connections[serverId]
        ?: return ProfileSaved(true, false, "Not connected to this network")
    connection.applyProfile(profile)
    connection.refreshProfile()

    if (!connection.supportsMetadata) return ProfileSaved(true, false, NO_METADATA)
    return ProfileSaved(true, true, null)
}

/**
 * Give one network back the profile you carry.
 *
 * The counterpart to editing a field of a network's own profile: there has to
 * be a way out of having one, and typing your global values back in field by
 * field until the difference disappears is not it.
 */
suspend fun SwitchboardEngine.resetProfile(serverId: String) {
    if (isHolding || !remote.isLinked) {
        if (!vault.isUnlocked) return
        val servers = vaultServers()
        if (servers.none { it.id == serverId }) return
        resealWith(servers.map { if (it.id == serverId) it.copy(profile = emptyMap()) else it })

        val connection = connections[serverId] ?: return
        connection.applyProfile(emptyMap())
        // Republishing is what clears the fields this network had of its own:
        // a valueless SET goes up for anything we are no longer saying.
        connection.refreshProfile()
        return
    }
    ask("metadata:reset", JsonPrimitive(serverId))
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
 *
 * SASL is the one exception, and it has to be. Listing the mechanisms arrived
 * with SASL 3.2; before that the capability was bare, and Ergo still advertises
 * it that way. Reading a bare `sasl` as "no mechanisms" meant no password could
 * be saved for those networks — and, because sharing a connection between two
 * devices requires SASL, it quietly turned off the one feature this client is
 * for. PLAIN is mandatory to implement, so a bare `sasl` means at least PLAIN.
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
        saslMechanisms = available["sasl"]?.let { value ->
            val named = value.split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
            named.ifEmpty { listOf("PLAIN") }
        }.orEmpty()
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
    // Strongest first. Libera offers SHA-512 and not SHA-256, so a client that
    // only knew the one fell back to PLAIN there — which works, and sends the
    // password to a server that never needed to see it.
    mechanisms.contains("SCRAM-SHA-512") -> "SCRAM-SHA-512"
    mechanisms.contains("SCRAM-SHA-256") -> "SCRAM-SHA-256"
    mechanisms.contains("PLAIN") -> "PLAIN"
    else -> null
}

/**
 * Which half of the account screen to show.
 *
 * Four states, and their order matters more than any of them individually: a
 * network that has not been reached cannot be asked what it can do, and
 * somebody already logged in should not be offered a form to register the nick
 * they are logged in as.
 *
 * Both clients render the same four. Kept alongside `accountView` in
 * `src/shared/accounts.ts`, and held to the same cases.
 */
enum class AccountView {
    /** Not on the network yet, so nothing is known about what it can do */
    OFFLINE,
    /** Logged in, and the credentials are saved for next time */
    SETTLED,
    /** Logged in for now, with nothing saved to do it again */
    REMEMBER,
    /** The network will make an account for us */
    REGISTER,
    /** It will not, so this is a conversation with NickServ */
    NICKSERV
}

fun accountView(
    connected: Boolean,
    account: String?,
    remembered: Boolean,
    canRegister: Boolean
): AccountView = when {
    !connected -> AccountView.OFFLINE
    account != null -> if (remembered) AccountView.SETTLED else AccountView.REMEMBER
    canRegister -> AccountView.REGISTER
    else -> AccountView.NICKSERV
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
 * Register with NickServ, the way most of IRC still does it.
 *
 * The phrase is the same on Atheme and Anope — `REGISTER <password> <email>`
 * — and the client knows it, so there is no reason to send people off to type
 * it by hand. It registers the nick in use now, which is how NickServ works;
 * the password is saved so the next connection logs in with it. Networks that
 * want the email confirmed say so in their reply.
 */
suspend fun SwitchboardEngine.registerWithServices(
    serverId: String,
    password: String,
    email: String?
) {
    val nick = store.servers[serverId]?.nick.orEmpty()
    if (nick.isNotEmpty()) rememberAccount(serverId, nick, password)
    val line = "REGISTER $password" + (email?.takeIf { it.isNotBlank() }?.let { " $it" } ?: "")
    act(serverId, "message:send", JsonPrimitive("NickServ"), JsonPrimitive(line)) {
        it.say("NickServ", line)
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
    // Quiet: the list is written down below and sent again on the next
    // connection, so nothing is lost by not being able to send it now.
    act(serverId, "monitor:add", nicks.asJson(), quiet = true) { it.monitorAdd(nicks) }

    val watched = store.watchedFor(serverId).toMutableList()
    for (nick in nicks) if (watched.none { it.equals(nick, true) }) watched.add(nick)
    store.setWatched(serverId, watched)
    rememberWatched(serverId, watched)
}

fun SwitchboardEngine.unwatchNicks(serverId: String, nicks: List<String>) {
    act(serverId, "monitor:remove", nicks.asJson(), quiet = true) { it.monitorRemove(nicks) }

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

/** One line that named you, with the network on it because it crosses them */
data class Mention(
    val serverId: String,
    val network: String,
    val channel: String,
    val nick: String,
    val content: String,
    val type: String,
    val timestamp: String
)

/**
 * Everything that named you, everywhere, newest first.
 *
 * The badge on a channel counts these as they arrive and then forgets which
 * lines they were, which leaves the question it raises — what did they say? —
 * with no answer but going network by network looking for your own nick.
 *
 * Following a desktop or a headless Switchboard, that device is asked: it has
 * the whole history, where a phone keeps a rolling window of each conversation
 * and would answer thinly for the same question. Holding the connections there
 * is nobody to ask, so the window is the answer — the same split the search
 * screen makes, for the same reason.
 *
 * Channels only. A direct message is addressed to you by existing and has a
 * list of its own; every one of them here would bury the line in a busy channel
 * that nobody was watching, which is what this is for.
 */
suspend fun SwitchboardEngine.recentMentions(limit: Int = 100): List<Mention> {
    if (remote.isLinked && !isHolding) {
        val answer = ask("mentions:recent", JsonPrimitive(limit)) as? JsonArray
        if (answer != null) {
            return answer.mapNotNull { entry ->
                val row = entry as? JsonObject ?: return@mapNotNull null
                Mention(
                    serverId = row["serverId"].text() ?: return@mapNotNull null,
                    network = row["serverName"].text().orEmpty(),
                    channel = row["channel"].text() ?: return@mapNotNull null,
                    nick = row["nick"].text().orEmpty(),
                    content = row["content"].text().orEmpty(),
                    type = row["type"].text().orEmpty(),
                    timestamp = row["timestamp"].text().orEmpty()
                )
            }
        }
    }

    val words = store.highlightWords
    val found = store.servers.values.flatMap { server ->
        // The nick as it is now, not the one you had when the line arrived —
        // the same approximation the badge makes, and the only one available
        // without having stored the answer
        val nick = server.nick
        if (nick.isBlank()) return@flatMap emptyList()

        history.containing(server.id, listOf(nick) + words, limit * 4)
            .filter { isChannel(it.channel) }
            .filter { mentionsYou(it.content, nick, words) }
            // Your own line naming your own nick is not somebody talking to you
            .filter { !it.nick.equals(nick, ignoreCase = true) }
            .map {
                Mention(
                    serverId = it.serverId,
                    network = server.name,
                    channel = it.channel,
                    nick = it.nick,
                    content = it.content,
                    type = it.type,
                    timestamp = it.timestamp
                )
            }
    }

    return found.sortedByDescending { it.timestamp }.take(limit)
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
    // Following: the desktop keeps the copy both devices share, so its answer
    // wins. Kept here as well, because it is the answer this phone will need
    // the next time it is the one holding the connection.
    if (!holds(serverId)) {
        val theirs = ask("read-marker:get", JsonPrimitive(serverId), JsonPrimitive(channel)).text()
        if (!theirs.isNullOrBlank()) {
            runCatching { history.rememberReadMarker(serverId, channel, theirs) }
            return theirs
        }
    }

    // Holding, or linked to a desktop that has never seen this conversation.
    return runCatching { history.readMarker(serverId, channel) }.getOrNull()
}

/**
 * Say where we have read up to.
 *
 * The point of this on a phone: catching up in bed should not leave the desktop
 * showing the same forty unread messages in the morning.
 */
fun SwitchboardEngine.markReadUpTo(serverId: String, channel: String, timestamp: String) {
    // Ours first. With no desktop and a server that does not carry
    // `draft/read-marker`, this is the only place it is written down at all.
    runCatching { history.rememberReadMarker(serverId, channel, timestamp) }

    act(
        serverId, "read-marker:set",
        JsonPrimitive(channel), JsonPrimitive(timestamp),
        // Opening a channel is not sending anything, whatever the state of
        // the socket; the marker goes across when there is one.
        quiet = true
    ) { it.markRead(channel, timestamp) }
}

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
            trustedCertificate = row["trustedCertificate"].text(),
            altNicks = (row["altNicks"] as? JsonArray)?.mapNotNull { it.text() }.orEmpty(),
            altAddresses = (row["altAddresses"] as? JsonArray)?.mapNotNull { it.text() }.orEmpty(),
            bouncerNetId = row["bouncerNetId"].text()?.takeIf { it.isNotEmpty() },
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
        // No copy of the global taken: a new network follows the profile you
        // carry, and only stops following it where somebody says so. Seeding
        // it here is what used to freeze every network against a global they
        // could no longer change.
        val stored = config.copy(id = id, sortOrder = vault.servers().size)
        resealWith(vault.servers() + stored)
        if (stored.autoConnect) connectServer(stored.id)
        return id
    }
    return ask("server:add", config.toJson())?.text()
}

/**
 * Take the networks a bouncer holds and make them networks here.
 *
 * One row per bouncer network, each bound by id, all sharing the bouncer's
 * address and credentials — the shape the rest of the app already understands,
 * so a soju with three networks behaves like three networks rather than one
 * thing with a mode. The same as the desktop's `bouncer:adopt`, which is the
 * point: whichever device you happen to be holding when the offer arrives, the
 * result is the same config.
 *
 * The row that found them is left alone. It is the connection to the bouncer
 * itself, which is what hears about changes, and somebody may well want it.
 *
 * Which ones are missing is worked out again here rather than trusted from the
 * offer: the desktop may have taken the same offer in between.
 */
suspend fun SwitchboardEngine.adoptBouncerNetworks(offer: BouncerOffer): Int {
    val servers = listServers()
    val parent = servers.firstOrNull { it.id == offer.serverId } ?: return 0
    val known = servers
        .filter { it.host == parent.host && it.port == parent.port }
        .mapNotNull { it.bouncerNetId }
        .toSet()

    var added = 0
    for (network in offer.networks) {
        if (network.id.isBlank() || network.id in known) continue
        val id = addServer(
            parent.copy(
                id = "",
                // Its own name, and its own nick where the bouncer told us one
                name = network.name.ifBlank { network.host.ifBlank { "network ${network.id}" } },
                nick = network.nickname.ifBlank { parent.nick },
                autoJoin = emptyList(),
                autoConnect = true,
                bouncerNetId = network.id
            )
        )
        if (id != null) added++
    }
    return added
}

suspend fun SwitchboardEngine.updateServer(serverId: String, changes: ServerConfig) {
    if (isHolding || !remote.isLinked) {
        if (!vault.isUnlocked) return

        // Where the connection goes is part of what was edited: changing the
        // address and pressing save used to leave the socket on the old server,
        // with the list showing the new address and a green dot beside it.
        // Nothing else reconnects — dropping somebody out of a conversation to
        // apply a renamed network would be worse than the bug.
        val before = connections[serverId]?.config
        val redial = before != null && dialChanged(before, changes)

        resealWith(vault.servers().map { if (it.id == serverId) changes.copy(id = serverId) else it })

        if (redial) {
            disconnectServer(serverId)
            connectServer(serverId)
        }
        return
    }
    ask("server:update", JsonPrimitive(serverId), changes.toJson(omitBlankSecrets = true))
}

/**
 * Say yes to this one certificate — see [TrustedCertificate].
 *
 * Written on the server's config, where the desktop reads it too, and the
 * connection is made again: a trusted certificate is a reason to dial, which
 * `dialChanged` knows, so the redial comes with the update on whichever device
 * holds the connection.
 */
suspend fun SwitchboardEngine.trustCertificate(serverId: String, fingerprint: String) {
    val current = listServers().firstOrNull { it.id == serverId } ?: return
    updateServer(serverId, current.copy(trustedCertificate = TrustedCertificate.format(fingerprint)))
    // Cleared last: the banner's scope is what runs this, and clearing the
    // prompt takes the banner — and the scope — away
    store.certificatePrompt = null
}

suspend fun SwitchboardEngine.removeServer(serverId: String) {
    disconnectServer(serverId)
    if (isHolding || !remote.isLinked) {
        if (!vault.isUnlocked) return
        resealWith(vault.servers().filterNot { it.id == serverId })
        store.forgetServer(serverId)
    // And what was said on it: a network that is gone is not one to keep
    // conversations for — see [org.switchboard.android.store.MessageStore]
    runCatching { history.forgetServer(serverId) }
        return
    }
    ask("server:remove", JsonPrimitive(serverId))
    store.forgetServer(serverId)
    // And what was said on it: a network that is gone is not one to keep
    // conversations for — see [org.switchboard.android.store.MessageStore]
    runCatching { history.forgetServer(serverId) }
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
    put("trustedCertificate", trustedCertificate?.let { JsonPrimitive(it) } ?: JsonNull)
    put("altNicks", altNicks.asJson())
    put("altAddresses", altAddresses.asJson())
    bouncerNetId?.let { put("bouncerNetId", it) }

    val secrets = listOf(
        "password" to password,
        "saslPassword" to saslPassword,
        "identifyCommand" to identifyCommand,
        // A certificate's private key is a credential like any other
        "clientCert" to clientCert
    )
    for ((key, value) in secrets) {
        if (omitBlankSecrets && value.isNullOrEmpty()) continue
        put(key, value?.let { JsonPrimitive(it) } ?: JsonNull)
    }
}

// ── sending a file ────────────────────────────────────────────────────

/**
 * Whether this network takes uploads.
 *
 * `draft/filehost` is an ISUPPORT token, so the answer is per network and only
 * known once connected. A button that cannot work is worse than no button.
 */
fun SwitchboardEngine.canAttach(serverId: String): Boolean {
    val connection = connections[serverId] ?: return false
    return Filehost.url(connection.state.isupport, connection.config.tls) != null
}

/**
 * Send a file to the network's filehost and return the link.
 *
 * Null when it could not be done, having already said why — the refusal is
 * worth more than the absence, since "nothing happened" is what an upload that
 * silently failed looks like too.
 *
 * Only ever this phone's own connection: an upload authenticates as the
 * account and streams the bytes, and neither is something to ask the desktop
 * to do on our behalf over the link.
 */
suspend fun SwitchboardEngine.attach(serverId: String, uri: Uri, context: Context): String? =
    withContext(Dispatchers.IO) {
        val connection = connections[serverId]
        if (connection == null) {
            store.noteRefusal("Not connected — that was not sent")
            return@withContext null
        }

        val endpoint = Filehost.url(connection.state.isupport, connection.config.tls)
        if (endpoint == null) {
            store.noteRefusal("This network does not take file uploads.")
            return@withContext null
        }

        // Android refuses cleartext HTTP, and it is right to: the upload
        // carries the file and, on a filehost that wants one, the account
        // password. Said plainly here rather than letting the platform's own
        // exception through, because the fix belongs to the network and not to
        // whoever is holding the phone.
        if (!Filehost.mayAuthenticate(endpoint)) {
            store.noteRefusal(
                "This network's filehost is not encrypted, so nothing can be sent to it."
            )
            return@withContext null
        }

        val resolver = context.contentResolver
        val contentType = resolver.getType(uri) ?: "application/octet-stream"
        val name = displayName(resolver, uri) ?: "file"
        val size = sizeOf(resolver, uri)

        /*
         * Ask what it takes before sending it.
         *
         * A phone is where this matters most: the thing being shared is a
         * photo or a video, the connection is somebody's data allowance, and
         * finding out at the end of the upload that the network only takes
         * images costs them both. One round trip buys the sentence instead.
         */
        val accepted = Filehost.acceptedTypes(endpoint)
        if (!Filehost.acceptsType(accepted, contentType)) {
            val kinds = Filehost.describeAccepted(accepted)
            store.noteRefusal(
                if (kinds != null) "This network takes $kinds, and that file is $contentType."
                else "This network will not take a $contentType file."
            )
            return@withContext null
        }

        try {
            val stream = resolver.openInputStream(uri)
            if (stream == null) {
                store.noteRefusal("That file could not be read.")
                return@withContext null
            }

            stream.use {
                Filehost.upload(
                    endpoint = endpoint,
                    bytes = it,
                    length = size,
                    fileName = name,
                    contentType = contentType,
                    account = connection.config.saslUsername ?: connection.config.nick,
                    password = connection.config.saslPassword
                )
            }
        } catch (cancelled: CancellationException) {
            // Leaving the screen or dismissing the banner cancels the upload.
            // Nothing to tell anyone; see the connection's own note.
            throw cancelled
        } catch (e: Exception) {
            // In words. Every other refusal in here is a sentence somebody
            // wrote, and a raw exception message is written for whoever is
            // reading a stack trace.
            android.util.Log.w("Switchboard", "upload to $endpoint failed", e)
            store.noteRefusal("That file could not be sent.")
            null
        }
    }

/** What the file is called, as the picker knows it */
private fun displayName(resolver: ContentResolver, uri: Uri): String? =
    runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { row ->
            if (row.moveToFirst()) row.getString(0) else null
        }
    }.getOrNull()

/**
 * How large it is, or 0 when the provider will not say.
 *
 * 0 means "stream it without a Content-Length", which is what chunked encoding
 * is for — some providers genuinely do not know until they have read it.
 */
private fun sizeOf(resolver: ContentResolver, uri: Uri): Long =
    runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { row ->
            if (row.moveToFirst() && !row.isNull(0)) row.getLong(0) else 0L
        } ?: 0L
    }.getOrDefault(0L)
