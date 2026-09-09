package org.switchboard.android.irc

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * People: their nicks, names, accounts, hosts and whether they are here.
 *
 * These arrive as notifications rather than replies, and each one is a
 * capability the client asked for — away-notify, account-notify, chghost,
 * setname. Without them a roster is correct only at the moment it was built.
 */
internal fun registerUserHandlers() {

    Handlers.on("NICK") { session, message ->
        val state = session.state
        val from = message.nick ?: return@on
        val to = message.param(0) ?: return@on

        // Ours if the prefix says so, or if it is the change we asked for and
        // the server described it with the new nick instead of the old.
        val mine = state.isMe(from) || state.pendingNick.equals(to, ignoreCase = true)
        if (mine) {
            state.nick = to
            state.pendingNick = null
        }
        for (channel in state.channels.values) channel.renameUser(from, to)

        session.emit("irc:nick", buildJsonObject {
            put("serverId", state.serverId)
            put("oldNick", from)
            put("newNick", to)
            put("isMe", mine)
        })
    }

    Handlers.on("QUIT") { session, message ->
        val state = session.state
        val nick = message.nick ?: return@on
        for (channel in state.channels.values) channel.removeUser(nick)

        session.emit("irc:quit", buildJsonObject {
            put("serverId", state.serverId)
            put("nick", nick)
            put("reason", message.param(0))
        })
    }

    /** away-notify: AWAY :<message> to go away, bare AWAY to come back */
    Handlers.on("AWAY") { session, message ->
        val state = session.state
        val nick = message.nick ?: return@on
        val reason = message.param(0)
        val away = reason != null

        for (channel in state.channels.values) {
            if (channel.user(nick) != null) channel.setUser(nick) { it.copy(away = away) }
        }
        if (state.isMe(nick)) state.away = away

        session.emit("irc:away", buildJsonObject {
            put("serverId", state.serverId)
            put("nick", nick)
            put("away", away)
            put("message", reason)
        })
    }

    /** account-notify: ACCOUNT <account> or ACCOUNT * when logged out */
    Handlers.on("ACCOUNT") { session, message ->
        val state = session.state
        val nick = message.nick ?: return@on
        val account = message.param(0)?.takeIf { it != "*" }

        for (channel in state.channels.values) {
            if (channel.user(nick) != null) channel.setUser(nick) { it.copy(account = account) }
        }
        if (state.isMe(nick)) state.account = account

        session.emit("irc:account", buildJsonObject {
            put("serverId", state.serverId)
            put("nick", nick)
            put("account", account)
        })
    }

    /** chghost: someone's user@host changed without them reconnecting */
    Handlers.on("CHGHOST") { session, message ->
        val state = session.state
        val nick = message.nick ?: return@on
        val user = message.param(0) ?: return@on
        val host = message.param(1) ?: return@on

        for (channel in state.channels.values) {
            if (channel.user(nick) != null) {
                channel.setUser(nick) { it.copy(user = user, host = host) }
            }
        }
    }

    /** setname: a new realname, live */
    Handlers.on("SETNAME") { session, message ->
        val state = session.state
        val nick = message.nick ?: return@on
        val realname = message.param(0) ?: return@on

        for (channel in state.channels.values) {
            if (channel.user(nick) != null) channel.setUser(nick) { it.copy(realname = realname) }
        }

        session.emit("irc:setname", buildJsonObject {
            put("serverId", state.serverId)
            put("nick", nick)
            put("realname", realname)
        })
    }

    // ── WHOIS ────────────────────────────────────────────────────────

    // RPL_WHOISUSER
    Handlers.on("311") { session, message ->
        session.emit("irc:whois", buildJsonObject {
            put("serverId", session.state.serverId)
            put("nick", message.param(1))
            put("user", message.param(2))
            put("host", message.param(3))
            put("realname", message.param(5))
        })
    }

    // RPL_WHOISCHANNELS / RPL_WHOISSERVER / RPL_WHOISIDLE / RPL_WHOISACCOUNT
    Handlers.on("319") { session, message -> whoisDetail(session, message, "channels", 2) }
    Handlers.on("312") { session, message -> whoisDetail(session, message, "server", 2) }
    Handlers.on("317") { session, message -> whoisDetail(session, message, "idle", 2) }
    Handlers.on("330") { session, message -> whoisDetail(session, message, "account", 2) }
    Handlers.on("313") { session, message -> whoisDetail(session, message, "operator", 2) }
    Handlers.on("335") { session, message -> whoisDetail(session, message, "bot", 2) }

    // RPL_AWAY — the person you messaged is away
    Handlers.on("301") { session, message ->
        session.emit("irc:away", buildJsonObject {
            put("serverId", session.state.serverId)
            put("nick", message.param(1))
            put("away", true)
            put("message", message.param(2))
        })
    }

    // RPL_UNAWAY / RPL_NOWAWAY — our own away state
    Handlers.on("305") { session, _ -> session.state.away = false }
    Handlers.on("306") { session, _ -> session.state.away = true }

    // RPL_ENDOFWHOIS
    Handlers.on("318") { session, message ->
        session.emit("irc:whois-end", buildJsonObject {
            put("serverId", session.state.serverId)
            put("nick", message.param(1))
        })
    }
}

private fun whoisDetail(session: IrcSession, message: IrcMessage, field: String, from: Int) {
    session.emit("irc:whois-detail", buildJsonObject {
        put("serverId", session.state.serverId)
        put("nick", message.param(1))
        put("field", field)
        put("value", message.params.drop(from).joinToString(" "))
    })
}

/**
 * MONITOR — being told when someone arrives or leaves the network.
 *
 * Cheaper than polling ISON, and the only way to know about someone you do not
 * share a channel with.
 */
internal fun registerMonitorHandlers() {

    // RPL_MONONLINE / RPL_MONOFFLINE
    Handlers.on("730") { session, message -> monitorStatus(session, message, online = true) }
    Handlers.on("731") { session, message -> monitorStatus(session, message, online = false) }

    // RPL_MONLIST / RPL_ENDOFMONLIST / ERR_MONLISTFULL
    Handlers.on("732") { session, message ->
        session.emit("irc:monitor-list", buildJsonObject {
            put("serverId", session.state.serverId)
            put("targets", message.params.lastOrNull())
        })
    }
    // RPL_ENDOFMONLIST
    Handlers.on("733") { _, _ -> }

    Handlers.on("734") { session, message ->
        session.emit("irc:error", buildJsonObject {
            put("serverId", session.state.serverId)
            put("message", "Monitor list is full: ${message.params.lastOrNull()}")
        })
    }
}

private fun monitorStatus(session: IrcSession, message: IrcMessage, online: Boolean) {
    val targets = message.params.lastOrNull()?.split(",")?.filter { it.isNotBlank() } ?: return
    for (target in targets) {
        session.emit("irc:monitor", buildJsonObject {
            put("serverId", session.state.serverId)
            // The reply carries nick!user@host; the nick is what a caller asked about
            put("nick", target.substringBefore('!').trim())
            put("online", online)
        })
    }
}
