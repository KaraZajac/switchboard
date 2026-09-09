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
    var connected: Boolean = false
)

data class Channel(
    val name: String,
    var topic: String? = null,
    var unread: Int = 0,
    var mentions: Int = 0
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
    val editedAt: String? = null
)

data class Member(
    val nick: String,
    val prefixes: List<String> = emptyList(),
    val away: Boolean = false,
    val isBot: Boolean = false
)

/** Something the server declined to do, in words worth showing */
data class ServerRefusal(val text: String, val subject: String?, val at: Long)

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
    val channels = mutableStateMapOf<String, MutableList<Channel>>()          // serverId -> channels
    val messages = mutableStateMapOf<String, MutableList<Message>>()          // "serverId:#chan" -> messages
    val members = mutableStateMapOf<String, MutableList<Member>>()            // "serverId:#chan" -> members
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
    fun directMessages(serverId: String): List<String> =
        channels[serverId].orEmpty().filterNot { isChannel(it.name) }.map { it.name }

    /**
     * Make sure a conversation exists to put messages in.
     *
     * A channel arrives with a JOIN; a person never does. Without this a direct
     * message has nowhere to be listed and no unread count, so it only exists
     * while you happen to be looking at it.
     */
    fun openConversation(serverId: String, name: String) {
        val list = channels[serverId] ?: mutableListOf()
        if (list.any { it.name.equals(name, true) }) return
        list.add(Channel(name))
        channels[serverId] = list.toMutableStateList()
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
        channels[serverId]?.find { it.name.equals(channel, true) }?.let {
            it.unread = 0
            it.mentions = 0
        }
        // Force recomposition of the list holding the mutated channel
        channels[serverId] = channels[serverId]?.toMutableStateList() ?: return
    }

    // ── Building from the desktop's snapshot ──────────────────────────

    /** Apply `app:renderer-ready`: every connected server and what it is in. */
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

        snapshot.jsonArray.forEach { entry ->
            val live = entry.jsonObject
            val id = live["serverId"]?.str() ?: return@forEach
            servers[id]?.let { servers[id] = it.copy(connected = true, nick = live["nick"]?.str() ?: it.nick) }

            val list = mutableListOf<Channel>()
            live["channels"]?.jsonArray?.forEach { channelEntry ->
                val channel = channelEntry.jsonObject
                val name = channel["name"]?.str() ?: return@forEach
                list.add(Channel(name = name, topic = channel["topic"]?.str()))
                members[key(id, name)] = channel["users"]?.jsonArray
                    ?.map { it.jsonObject.toMember() }
                    ?.toMutableList() ?: mutableListOf()
            }
            channels[id] = list.toMutableStateList()

            // Whatever the desktop already knows about people's profiles
            live["metadata"]?.jsonObject?.forEach { (nick, profile) ->
                var entry = metadata["$id:${nick.lowercase()}"] ?: UserMetadata()
                profile.jsonObject.forEach { (key, value) ->
                    entry = entry.with(key, value.str()?.takeIf { it.isNotEmpty() })
                }
                metadata["$id:${nick.lowercase()}"] = entry
            }

            if (activeServerId == null && list.isNotEmpty()) {
                activeServerId = id
                activeChannel = list.first().name
            }
        }
    }

    fun setHistory(serverId: String, channel: String, history: JsonElement) {
        messages[key(serverId, channel)] = history.jsonArray
            .map { it.jsonObject.toMessage() }
            .toMutableStateList()
    }

    // ── Live events, mirroring the desktop's own handlers ─────────────

    fun handleEvent(channelName: String, data: JsonElement) {
        if (data !is JsonObject) return
        val serverId = data["serverId"]?.str() ?: return

        when (channelName) {
            "irc:connected" -> {
                servers[serverId] = (servers[serverId] ?: return).copy(
                    connected = true,
                    nick = data["nick"]?.str() ?: ""
                )
            }

            "irc:disconnected" -> {
                servers[serverId] = (servers[serverId] ?: return).copy(connected = false)
            }

            "irc:join" -> {
                val channel = data["channel"]?.str() ?: return
                val list = channels[serverId] ?: mutableListOf()
                if (list.none { it.name.equals(channel, true) }) list.add(Channel(channel))
                channels[serverId] = list.toMutableStateList()

                data["user"]?.jsonObject?.toMember()?.let { member ->
                    val roster = members.getOrPut(key(serverId, channel)) { mutableListOf() }
                    if (roster.none { it.nick.equals(member.nick, true) }) roster.add(member)
                    members[key(serverId, channel)] = roster.toMutableStateList()
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
                // conversation, so it has to create one
                if (!isChannel(channel)) openConversation(serverId, channel)

                val list = messages.getOrPut(conversation) { mutableListOf() }
                if (list.none { it.id == message.id }) list.add(message)
                messages[conversation] = list.toMutableStateList()

                // They have said their piece; stop showing them as typing
                typing[conversation]?.let { who ->
                    if (who.remove(message.nick) != null) typing[conversation] = LinkedHashMap(who)
                }

                // Unread, unless this is the conversation on screen
                if (conversation != conversationKey()) {
                    val myNick = servers[serverId]?.nick ?: ""
                    // Someone messaging you directly is a mention by definition
                    val mentioned = !isChannel(channel) ||
                        (myNick.isNotEmpty() && message.content.contains(myNick, true))
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
            // rather than asking the server for the whole roster again
            "irc:away" -> {
                val nick = data["nick"]?.str() ?: return
                val away = data["away"]?.jsonPrimitive?.booleanOrNull ?: return
                updateMember(serverId, nick) { it.copy(away = away) }
            }

            "irc:setname", "irc:account" -> {
                // Nothing rendered hangs off these yet, but they arrive for the
                // same person the roster already knows, so keep it current
                val nick = data["nick"]?.str() ?: return
                updateMember(serverId, nick) { it }
            }

            "irc:typing" -> {
                val channel = data["channel"]?.str() ?: return
                val nick = data["nick"]?.str() ?: return
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
                lastError = ServerRefusal(
                    text = text,
                    subject = data["command"]?.str()?.takeIf { it.isNotBlank() },
                    at = System.currentTimeMillis()
                )
            }

            // draft/read-marker — another device says where it had read up to
            "irc:read-marker" -> {
                val channel = data["channel"]?.str() ?: return
                val timestamp = data["timestamp"]?.str() ?: return
                if (conversationKey() != key(serverId, channel)) {
                    markEntryPoint(serverId, channel, timestamp)
                }
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

            "irc:monitor" -> {
                val nick = data["nick"]?.str() ?: return
                watchedOnline["$serverId:${nick.lowercase()}"] =
                    data["online"]?.jsonPrimitive?.booleanOrNull ?: false
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
        val existing = messages[conversation] ?: mutableListOf()
        val known = existing.map { it.id }.toHashSet()

        val older = history.jsonArray
            .map { it.jsonObject.toMessage() }
            .filter { known.add(it.id) }

        if (older.isEmpty()) return 0
        messages[conversation] = (older + existing).toMutableStateList()
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
        messages[conversation] = list
            .map { if (it.id == messageId) change(it) else it }
            .toMutableStateList()
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
 * Whether a conversation is a channel rather than a person.
 *
 * IRC says so with the first character, and the two the RFC defines cover
 * everything in practice. The distinction decides whether a name is rendered
 * with a `#`, which is the difference between a room and a human being.
 */
fun isChannel(name: String): Boolean = name.startsWith("#") || name.startsWith("&")

/** How long someone stays "typing" without saying so again */
const val TYPING_TIMEOUT_MS = 6_000L

/** Unused today, kept next to the parsers so the shape stays obvious */
internal fun JsonElement?.intOrZero(): Int =
    (this as? JsonPrimitive)?.intOrNull ?: 0

internal val EMPTY_JSON: JsonElement = JsonNull
