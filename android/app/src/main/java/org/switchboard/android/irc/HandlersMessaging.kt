package org.switchboard.android.irc

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import org.switchboard.android.SERVER_CONSOLE

/**
 * What people say, and the tags they hang on it.
 *
 * PRIVMSG and NOTICE are the easy part. The rest — typing, reactions, replies,
 * edits, redaction — all ride on message tags, so they arrive as ordinary
 * messages that happen to carry more than text.
 */

private val counter = AtomicLong(0)

internal fun messageId(message: IrcMessage, serverId: String): String =
    message.tag("msgid") ?: "$serverId-${Instant.now().toEpochMilli()}-${counter.incrementAndGet()}"

internal fun timestampOf(message: IrcMessage): String =
    message.tag("time") ?: Instant.now().toString()

internal fun registerMessagingHandlers() {

    for (command in listOf("PRIVMSG", "NOTICE")) {
        Handlers.on(command) { session, message ->
            val state = session.state
            val target = message.param(0) ?: return@on
            val text = message.param(1) ?: return@on
            val from = message.nick ?: message.prefix ?: return@on

            // A private message belongs in a conversation named for the other
            // person, not for our own nick — and a server's notice belongs in
            // the console rather than in a conversation named after the server.
            // Rizon sends its connection banner from irc.rizon.life, which used
            // to sit in Direct Messages between two real people.
            // `@#chan` is still #chan: ops and bots address half a room at a
            // time, and the prefix used to open a second conversation beside
            // the real one.
            val addressed = Isupport.statusTarget(target, state.isupport["STATUSMSG"]).target
            val conversation = when {
                !state.isMe(target) -> addressed
                Irc.isServerSource(message.prefix) -> SERVER_CONSOLE
                else -> from
            }

            // CTCP: text wrapped in \u0001. ACTION is the one people see —
            // it is `/me` — and every other one is a question asked of the
            // client rather than of the person, so it is answered and not
            // shown. A client that displays them shows its user a line of
            // control characters and answers nothing.
            val ctcp = command == "PRIVMSG" &&
                text.length >= 2 && text.startsWith("\u0001") && text.endsWith("\u0001")
            val isAction = ctcp && text.startsWith("\u0001ACTION ")

            if (ctcp && !isAction) {
                answerCtcp(session, from, text.substring(1, text.length - 1))
                return@on
            }

            val content = if (isAction) text.substring(8, text.length - 1) else text

            // draft/message-edit: this replaces something already said rather
            // than adding to it. Same event the desktop sends, so the store
            // needs one handler rather than one per mode.
            val edits = message.tag("+draft/edit") ?: message.tag("edit")
            if (edits != null) {
                session.emit("irc:edit", buildJsonObject {
                    put("serverId", state.serverId)
                    put("channel", conversation)
                    put("originalId", edits)
                    put("newContent", text)
                    put("editedAt", timestampOf(message))
                })
                return@on
            }

            session.emit("irc:message", buildJsonObject {
                put("serverId", state.serverId)
                put("channel", conversation)
                put("message", buildJsonObject {
                    put("id", messageId(message, state.serverId))
                    put("nick", from)
                    put("content", content)
                    put("timestamp", timestampOf(message))
                    put(
                        "type",
                        when {
                            command == "NOTICE" -> "notice"
                            isAction -> "action"
                            else -> "privmsg"
                        }
                    )
                    put("account", message.tag("account"))
                    // draft/oper-tag: the server naming the sender as one of
                    // its operators, which is not something a nick can claim
                    put("oper", message.tag("draft/oper"))
                    // draft/message-edit and the reply client tag
                    put("replyTo", message.tag("+draft/reply") ?: message.tag("+reply"))
                })
            })
        }
    }

    /**
     * TAGMSG — a message that is only tags.
     *
     * Typing indicators and reactions travel this way, so a client that ignores
     * TAGMSG loses both while seeing nothing wrong.
     */
    Handlers.on("TAGMSG") { session, message ->
        val state = session.state
        val target = message.param(0) ?: return@on
        val from = message.nick ?: return@on
        val conversation = if (state.isMe(target)) from else target

        message.tag("+typing")?.let { typing ->
            session.emit("irc:typing", buildJsonObject {
                put("serverId", state.serverId)
                put("channel", conversation)
                put("nick", from)
                put("state", typing)
            })
        }

        val react = message.tag("+draft/react") ?: message.tag("+react")
        val unreact = message.tag("+draft/unreact") ?: message.tag("+unreact")
        val reactTo = message.tag("+draft/reply") ?: message.tag("+reply")
        val emoji = react ?: unreact
        if (emoji != null && reactTo != null) {
            session.emit("irc:react", buildJsonObject {
                put("serverId", state.serverId)
                put("channel", conversation)
                put("nick", from)
                put("msgid", reactTo)
                put("emoji", emoji)
                put("removed", react == null)
            })
        }
    }

    /** draft/message-redaction — a message being taken back */
    Handlers.on("REDACT") { session, message ->
        session.emit("irc:redact", buildJsonObject {
            put("serverId", session.state.serverId)
            put("channel", message.param(0))
            put("msgid", message.param(1))
            put("reason", message.param(2))
            put("by", message.nick)
        })
    }

    /** draft/read-marker — where we had read up to, on another device */
    Handlers.on("MARKREAD") { session, message ->
        val timestamp = message.param(1)?.removePrefix("timestamp=")?.takeIf { it != "*" }
        session.emit("irc:read-marker", buildJsonObject {
            put("serverId", session.state.serverId)
            put("channel", message.param(0))
            put("timestamp", timestamp)
        })
    }
}

/**
 * Asking for what was said before we arrived.
 *
 * Only meaningful once the phone is the connection; while it is following the
 * desktop, the desktop is the one with the database.
 */
internal object ChatHistory {

    /**
     * The page size the server will honour.
     *
     * `CHATHISTORY=200` is the most it returns in one go. Asking for more is
     * not an error and not more history — it is the server quietly doing
     * something else with the request, so the page the caller believes in and
     * the one it gets stop matching.
     */
    private fun allowed(session: IrcSession, wanted: Int): Int =
        Isupport.number(session.state.isupport, "CHATHISTORY")?.let { minOf(wanted, it) } ?: wanted

    fun requestLatest(session: IrcSession, target: String, limit: Int = 50) {
        if (!session.state.capabilities.contains("draft/chathistory")) return
        session.send("CHATHISTORY", "LATEST", target, "*", allowed(session, limit).toString())
    }

    fun requestBefore(session: IrcSession, target: String, timestamp: String, limit: Int = 50) {
        if (!session.state.capabilities.contains("draft/chathistory")) return
        session.send(
            "CHATHISTORY", "BEFORE", target, "timestamp=$timestamp",
            allowed(session, limit).toString()
        )
    }

    /**
     * Which conversations had traffic while this device was closed.
     *
     * Channels look after themselves: rejoining one asks for its history. A DM
     * does not — nothing is joined, so a message from somebody this phone has
     * never spoken to leaves no trace at all for a client that was not
     * connected to watch it arrive. This is the only way to find it.
     */
    fun requestTargets(session: IrcSession, since: String, limit: Int = 50) {
        if (!session.state.capabilities.contains("draft/chathistory")) return
        session.send(
            "CHATHISTORY", "TARGETS",
            "timestamp=$since",
            "timestamp=" + Instant.now().toString(),
            allowed(session, limit).toString()
        )
    }
}

/**
 * WHOX — a WHO that says which fields it wants.
 *
 * The token comes back in the reply so a client can tell its own query from
 * one a script issued. It has to be numeric and short: some servers parse it as
 * an integer and answer with 0, which fails every check below.
 */
internal object Whox {

    const val TOKEN = "742"
    private const val FIELDS = "%tcuhsnfar"

    fun request(session: IrcSession, target: String) {
        if (Isupport.advertises(session.state.isupport, "WHOX")) {
            session.send("WHO", target, "$FIELDS,$TOKEN")
        } else {
            session.send("WHO", target)
        }
    }

    fun registerHandlers() {
        // RPL_WHOSPCRPL — fields in the order requested above
        Handlers.on("354") { session, message ->
            val params = message.params
            if (params.size < 10 || params[1] != TOKEN) return@on

            val channel = session.state.findChannel(params[2]) ?: return@on
            val flags = params[7]
            val account = params[8].takeIf { it != "0" }

            channel.setUser(params[6]) {
                it.copy(
                    nick = params[6],
                    user = params[3],
                    host = params[4],
                    account = account,
                    realname = params.getOrNull(9),
                    away = flags.startsWith("G"),
                    isBot = flags.contains("B"),
                    prefixes = flags.drop(1)
                        .filter { symbol -> session.state.prefixSymbols.contains(symbol) }
                        .map { symbol -> symbol.toString() }
                        .ifEmpty { it.prefixes }
                )
            }
        }

        // RPL_WHOREPLY — the plain form, for servers without WHOX
        Handlers.on("352") { session, message ->
            val channel = session.state.findChannel(message.param(1)) ?: return@on
            val nick = message.param(5) ?: return@on
            val flags = message.param(6).orEmpty()

            channel.setUser(nick) {
                it.copy(
                    nick = nick,
                    user = message.param(2),
                    host = message.param(3),
                    away = flags.startsWith("G"),
                    isBot = flags.contains("B")
                )
            }
        }

        // RPL_ENDOFWHO
        Handlers.on("315") { session, message ->
            val channel = session.state.findChannel(message.param(1)) ?: return@on

            // A safety net for servers whose WHOX reply we could not use: fall
            // back to NAMES so the roster is never empty. 366 sets
            // namesReceived, so this cannot loop.
            if (!channel.namesReceived && channel.users.size <= 1) {
                session.send("NAMES", channel.name)
                return@on
            }
            emitNames(session, channel)
        }
    }
}

/**
 * Answer a CTCP question.
 *
 * Same four the desktop answers, with the same wording, so a person who
 * CTCP-VERSIONs someone running Switchboard gets the same reply whichever
 * device they happen to be holding. Everything else goes unanswered, which is
 * the polite reading of the convention and also stops a channel-wide CTCP from
 * turning into a flood of replies from us.
 */
private fun answerCtcp(session: IrcSession, from: String, body: String) {
    val space = body.indexOf(' ')
    val verb = (if (space == -1) body else body.substring(0, space)).uppercase()
    val args = if (space == -1) "" else body.substring(space + 1)

    val reply = when (verb) {
        "VERSION" -> "VERSION Switchboard for Android"
        "TIME" -> "TIME " + Instant.now().toString()
        "PING" -> "PING $args"
        "SOURCE" -> "SOURCE https://github.com/KaraZajac/switchboard"
        else -> return
    }
    session.sendRaw("NOTICE $from :\u0001$reply\u0001")
}

/**
 * The reply to `CHATHISTORY TARGETS`.
 *
 * `CHATHISTORY TARGETS <target> <timestamp>`, inside a batch, one line for each
 * conversation that had traffic in the window asked about.
 */
internal fun registerChatHistoryTargetHandler() {
    Handlers.on("CHATHISTORY") { session, message ->
        if (!message.param(0).equals("TARGETS", ignoreCase = true)) return@on
        val target = message.param(1) ?: return@on
        val timestamp = message.param(2) ?: return@on

        session.emit("irc:chathistory-target", buildJsonObject {
            put("serverId", session.state.serverId)
            put("target", target)
            put("timestamp", timestamp)
        })
    }
}
