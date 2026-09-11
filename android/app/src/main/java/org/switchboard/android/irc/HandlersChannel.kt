package org.switchboard.android.irc

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Channels: who is in them, what they are called, what the modes are.
 *
 * The roster is the part a user notices immediately when it is wrong, and the
 * part most easily corrupted by treating replayed history as live — a QUIT from
 * last week removing someone who is still sitting there.
 */

internal fun channelJson(channel: ChannelState) = buildJsonObject {
    put("name", channel.name)
    put("topic", channel.topic)
    put("users", buildJsonArray { for (user in channel.users.values) add(userJson(user)) })
}

internal fun userJson(user: ChannelUser) = buildJsonObject {
    put("nick", user.nick)
    put("user", user.user)
    put("host", user.host)
    put("account", user.account)
    put("realname", user.realname)
    put("prefixes", buildJsonArray { for (prefix in user.prefixes) add(JsonPrimitive(prefix)) })
    put("away", user.away)
    put("isBot", user.isBot)
}

/**
 * One of a channel's mask lists, whole.
 *
 * Sent as one event rather than a line at a time, and in the shape the desktop
 * sends — a busy channel's ban list is hundreds of entries, and an event each
 * would be hundreds of redraws for one glance at a panel.
 */
internal fun emitMaskList(
    session: IrcSession,
    channel: String,
    mode: String,
    entries: List<MaskLists.Entry>
) {
    session.emit("irc:masklist", buildJsonObject {
        put("serverId", session.state.serverId)
        put("channel", channel)
        put("mode", mode)
        put("done", true)
        put("entries", JsonArray(entries.map { entry ->
            buildJsonObject {
                put("mask", entry.mask)
                entry.setBy?.let { put("setBy", it) }
                entry.setAt?.let { put("setAt", it) }
            }
        }))
    })
}

internal fun emitNames(session: IrcSession, channel: ChannelState) {
    session.emit("irc:names", buildJsonObject {
        put("serverId", session.state.serverId)
        put("channel", channel.name)
        put("users", buildJsonArray { for (user in channel.users.values) add(userJson(user)) })
    })
}

internal fun registerChannelHandlers() {

    Handlers.on("JOIN") { session, message ->
        val state = session.state
        val name = message.param(0) ?: return@on
        val nick = message.nick ?: return@on
        val mine = state.isMe(nick)

        // Our own JOIN carries our full mask, and it is the first time the
        // server shows it to us. Worth keeping: it is what gets prepended to
        // everything we say, so it decides how long a message can be.
        if (mine) {
            val user = message.source?.user
            val host = message.source?.host
            if (user != null && host != null) state.userHost = "$user@$host"
        }

        val channel = state.channel(name)

        // extended-join: JOIN <channel> <account> :<realname>
        val account = message.param(1)?.takeIf { it != "*" }
        channel.setUser(nick) {
            it.copy(
                nick = nick,
                user = message.source?.user ?: it.user,
                host = message.source?.host ?: it.host,
                account = account ?: it.account,
                realname = message.param(2) ?: it.realname
            )
        }

        session.emit("irc:join", buildJsonObject {
            put("serverId", state.serverId)
            put("channel", channel.name)
            put("isMe", mine)
            put("user", userJson(channel.user(nick)!!))
        })

        if (mine) {
            // With no-implicit-names the server will not send NAMES on its own,
            // so ask. NAMES rather than WHOX even where WHOX is available: the
            // 366 that ends it is what marks the roster complete, and the WHOX
            // enrichment already hangs off that.
            if (state.capabilities.contains("no-implicit-names")) {
                session.send("NAMES", channel.name)
            }
            Metadata.sync(session, channel.name)
            ChatHistory.requestLatest(session, channel.name)
        } else {
            // The server pushed everyone's metadata when *we* joined, but not
            // for people who turn up afterwards.
            Metadata.sync(session, nick)
        }
    }

    Handlers.on("PART") { session, message ->
        val state = session.state
        val name = message.param(0) ?: return@on
        val nick = message.nick ?: return@on
        val mine = state.isMe(nick)

        val channel = state.findChannel(name)
        if (mine) state.channels.remove(state.casemap(name)) else channel?.removeUser(nick)

        session.emit("irc:part", buildJsonObject {
            put("serverId", state.serverId)
            put("channel", name)
            put("nick", nick)
            put("isMe", mine)
            put("reason", message.param(1))
        })
    }

    Handlers.on("KICK") { session, message ->
        val state = session.state
        val name = message.param(0) ?: return@on
        val target = message.param(1) ?: return@on
        val mine = state.isMe(target)

        if (mine) state.channels.remove(state.casemap(name))
        else state.findChannel(name)?.removeUser(target)

        session.emit("irc:kick", buildJsonObject {
            put("serverId", state.serverId)
            put("channel", name)
            put("nick", target)
            put("by", message.nick)
            put("isMe", mine)
            put("reason", message.param(2))
        })
    }

    Handlers.on("TOPIC") { session, message ->
        val state = session.state
        val name = message.param(0) ?: return@on
        val topic = message.param(1)
        state.findChannel(name)?.let {
            it.topic = topic
            it.topicSetBy = message.nick
        }
        session.emit("irc:topic", buildJsonObject {
            put("serverId", state.serverId)
            put("channel", name)
            put("topic", topic)
            put("setBy", message.nick)
        })
    }

    // RPL_TOPIC
    Handlers.on("332") { session, message ->
        val name = message.param(1) ?: return@on
        session.state.findChannel(name)?.topic = message.param(2)
        session.emit("irc:topic", buildJsonObject {
            put("serverId", session.state.serverId)
            put("channel", name)
            put("topic", message.param(2))
        })
    }

    /**
     * RPL_NOTOPIC — this channel has no topic.
     *
     * The answer to joining a channel nobody has ever set a topic on, and to
     * asking about one whose topic has since been cleared. Without it the last
     * topic we were told about stayed in the header, so a rejoin after somebody
     * emptied it went on showing a topic that no longer existed.
     */
    Handlers.on("331") { session, message ->
        val name = message.param(1) ?: return@on
        session.state.findChannel(name)?.let {
            it.topic = null
            it.topicSetBy = null
            it.topicSetAt = null
        }
        session.emit("irc:topic", buildJsonObject {
            put("serverId", session.state.serverId)
            put("channel", name)
            put("topic", "")
        })
    }

    // RPL_TOPICWHOTIME
    Handlers.on("333") { session, message ->
        val channel = session.state.findChannel(message.param(1)) ?: return@on
        channel.topicSetBy = message.param(2)
        channel.topicSetAt = message.param(3)?.toLongOrNull()
    }

    // RPL_NAMREPLY — arrives in pieces, accumulate until 366
    Handlers.on("353") { session, message ->
        val name = message.param(2) ?: return@on
        val names = message.params.lastOrNull()?.split(" ")?.filter { it.isNotEmpty() } ?: return@on
        session.state.pendingNames.getOrPut(session.state.casemap(name)) { mutableListOf() }.addAll(names)
    }

    // RPL_ENDOFNAMES
    Handlers.on("366") { session, message ->
        val state = session.state
        val name = message.param(1) ?: return@on
        val channel = state.channel(name)
        val names = state.pendingNames.remove(state.casemap(name)) ?: emptyList<String>()

        channel.users.clear()
        for (entry in names) {
            val parsed = state.parseNamesEntry(entry)
            channel.users[state.casemap(parsed.nick)] = parsed
        }
        channel.namesReceived = true

        emitNames(session, channel)

        // WHOX fills in accounts, away state and bot flags, which NAMES cannot
        if (Isupport.advertises(state.isupport, "WHOX")) Whox.request(session, channel.name)
    }

    Handlers.on("MODE") { session, message ->
        val state = session.state
        val target = message.param(0) ?: return@on
        val channel = state.findChannel(target)

        if (channel == null) {
            // A user mode on ourselves
            session.emit("irc:mode", buildJsonObject {
                put("serverId", state.serverId)
                put("target", target)
                put("modes", message.params.drop(1).joinToString(" "))
                put("by", message.nick)
            })
            return@on
        }

        applyChannelModes(state, channel, message.params.drop(1))

        session.emit("irc:mode", buildJsonObject {
            put("serverId", state.serverId)
            put("target", channel.name)
            put("modes", message.params.drop(1).joinToString(" "))
            put("by", message.nick)
        })
        // The roster's prefixes have changed, so redraw it
        emitNames(session, channel)
    }

    // RPL_CHANNELMODEIS
    Handlers.on("324") { session, message ->
        val channel = session.state.findChannel(message.param(1)) ?: return@on
        applyChannelModes(session.state, channel, message.params.drop(2))
    }

    // ── The lists a channel keeps ────────────────────────────────
    //
    // RPL_BANLIST and its relatives. None of these were handled on either
    // client, so a client that could set a ban had no way to show one: you
    // could put somebody on a list and never find them again.
    //
    // Which numeric means which list, and how to read each shape, is in
    // [MaskLists] — 728 puts its mode letter where the others put the mask,
    // and reading one as the other lists the letter `q` as though somebody
    // had banned it.
    for (numeric in listOf("367", "368", "346", "347", "348", "349", "728", "729")) {
        Handlers.on(numeric) { session, message ->
            val reply = MaskLists.readReply(numeric, message.params) ?: return@on
            val channel = session.state.findChannel(reply.channel) ?: return@on

            if (reply.done) {
                channel.loadingLists.remove(reply.mode)
                emitMaskList(session, reply.channel, reply.mode, channel.maskLists[reply.mode].orEmpty())
                return@on
            }

            // The first line of a fresh fetch replaces what we had. A list is
            // sent whole, so appending would double it on every look.
            if (channel.loadingLists.remove(reply.mode)) {
                channel.maskLists[reply.mode] = mutableListOf()
            }

            val entries = channel.maskLists.getOrPut(reply.mode) { mutableListOf() }
            val entry = reply.entry ?: return@on
            if (entries.none { it.mask == entry.mask }) entries.add(entry)
        }
    }

    Handlers.on("INVITE") { session, message ->
        session.emit("irc:invite", buildJsonObject {
            put("serverId", session.state.serverId)
            put("channel", message.params.lastOrNull())
            put("from", message.nick)
        })
    }

    // draft/channel-rename
    Handlers.on("RENAME") { session, message ->
        val state = session.state
        val from = message.param(0) ?: return@on
        val to = message.param(1) ?: return@on

        state.channels.remove(state.casemap(from))?.let { old ->
            val renamed = ChannelState(to)
            renamed.topic = old.topic
            renamed.namesReceived = old.namesReceived
            renamed.users.putAll(old.users)
            state.channels[state.casemap(to)] = renamed
        }

        session.emit("irc:rename", buildJsonObject {
            put("serverId", state.serverId)
            put("from", from)
            put("to", to)
            put("reason", message.param(2))
        })
    }

    // draft/auto-join — the server telling us where we usually are
    Handlers.on("AUTOJOIN") { session, message ->
        val channels = message.params.lastOrNull()?.takeIf { it.isNotBlank() } ?: return@on
        session.send("JOIN", channels)
    }
}

/**
 * Apply a mode change to a channel.
 *
 * Only prefix modes (`+o`, `-v`) change the roster; list and parameter modes
 * are recorded but do not move anyone. Getting the argument accounting wrong
 * silently shifts every following mode onto the wrong nick, which is why the
 * ISUPPORT CHANMODES classes are consulted rather than guessed at.
 */
internal fun applyChannelModes(state: ConnectionState, channel: ChannelState, params: List<String>) {
    val spec = params.firstOrNull() ?: return
    val arguments = params.drop(1)
    var argument = 0
    var adding = true

    // CHANMODES=A,B,C,D — A and B always take a parameter, C only when set
    val classes = state.isupport["CHANMODES"]?.split(",") ?: listOf("beI", "k", "l", "")
    val alwaysArgument = (classes.getOrNull(0) ?: "") + (classes.getOrNull(1) ?: "")
    val argumentWhenSet = classes.getOrNull(2) ?: ""

    for (char in spec) {
        when (char) {
            '+' -> adding = true
            '-' -> adding = false
            else -> {
                val prefix = state.prefixForMode(char)
                if (prefix != null) {
                    val nick = arguments.getOrNull(argument++) ?: continue
                    channel.setUser(nick) { user ->
                        val prefixes = user.prefixes.toMutableList()
                        if (adding) {
                            if (!prefixes.contains(prefix)) prefixes.add(prefix)
                        } else {
                            prefixes.remove(prefix)
                        }
                        // Keep them in the server's order of privilege
                        user.copy(
                            prefixes = prefixes.sortedBy { state.prefixSymbols.indexOf(it.first()) }
                        )
                    }
                    continue
                }

                val takesArgument = alwaysArgument.contains(char) ||
                    (adding && argumentWhenSet.contains(char))
                val value = if (takesArgument) arguments.getOrNull(argument++) else null
                if (adding) channel.modes[char.toString()] = value
                else channel.modes.remove(char.toString())
            }
        }
    }
}
