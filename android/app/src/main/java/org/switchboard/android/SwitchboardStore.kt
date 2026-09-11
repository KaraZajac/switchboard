package org.switchboard.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.switchboard.android.irc.Formatting
import org.switchboard.android.irc.Services

/**
 * The phone's copy of what the desktop knows.
 *
 * Deliberately the same shape as the desktop's zustand stores — servers,
 * channels, messages, members, metadata — fed by the same events. Anything that
 * changes here changed on the desktop first; this holds no IRC state of its own.
 */

data class Server(
    val id: String,
    val name: String,
    val host: String,
    var nick: String = "",
    var connected: Boolean = false,
    /**
     * The account we are logged in to on this network, if any.
     *
     * Not the same as the nick, and the difference is the whole of how IRC
     * identity works: the nick is what you are called right now, the account is
     * what the network agrees you own. A client that never shows this cannot
     * answer "am I actually logged in?", which is the question behind most of
     * what people ask NickServ.
     */
    var account: String? = null,
    /**
     * Whether we have marked ourselves away here.
     *
     * A phone is the device most likely to be away from its person, and the
     * only way to say so was to type `/away` — a command the app had no way of
     * running until recently.
     */
    var away: Boolean = false
)

/**
 * A conversation in the list: a channel, a person, or the server's console.
 *
 * Every field is a `val`. Editing one where it sits is invisible to Compose —
 * the list holding it has not changed as far as the snapshot system is
 * concerned — and writing the same list back afterwards does not help, because
 * a map write whose value is equal to what is there is a no-op. Changes go
 * through `copy()` into a new list, which is what makes them show up.
 */
data class Channel(
    val name: String,
    val topic: String? = null,
    val unread: Int = 0,
    val mentions: Int = 0
)

data class Message(
    val id: String,
    val nick: String,
    val content: String,
    val timestamp: String,
    val type: String = "privmsg",
    /** The message this one answers, for the quoted line above it */
    val replyTo: String? = null,
    /** Emoji to the people who added them, so a second tap can remove one */
    val reactions: Map<String, Set<String>> = emptyMap(),
    /** Taken back with draft/message-redaction; kept as a tombstone, not deleted */
    val redactedBy: String? = null,
    /** When it was last changed, which is also why the "(edited)" mark shows */
    val editedAt: String? = null,
    /**
     * The operator name on a `draft/oper` tag, when the server said the sender
     * is one. Worth showing: someone claiming to be staff in a DM is a common
     * enough trick that being able to tell is the point of the capability.
     */
    val oper: String? = null,
    /**
     * The bot that carried this, on a `draft/relaymsg` tag, when the message
     * came through a bridge. The nick is the person who wrote it — that is what
     * the relay is for — and this says how it got here.
     */
    val relayedBy: String? = null
)

data class Member(
    val nick: String,
    val prefixes: List<String> = emptyList(),
    val away: Boolean = false,
    val isBot: Boolean = false
)

/** Something the server declined to do, in words worth showing */
data class ServerRefusal(val text: String, val subject: String?, val at: Long)

/** A network wanting us to log in, in its own words where it gave any */
data class IdentifyPrompt(val serverId: String, val text: String)

/**
 * The network's answer to REGISTER or VERIFY.
 *
 * [status] is the protocol word — `SUCCESS`, `VERIFICATION_REQUIRED`, or the
 * `FAIL` code — and [text] is the sentence a person should read. Both are kept
 * because the screen acts on the first and shows the second.
 */
data class AccountReply(
    val serverId: String,
    val status: String,
    val account: String?,
    val text: String?,
    val failed: Boolean,
    val at: Long = System.currentTimeMillis()
)

/** IRCv3 draft/metadata-2 keys we render */
data class UserMetadata(
    val displayName: String? = null,
    val avatar: String? = null,
    val pronouns: String? = null,
    val status: String? = null,
    val homepage: String? = null,
    val color: String? = null
) {
    fun with(key: String, value: String?): UserMetadata = when (key) {
        "display-name" -> copy(displayName = value)
        "avatar" -> copy(avatar = value)
        "pronouns" -> copy(pronouns = value)
        "status" -> copy(status = value)
        "homepage" -> copy(homepage = value)
        "color" -> copy(color = value)
        else -> this
    }
}

class SwitchboardStore {

    val servers = mutableStateMapOf<String, Server>()
    val channels = mutableStateMapOf<String, List<Channel>>()          // serverId -> channels
    /**
     * Everything said, per conversation.
     *
     * `List` rather than `MutableList` on purpose. The value used to be a
     * mutable list that arriving messages were appended to in place, followed
     * by a write of an equal list to "publish" the change — and neither half
     * of that notifies Compose. A plain list mutated in place is not snapshot
     * state, and a map write whose value is structurally equal to what is
     * already there is a no-op, so the write did not even replace the plain
     * list with the state list it was trying to.
     *
     * The result was a conversation that stopped updating after its first
     * message and only caught up when something else forced a recomposition —
     * changing channel and coming back. It showed up on servers without
     * `draft/chathistory` and nowhere else, because a history load replaces
     * this value wholesale and papered over it.
     *
     * Held as an unmodifiable type so that "append to what is there" is not
     * something anybody can write by accident. Every change builds a new list,
     * which is what makes the map notice it.
     */
    val messages = mutableStateMapOf<String, List<Message>>()                 // "serverId:#chan" -> messages
    val members = mutableStateMapOf<String, List<Member>>()            // "serverId:#chan" -> members
    val metadata = mutableStateMapOf<String, UserMetadata>()                  // "serverId:nick" -> profile

    /** Who is typing where, and when they last said so */
    val typing = mutableStateMapOf<String, MutableMap<String, Long>>()        // "serverId:#chan" -> nick -> at

    var activeServerId by mutableStateOf<String?>(null)
    var activeChannel by mutableStateOf<String?>(null)
    var status by mutableStateOf("Not connected")

    /** What LIST is telling us, while a browse is open */
    val channelListing = mutableStateListOf<ChannelListing>()
    var channelListComplete by mutableStateOf(true)
        private set

    /**
     * The last thing the server refused, and when.
     *
     * Errors were emitted and then dropped, so a join that failed or a message
     * the channel would not take did nothing and said nothing — which reads as
     * the app being broken rather than the server saying no.
     */
    var lastError by mutableStateOf<ServerRefusal?>(null)
        private set

    fun clearError() { lastError = null }

    /**
     * A network wanting something done about our account, and what.
     *
     * Two things land here and both are easy to miss. NickServ's notice arrives
     * as a message from a stranger, in a conversation nobody was looking at. A
     * SASL failure arrives during connection, as one refusal among the others,
     * and then the user simply spends the evening as a stranger on their own
     * network. Held here so the conversation can say so and offer the way in.
     */
    var identifyPrompt by mutableStateOf<IdentifyPrompt?>(null)

    fun clearIdentifyPrompt() { identifyPrompt = null }

    /** The network refused the account we had saved for it */
    fun noteLoginFailed(serverId: String, reason: String?) {
        identifyPrompt = IdentifyPrompt(
            serverId,
            reason?.takeIf { it.isNotBlank() } ?: "Logging in to this network failed"
        )
    }

    /**
     * What the network said about registering an account, when it last said
     * anything.
     *
     * The screen that asked is waiting on this: REGISTER and VERIFY are answered
     * asynchronously, and a "creating your account…" spinner with nothing on the
     * other end is worse than no spinner at all.
     */
    var accountReply by mutableStateOf<AccountReply?>(null)

    fun clearAccountReply() { accountReply = null }

    /** Something we refused ourselves — a bad command, a topic the server would cut */
    fun noteRefusal(text: String, subject: String? = null) {
        lastError = ServerRefusal(text, subject, System.currentTimeMillis())
    }

    /**
     * Where we had read up to when a conversation was opened.
     *
     * Frozen on entry rather than followed live: a line that moves down as you
     * read is not a place, and the whole point is to be able to find where you
     * left off after being away.
     */
    val readUpTo = mutableStateMapOf<String, String>()                      // "serverId:#chan" -> timestamp

    /** Note the marker for a conversation being opened, if we have one */
    fun markEntryPoint(serverId: String, channel: String, timestamp: String?) {
        val conversation = key(serverId, channel)
        if (timestamp.isNullOrBlank()) readUpTo.remove(conversation)
        else readUpTo[conversation] = timestamp
    }

    /** The timestamp the "new messages" line belongs after, if any */
    fun entryPoint(serverId: String, channel: String): String? =
        readUpTo[key(serverId, channel)]

    /** What the network answered the last SEARCH with */
    val searchResults = mutableStateListOf<SearchHit>()
    var searchComplete by mutableStateOf(true)
        private set

    fun beginSearch() {
        searchResults.clear()
        searchComplete = false
    }

    fun endSearch() { searchComplete = true }

    /** MONITOR: who we asked the server to tell us about */
    val watched = mutableStateMapOf<String, MutableList<String>>()          // serverId -> nicks

    /** Who is online of those, per away/online notification */
    val watchedOnline = mutableStateMapOf<String, Boolean>()                // "serverId:nick" -> online

    /** Conversations with one person rather than a channel */
    /**
     * One conversation with one person, on one network.
     *
     * The network is part of the identity rather than a label on it: `robin`
     * on Libera and `robin` on OFTC are two people, and a list that merges
     * them is a list that puts a message in front of the wrong one.
     */
    data class DirectMessage(
        val serverId: String,
        val serverName: String,
        val nick: String,
        val unread: Int,
        val mentions: Int
    )

    /**
     * Everybody who has written to you, across every network.
     *
     * The desktop has had this behind one button since it had a server rail;
     * the phone listed them per network, buried under that network's channels,
     * so a message from someone on a network you were not looking at was
     * somewhere you had to already know to look. Same model on both now.
     *
     * Ordered by unread first and then by name, so the ones wanting an answer
     * are at the top and the rest do not move around underneath them.
     */
    fun allDirectMessages(): List<DirectMessage> =
        servers.values
            .sortedBy { it.name.lowercase() }
            .flatMap { server ->
                channels[server.id].orEmpty()
                    .filterNot { isChannel(it.name) || isConsole(it.name) }
                    .filterNot { Services.isServices(it.name) }
                    .map {
                        DirectMessage(
                            serverId = server.id,
                            serverName = server.name,
                            nick = it.name,
                            unread = it.unread,
                            mentions = it.mentions
                        )
                    }
            }
            .sortedWith(
                compareByDescending<DirectMessage> { it.unread > 0 }
                    .thenBy { it.nick.lowercase() }
            )

    /** For the badge on the rail: everything unanswered, everywhere */
    fun directMessageUnread(): Int = allDirectMessages().sumOf { it.unread }

    /**
     * Whether the conversation list is showing people rather than a network.
     *
     * The rail's top item, the way every app of this shape does it. Kept here
     * rather than in the screen so that opening a notification can put the
     * phone straight into the conversation it is about.
     */
    var dmMode by mutableStateOf(false)

    fun directMessages(serverId: String): List<String> =
        channels[serverId].orEmpty()
            .filterNot { isChannel(it.name) || isConsole(it.name) }
            .map { it.name }

    /** Whether this server has anything in its console worth showing */
    fun hasConsole(serverId: String): Boolean =
        messages[key(serverId, SERVER_CONSOLE)]?.isNotEmpty() == true

    /**
     * Make sure a conversation exists to put messages in.
     *
     * A channel arrives with a JOIN; a person never does. Without this a direct
     * message has nowhere to be listed and no unread count, so it only exists
     * while you happen to be looking at it.
     */
    fun openConversation(serverId: String, name: String) {
        val list = channels[serverId] ?: emptyList()
        if (list.any { it.name.equals(name, true) }) return
        channels[serverId] = list + Channel(name)
    }

    private fun key(serverId: String, channel: String) = "$serverId:${channel.lowercase()}"

    fun conversationKey(): String? {
        val server = activeServerId ?: return null
        val channel = activeChannel ?: return null
        return key(server, channel)
    }

    fun messagesFor(serverId: String, channel: String): List<Message> =
        messages[key(serverId, channel)] ?: emptyList()

    fun membersFor(serverId: String, channel: String): List<Member> =
        members[key(serverId, channel)] ?: emptyList()

    fun metadataFor(serverId: String, nick: String): UserMetadata =
        metadata["$serverId:${nick.lowercase()}"] ?: UserMetadata()

    fun displayName(serverId: String, nick: String): String =
        metadataFor(serverId, nick).displayName?.takeIf { it.isNotBlank() } ?: nick

    fun channelsFor(serverId: String): List<Channel> = channels[serverId] ?: emptyList()

    fun select(serverId: String, channel: String) {
        activeServerId = serverId
        activeChannel = channel
        val list = channels[serverId] ?: return
        channels[serverId] = list.map {
            if (it.name.equals(channel, true)) it.copy(unread = 0, mentions = 0) else it
        }
    }

    // ── Building from the desktop's snapshot ──────────────────────────

    /** Apply `app:renderer-ready`: every connected server and what it is in. */
    /**
     * Conversations we learned about from `CHATHISTORY TARGETS` and have not
     * yet fetched.
     *
     * Held so the engine can ask for each one's history without the store
     * needing a connection of its own.
     */
    val missedConversations = mutableStateListOf<String>()

    /**
     * Capabilities the network offered, and their values, per server.
     *
     * Filled from the desktop's snapshot while following, and from our own
     * connection while holding, so a screen reads one place either way.
     */
    val capabilityValues = mutableStateMapOf<String, Map<String, String>>()

    /**
     * Which networks the desktop was last seen holding.
     *
     * Its own fact rather than a read of `servers[…].connected`, because that
     * is cleared the moment the link drops — which is exactly the moment this
     * is needed. What the desktop had open is what this phone should open when
     * it stands in for it.
     */
    val heldByDesktop = mutableSetOf<String>()

    fun applySnapshot(snapshot: JsonElement, serverList: JsonElement) {
        serverList.jsonArray.forEach { entry ->
            val server = entry.jsonObject
            val id = server["id"]?.str() ?: return@forEach
            servers[id] = Server(
                id = id,
                name = server["name"]?.str() ?: id,
                host = server["host"]?.str() ?: "",
                nick = server["nick"]?.str() ?: ""
            )
        }

        heldByDesktop.clear()

        snapshot.jsonArray.forEach { entry ->
            val live = entry.jsonObject
            val id = live["serverId"]?.str() ?: return@forEach
            heldByDesktop.add(id)
            servers[id]?.let {
                servers[id] = it.copy(
                    connected = true,
                    nick = live["nick"]?.str() ?: it.nick,
                    // Whose account the desktop is on that network as. The
                    // account screen is built on this, and following a desktop
                    // there is no connection here to ask.
                    account = live["account"]?.str()
                )
            }

            // What the network offered, and what each offer said about itself.
            // Following a desktop this is the only way to know: there is no
            // connection here to ask, and a screen that guesses offers forms
            // the network will refuse.
            live["capabilityValues"]?.jsonObject?.let { values ->
                capabilityValues[id] = values.mapValues { (_, value) ->
                    (value as? JsonPrimitive)?.contentOrNull.orEmpty()
                }
            }

            val list = mutableListOf<Channel>()
            live["channels"]?.jsonArray?.forEach { channelEntry ->
                val channel = channelEntry.jsonObject
                val name = channel["name"]?.str() ?: return@forEach
                list.add(Channel(name = name, topic = channel["topic"]?.str()))
                members[key(id, name)] = channel["users"]?.jsonArray
                    ?.map { it.jsonObject.toMember() }
                    ?.toMutableList() ?: mutableListOf()
            }
            // A snapshot says what the desktop is *in*, which is channels and
            // only channels — it has no idea about the conversation somebody
            // opened by writing to you. Replacing the list wholesale therefore
            // deleted every direct message on that network the moment a
            // snapshot arrived, which is whenever the link to the desktop came
            // back. The conversation was still there on the desktop and gone
            // here, with nothing to say why.
            //
            // Channels are the desktop's to declare; conversations with people
            // are this phone's own knowledge, and are kept.
            val keep = channels[id].orEmpty().filterNot { isChannel(it.name) }
            channels[id] = list + keep.filterNot { held ->
                list.any { it.name.equals(held.name, true) }
            }

            // Whatever the desktop already knows about people's profiles
            live["metadata"]?.jsonObject?.forEach { (nick, profile) ->
                var entry = metadata["$id:${nick.lowercase()}"] ?: UserMetadata()
                profile.jsonObject.forEach { (key, value) ->
                    entry = entry.with(key, value.str()?.takeIf { it.isNotEmpty() })
                }
                metadata["$id:${nick.lowercase()}"] = entry
            }

            // A connected server is worth selecting even with nothing joined
            // yet: the alternative is a window that stays on "nothing here"
            // while channels arrive underneath it.
            if (activeServerId == null) {
                activeServerId = id
                activeChannel = list.firstOrNull()?.name
            }
        }
    }

    fun setHistory(serverId: String, channel: String, history: JsonElement) {
        messages[key(serverId, channel)] = history.jsonArray
            .map { it.jsonObject.toMessage() }
    }

    // ── Live events, mirroring the desktop's own handlers ─────────────

    fun handleEvent(channelName: String, data: JsonElement) {
        if (data !is JsonObject) return
        val serverId = data["serverId"]?.str() ?: return

        when (channelName) {
            "irc:connected" -> {
                servers[serverId] = (servers[serverId] ?: return).copy(
                    connected = true,
                    nick = data["nick"]?.str() ?: "",
                    account = data["account"]?.str()
                )
                // Nothing was selected because nothing was connected the last
                // time we looked — which is what pairing before the desktop
                // has dialled anything leaves behind. A server coming up is
                // the moment to choose one; without this the phone sits on
                // "nothing joined yet" while the desktop fills up, and only a
                // restart puts it right.
                if (activeServerId == null) activeServerId = serverId
            }

            "irc:disconnected" -> {
                servers[serverId] = (servers[serverId] ?: return).copy(connected = false)
            }

            "irc:join" -> {
                val channel = data["channel"]?.str() ?: return
                val list = channels[serverId] ?: emptyList()
                if (list.none { it.name.equals(channel, true) }) {
                    channels[serverId] = list + Channel(channel)
                }

                // Same again for a join that arrives before anything is
                // selected, and for the first channel on the server we are
                // looking at.
                if (activeServerId == null) activeServerId = serverId
                if (activeServerId == serverId && activeChannel == null) activeChannel = channel

                data["user"]?.jsonObject?.toMember()?.let { member ->
                    val roster = members[key(serverId, channel)] ?: emptyList()
                    if (roster.none { it.nick.equals(member.nick, true) }) {
                        members[key(serverId, channel)] = roster + member
                    }
                }
            }

            "irc:part", "irc:kick" -> {
                val channel = data["channel"]?.str() ?: return
                val nick = data["nick"]?.str() ?: return
                if (data["isMe"]?.jsonPrimitive?.booleanOrNull == true) {
                    channels[serverId] = (channels[serverId] ?: mutableListOf())
                        .filterNot { it.name.equals(channel, true) }
                        .toMutableStateList()
                    if (activeChannel.equals(channel, true)) {
                        activeChannel = channels[serverId]?.firstOrNull()?.name
                    }
                } else {
                    removeMember(serverId, channel, nick)
                }
            }

            "irc:quit" -> {
                val nick = data["nick"]?.str() ?: return
                members.keys.filter { it.startsWith("$serverId:") }.forEach { conversation ->
                    members[conversation] = (members[conversation] ?: return@forEach)
                        .filterNot { it.nick.equals(nick, true) }
                        .toMutableStateList()
                }
            }

            "irc:nick" -> {
                val oldNick = data["oldNick"]?.str() ?: return
                val newNick = data["newNick"]?.str() ?: return
                members.keys.filter { it.startsWith("$serverId:") }.forEach { conversation ->
                    members[conversation] = (members[conversation] ?: return@forEach)
                        .map { if (it.nick.equals(oldNick, true)) it.copy(nick = newNick) else it }
                        .toMutableStateList()
                }
                servers[serverId]?.let {
                    if (it.nick.equals(oldNick, true)) servers[serverId] = it.copy(nick = newNick)
                }

                // A profile belongs to the person, not to the name they had at
                // the time. Leaving it behind means a rename — including our
                // own, every time a fallback nick is given back — drops their
                // display name, colour and avatar.
                val from = "$serverId:${oldNick.lowercase()}"
                val to = "$serverId:${newNick.lowercase()}"
                metadata.remove(from)?.let { moved -> metadata[to] = moved }
            }

            "irc:names" -> {
                val channel = data["channel"]?.str() ?: return
                members[key(serverId, channel)] = data["users"]?.jsonArray
                    ?.map { it.jsonObject.toMember() }
                    ?.toMutableStateList() ?: return
            }

            "irc:topic" -> {
                val channel = data["channel"]?.str() ?: return
                channels[serverId] = (channels[serverId] ?: return)
                    .map { if (it.name.equals(channel, true)) it.copy(topic = data["topic"]?.str()) else it }
                    .toMutableStateList()
            }

            "irc:message" -> {
                val channel = data["channel"]?.str() ?: return
                val message = data["message"]?.jsonObject?.toMessage() ?: return
                val conversation = key(serverId, channel)

                // A direct message is the first anyone hears of that
                // conversation, so it has to create one. The server's own
                // target is not a person and gets one anyway — it is where its
                // notices go — but it is listed as the console, not as a DM.
                if (!isChannel(channel)) openConversation(serverId, channel)

                val current = messages[conversation] ?: emptyList()
                if (current.none { it.id == message.id }) {
                    messages[conversation] =
                        current.toMutableList().also { it.insertByTime(message) }
                }

                // They have said their piece; stop showing them as typing
                typing[conversation]?.let { who ->
                    if (who.remove(message.nick) != null) typing[conversation] = LinkedHashMap(who)
                }

                // NickServ, asking us to log in. Historical lines are replayed
                // history: a prompt from an hour ago is not a prompt.
                val historical = data["message"]?.jsonObject
                    ?.get("historical")?.jsonPrimitive?.booleanOrNull == true
                if (Services.isServices(message.nick) && !historical) {
                    when {
                        Services.confirmsIdentification(message.content) -> identifyPrompt = null
                        Services.asksForIdentification(message.content) &&
                            servers[serverId]?.account == null ->
                            identifyPrompt = IdentifyPrompt(
                                serverId,
                                "This nick is registered — log in to use it"
                            )
                    }
                }

                // Unread, unless this is the conversation on screen
                if (conversation != conversationKey()) {
                    val myNick = servers[serverId]?.nick ?: ""
                    // Someone messaging you directly is a mention by
                    // definition — but the server is not someone, and its
                    // connection banner is not four people saying your name.
                    val mentioned = when {
                        isConsole(channel) -> false
                        !isChannel(channel) -> true
                        else -> namesYou(message.content, myNick)
                    }
                    channels[serverId] = (channels[serverId] ?: return)
                        .map {
                            if (it.name.equals(channel, true)) {
                                it.copy(
                                    unread = it.unread + 1,
                                    mentions = it.mentions + if (mentioned) 1 else 0
                                )
                            } else {
                                it
                            }
                        }
                        .toMutableStateList()
                }
            }

            // away-notify: one person's presence changed, so update just them
            // rather than asking the server for the whole roster again.
            //
            // Two shapes, because the two clients send two: ours says so with a
            // flag, the desktop says so by whether there is a message. Reading
            // only the flag meant that following a desktop, nobody was ever
            // away — the event arrived and was dropped on its first line.
            "irc:away" -> {
                val nick = data["nick"]?.str() ?: return
                val away = data["away"]?.jsonPrimitive?.booleanOrNull
                    ?: (data["message"]?.str() != null)
                updateMember(serverId, nick) { it.copy(away = away) }

                val server = servers[serverId]
                if (server != null && nick.equals(server.nick, ignoreCase = true)) {
                    servers[serverId] = server.copy(away = away)
                }
            }

            "irc:setname", "irc:account" -> {
                val nick = data["nick"]?.str() ?: return

                // Our own login state, which the account screen is built on.
                // Everyone else's is on the roster entry the line below keeps.
                val server = servers[serverId]
                if (server != null && nick.equals(server.nick, ignoreCase = true)) {
                    val account = data["account"]?.str()
                    servers[serverId] = server.copy(account = account)
                    // Logged in. Whatever was being asked for has been done.
                    if (account != null && identifyPrompt?.serverId == serverId) {
                        identifyPrompt = null
                    }
                }
                updateMember(serverId, nick) { it }
            }

            // draft/account-registration, both halves of it. The desktop
            // relays the first under its own older name, so both are read.
            "irc:register", "irc:verify", "irc:account-registered" -> {
                accountReply = AccountReply(
                    serverId = serverId,
                    status = data["status"]?.str().orEmpty(),
                    account = data["account"]?.str(),
                    text = data["message"]?.str(),
                    failed = false
                )
            }

            "irc:typing" -> {
                val channel = data["channel"]?.str() ?: return
                val nick = data["nick"]?.str() ?: return

                // Not our own. A server with echo-message sends our TAGMSG back
                // to us, so the phone sat there telling itself that we were
                // typing — which we could see, having been the one doing it.
                if (nick.equals(servers[serverId]?.nick, ignoreCase = true)) return

                val conversation = key(serverId, channel)
                val who = typing[conversation] ?: mutableMapOf()

                // "done" and "paused" both mean stop showing them
                if (data["state"]?.str() == "active") {
                    who[nick] = System.currentTimeMillis()
                } else {
                    who.remove(nick)
                }
                typing[conversation] = LinkedHashMap(who)
            }

            // The desktop's name for it, so one event serves both clients
            "irc:react" -> {
                val channel = data["channel"]?.str() ?: return
                val nick = data["nick"]?.str() ?: return
                val target = data["msgid"]?.str() ?: return
                val emoji = data["emoji"]?.str() ?: return
                val removed = data["removed"]?.jsonPrimitive?.booleanOrNull ?: false

                updateMessage(serverId, channel, target) { message ->
                    val people = message.reactions[emoji].orEmpty().toMutableSet()
                    if (removed) people.remove(nick) else people.add(nick)

                    val next = message.reactions.toMutableMap()
                    if (people.isEmpty()) next.remove(emoji) else next[emoji] = people
                    message.copy(reactions = next)
                }
            }

            // draft/message-edit — the same text, said again, differently
            "irc:edit" -> {
                val channel = data["channel"]?.str() ?: return
                val target = data["originalId"]?.str() ?: return
                val content = data["newContent"]?.str() ?: return
                updateMessage(serverId, channel, target) {
                    it.copy(content = content, editedAt = data["editedAt"]?.str() ?: it.timestamp)
                }
            }

            "irc:redact" -> {
                val channel = data["channel"]?.str() ?: return
                val target = data["msgid"]?.str() ?: return
                // A tombstone rather than a deletion: a message that silently
                // vanishes reads as a bug, and the fact of the redaction is
                // itself something people need to see.
                updateMessage(serverId, channel, target) {
                    it.copy(redactedBy = data["by"]?.str() ?: "someone")
                }
            }

            "irc:error" -> {
                val text = data["message"]?.str()?.takeIf { it.isNotBlank() } ?: return
                val command = data["command"]?.str()?.takeIf { it.isNotBlank() }

                // `FAIL REGISTER ACCOUNT_EXISTS :…`. A screen waiting on
                // REGISTER has to know its own attempt failed, or it watches a
                // spinner until it gives up and says nothing useful. Both modes
                // deliver refusals this way, so one rule covers both.
                if (command == "REGISTER" || command == "VERIFY") {
                    accountReply = AccountReply(
                        serverId = serverId,
                        status = data["code"]?.str().orEmpty(),
                        account = null,
                        text = text,
                        failed = true
                    )
                }

                // A failed login is worth a banner that stays: the connection
                // carries on regardless, and six seconds of red during
                // registration is not a thing anyone was watching for.
                if (command == "SASL") noteLoginFailed(serverId, text)

                lastError = ServerRefusal(text, command, System.currentTimeMillis())
            }

            // draft/read-marker — another device says where it had read up to
            "irc:read-marker" -> {
                val channel = data["channel"]?.str() ?: return
                val timestamp = data["timestamp"]?.str() ?: return
                if (conversationKey() != key(serverId, channel)) {
                    markEntryPoint(serverId, channel, timestamp)
                }

                // Somebody read this on the other device. Drawing the divider
                // and leaving the badge lit is half the feature: catching up at
                // the desk and still finding forty unread on the phone is what
                // draft/read-marker exists to prevent.
                //
                // Only when there is nothing newer than the marker: a channel
                // that has moved on since it was read is unread again.
                val newest = messagesFor(serverId, channel).lastOrNull()?.timestamp
                if (newest == null || newest <= timestamp) {
                    channels[serverId] = (channels[serverId] ?: return)
                        .map { if (it.name.equals(channel, true)) it.copy(unread = 0, mentions = 0) else it }
                        .toMutableStateList()
                }
            }

            /**
             * A conversation somebody started while this device was closed.
             *
             * Channels are covered by rejoining them. A DM is not: nothing is
             * joined, so a message from somebody new leaves no trace for a
             * client that was not there. Only the ones we have no record of at
             * all are worth opening — the rest are already on screen.
             */
            "irc:chathistory-target" -> {
                val target = data["target"]?.str() ?: return
                if (isChannel(target) || Services.isServices(target)) return
                if (channelsFor(serverId).any { it.name.equals(target, true) }) return

                openConversation(serverId, target)
                missedConversations.add(key(serverId, target))
            }

            "irc:search-results" -> {
                searchResults.clear()
                data["messages"]?.jsonArray?.forEach { entry ->
                    val row = entry.jsonObject
                    searchResults.add(
                        SearchHit(
                            channel = row["channel"]?.str().orEmpty(),
                            nick = row["nick"]?.str().orEmpty(),
                            content = row["content"]?.str().orEmpty(),
                            timestamp = row["timestamp"]?.str().orEmpty(),
                            id = row["id"]?.str().orEmpty()
                        )
                    )
                }
                searchComplete = true
            }

            "irc:list-entry" -> {
                if (serverId == activeListServer) {
                    channelListing.add(
                        ChannelListing(
                            name = data["channel"]?.str() ?: return,
                            users = (data["users"] as? JsonPrimitive)?.intOrNull ?: 0,
                            topic = data["topic"]?.str().orEmpty()
                        )
                    )
                }
            }

            "irc:list-end" -> if (serverId == activeListServer) channelListComplete = true

            "irc:monitor-online", "irc:monitor-offline" -> {
                val nick = data["nick"]?.str() ?: return
                watchedOnline["$serverId:${nick.lowercase()}"] = channelName == "irc:monitor-online"
            }

            "irc:monitor-list" -> {
                val nicks = data["targets"]?.str()
                    ?.split(",")
                    ?.map { it.trim() }
                    ?.filter { it.isNotEmpty() }
                    ?: return
                val list = watched.getOrPut(serverId) { mutableListOf() }
                for (nick in nicks) if (list.none { it.equals(nick, true) }) list.add(nick)
                watched[serverId] = list.toMutableStateList()
            }

            "irc:metadata" -> {
                val target = data["target"]?.str() ?: return
                val metadataKey = data["key"]?.str() ?: return
                val value = data["value"]?.str()
                val mapKey = "$serverId:${target.lowercase()}"
                metadata[mapKey] = (metadata[mapKey] ?: UserMetadata())
                    .with(metadataKey, value?.takeIf { it.isNotEmpty() })
            }
        }
    }

    // ── things the UI asks for by name ───────────────────────────────

    fun beginChannelList(serverId: String) {
        channelListing.clear()
        channelListComplete = false
        activeListServer = serverId
    }

    /** The desktop answered in one go, rather than a 322 at a time */
    fun setChannelList(serverId: String, listing: List<ChannelListing>) {
        activeListServer = serverId
        channelListing.clear()
        channelListing.addAll(listing)
        channelListComplete = true
    }

    /** Nothing more is coming, however it went */
    fun endChannelList() {
        channelListComplete = true
    }

    private var activeListServer: String? = null

    fun watchedFor(serverId: String): List<String> = watched[serverId].orEmpty()

    /**
     * Adopt a watched list from the vault.
     *
     * MONITOR is per connection: the server reports who is *online* and never
     * who is on the list, so a device has to be handed it rather than being
     * able to ask.
     */
    fun setWatched(serverId: String, nicks: List<String>) {
        watched[serverId] = nicks.toMutableList()
    }

    fun isOnline(serverId: String, nick: String): Boolean =
        watchedOnline["$serverId:${nick.lowercase()}"] == true

    /** Forget a network we no longer have, so nothing renders for it */
    fun forgetServer(serverId: String) {
        servers.remove(serverId)
        channels.remove(serverId)
        watched.remove(serverId)
        messages.keys.filter { it.startsWith("$serverId:") }.forEach { messages.remove(it) }
        members.keys.filter { it.startsWith("$serverId:") }.forEach { members.remove(it) }
        metadata.keys.filter { it.startsWith("$serverId:") }.forEach { metadata.remove(it) }
        if (activeServerId == serverId) {
            activeServerId = servers.keys.firstOrNull()
            activeChannel = activeServerId?.let { channels[it]?.firstOrNull()?.name }
        }
    }

    /**
     * Put older messages above what we already have.
     *
     * Returns how many were genuinely new, which is how the UI knows whether
     * scrolling further up is worth offering — a page of nothing but duplicates
     * means we have reached the beginning.
     */
    fun prependHistory(serverId: String, channel: String, history: JsonElement): Int {
        val conversation = key(serverId, channel)
        val existing = messages[conversation] ?: emptyList()
        val known = existing.map { it.id }.toHashSet()

        val older = history.jsonArray
            .map { it.jsonObject.toMessage() }
            .filter { known.add(it.id) }

        if (older.isEmpty()) return 0
        messages[conversation] = older + existing
        return older.size
    }

    /**
     * Search what this phone is holding.
     *
     * Only used while the phone *is* the connection: the desktop has a database
     * of everything ever said and this has the current session, so the answers
     * differ and the UI says which one it got.
     */
    fun searchLocally(serverId: String, term: String, channel: String?): List<SearchHit> {
        val wanted = channel?.lowercase()
        return messages.entries
            .filter { it.key.startsWith("$serverId:") }
            .filter { wanted == null || it.key == "$serverId:$wanted" }
            .flatMap { (conversation, list) ->
                val name = conversation.removePrefix("$serverId:")
                list.filter { it.content.contains(term, ignoreCase = true) }
                    .map { SearchHit(name, it.nick, it.content, it.timestamp, it.id) }
            }
            .sortedByDescending { it.timestamp }
            .take(50)
    }

    /** Change one message in place, if we still have it */
    private fun updateMessage(
        serverId: String,
        channel: String,
        messageId: String,
        change: (Message) -> Message
    ) {
        val conversation = key(serverId, channel)
        val list = messages[conversation] ?: return
        if (list.none { it.id == messageId }) return
        messages[conversation] = list.map { if (it.id == messageId) change(it) else it }
    }

    /**
     * Who is currently typing here, forgetting anyone who went quiet.
     *
     * The typing spec says a client should stop showing someone after six
     * seconds without an update, because the "done" that would have cleared it
     * is exactly what gets lost when someone closes their laptop mid-sentence.
     */
    fun typingIn(serverId: String, channel: String): List<String> {
        val cutoff = System.currentTimeMillis() - TYPING_TIMEOUT_MS
        return typing[key(serverId, channel)]
            ?.filterValues { it >= cutoff }
            ?.keys
            ?.toList()
            .orEmpty()
    }

    /** Apply a change to one person everywhere they appear on this server */
    private fun updateMember(serverId: String, nick: String, change: (Member) -> Member) {
        for (conversation in members.keys.filter { it.startsWith("$serverId:") }) {
            val roster = members[conversation] ?: continue
            if (roster.none { it.nick.equals(nick, true) }) continue
            members[conversation] = roster
                .map { if (it.nick.equals(nick, true)) change(it) else it }
                .toMutableStateList()
        }
    }

    private fun removeMember(serverId: String, channel: String, nick: String) {
        val conversation = key(serverId, channel)
        members[conversation] = (members[conversation] ?: return)
            .filterNot { it.nick.equals(nick, true) }
            .toMutableStateList()
    }
}

// ── JSON helpers ─────────────────────────────────────────────────────

private fun JsonElement.str(): String? =
    if (this is JsonPrimitive) contentOrNull else null

private fun JsonObject.toMember(): Member = Member(
    nick = this["nick"]?.str() ?: "",
    prefixes = this["prefixes"]?.jsonArray?.mapNotNull { it.str() } ?: emptyList(),
    away = this["away"]?.jsonPrimitive?.booleanOrNull ?: false,
    isBot = this["isBot"]?.jsonPrimitive?.booleanOrNull ?: false
)

private fun JsonObject.toMessage(): Message = Message(
    id = this["id"]?.str() ?: (this["timestamp"]?.str() ?: "") + (this["nick"]?.str() ?: ""),
    nick = this["nick"]?.str() ?: "",
    content = this["content"]?.str() ?: "",
    timestamp = this["timestamp"]?.str() ?: "",
    type = this["type"]?.str() ?: "privmsg",
    replyTo = this["replyTo"]?.str(),
    // Stored history carries this, so a correction stays visibly a correction
    // after a restart rather than quietly becoming the original wording
    editedAt = this["editedAt"]?.str(),
    oper = this["oper"]?.str(),
    relayedBy = this["relayedBy"]?.str(),
    // And the reactions, for the same reason: the desktop keeps them now, so
    // reopening a conversation should not quietly strip them off again
    reactions = (this["reactions"] as? JsonObject)
        ?.mapNotNull { (emoji, people) ->
            val who = (people as? JsonArray)?.mapNotNull { it.str() }?.toSet()
            if (who.isNullOrEmpty()) null else emoji to who
        }
        ?.toMap()
        .orEmpty()
)

/**
 * Put a message where its timestamp says it belongs.
 *
 * Live traffic is almost always newer than everything already held, so the walk
 * from the end stops immediately and this costs nothing. History is the reason
 * it exists: `chathistory` replays arrive as ordinary messages carrying their
 * own `time` tag, and appending them put a conversation from ten minutes ago
 * underneath one from ten seconds ago — with the day separator drawn twice,
 * once on the way back and once on the way forward again.
 *
 * ISO-8601 in UTC sorts correctly as text, which is what the server-time tag
 * always is. A message with no timestamp goes at the end, where a client with
 * nothing better to go on would have put it anyway.
 */
private fun MutableList<Message>.insertByTime(message: Message) {
    if (message.timestamp.isEmpty()) { add(message); return }

    var at = size
    while (at > 0) {
        val before = this[at - 1].timestamp
        if (before.isEmpty() || before <= message.timestamp) break
        at--
    }
    add(at, message)
}

/**
 * Whether a conversation is a channel rather than a person.
 *
 * IRC says so with the first character, and the two the RFC defines cover
 * everything in practice. The distinction decides whether a name is rendered
 * with a `#`, which is the difference between a room and a human being.
 */
fun isChannel(name: String): Boolean = name.startsWith("#") || name.startsWith("&")

/**
 * Where the server itself talks.
 *
 * IRC has no target for "the server", so servers address their own notices to
 * `*` — "Looking up your hostname", "Checking ident", and later the ones that
 * matter, like being told you are now an operator. It is not a person, and
 * treating it as one put Libera's connection banner in Direct Messages and
 * counted every line of it as somebody saying your name.
 */
const val SERVER_CONSOLE = "*"

fun isConsole(name: String): Boolean = name == SERVER_CONSOLE

/**
 * Whether a line says your name, as a name rather than as a fragment.
 *
 * One rule, in one place, because three parts of the app ask this question and
 * they must agree: the line the notifier rings for, the line the badge counts,
 * and the line the conversation highlights should be the same line. They were
 * not — the badge used a plain substring match, so "karaoke" counted as
 * somebody saying "kara".
 *
 * IRC nicks may contain `[]{}\`|^-`, so those count as part of the word: "kara"
 * must not match inside "kara[work]" either.
 */
fun namesYou(text: String, nick: String): Boolean {
    if (nick.isEmpty()) return false
    // Against the line as it reads. A nick written in colour arrives with the
    // colour's digits in front of it, and a digit is a word character — so the
    // boundary check failed and being highlighted in red was the one way to not
    // be highlighted at all.
    val said = Formatting.strip(text)
    return Regex(
        "(?<![\\w\\[\\]{}\\\\`|^-])" + Regex.escape(nick) + "(?![\\w\\[\\]{}\\\\`|^-])",
        RegexOption.IGNORE_CASE
    ).containsMatchIn(said)
}

/** How long someone stays "typing" without saying so again */
const val TYPING_TIMEOUT_MS = 6_000L

/** Unused today, kept next to the parsers so the shape stays obvious */
internal fun JsonElement?.intOrZero(): Int =
    (this as? JsonPrimitive)?.intOrNull ?: 0

internal val EMPTY_JSON: JsonElement = JsonNull
