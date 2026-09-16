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
    // A tag we are willing to store, or now — see [ServerTime]
    ServerTime.of(message.tag("time"))

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

            // CTCP: text wrapped in \u0001, and three different things wear
            // that wrapping — see [Ctcp.kind], which is where the telling apart
            // now happens for both clients.
            val ctcp = Ctcp.kind(command, text)
            val isAction = ctcp == Ctcp.Kind.ACTION

            /*
             * An answer to something we asked, in the console.
             *
             * This used to fall through to the ordinary path, because only a
             * PRIVMSG was treated as CTCP at all — so an answer was filed as a
             * notice, which opened a direct message with whoever sent it. With
             * `echo-message` the answer that came back was often our own, sent
             * to somebody who had asked *us*, so answering a stranger's CTCP
             * silently opened a conversation with that stranger holding our own
             * client's replies.
             *
             * Ours are dropped rather than shown: this client answering a
             * question is not news to the person using it. Somebody else's is
             * worth a line, or asking CTCP VERSION looks like it did nothing.
             */
            if (ctcp == Ctcp.Kind.REPLY) {
                if (state.isMe(from)) return@on

                session.emit("irc:message", buildJsonObject {
                    put("serverId", state.serverId)
                    put("channel", SERVER_CONSOLE)
                    put("message", buildJsonObject {
                        put("id", messageId(message, state.serverId))
                        put("nick", "")
                        put("content", Ctcp.answerLine(from, Ctcp.body(text)))
                        put("type", "system")
                        put("timestamp", timestampOf(message))
                    })
                })
                return@on
            }

            if (ctcp == Ctcp.Kind.REQUEST) {
                val body = Ctcp.body(text)

                // DCC is an offer rather than a question, so it gets no NOTICE
                // back — and only ever from somebody talking to us directly. A
                // DCC sent to a channel is an offer made to everyone at once,
                // which is not how anybody sends a file to a person.
                val offer = if (state.isMe(target)) Dcc.parse(body) else null
                if (offer != null) {
                    emitDccOffer(session, from, offer)
                } else if (Dcc.parse(body) == null) {
                    /*
                     * Answered whether it was asked of us or of the channel.
                     *
                     * Asking a channel is how people ask — it is the only way
                     * to find out what everyone in a room is running — and
                     * staying silent meant a survey came back with an answer
                     * from every client present except this one. Somebody on
                     * IRC reported that as Switchboard not supporting CTCP,
                     * which from where they were standing it was.
                     *
                     * The old silence was not wrong about the risk, only about
                     * the remedy: a room full of clients all answering at once
                     * is a flood. So the answer is rate limited rather than
                     * withheld, which is what every other client does.
                     */
                    answerCtcp(session, from, body)
                }
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
                    put("relayedBy", message.tag("draft/relaymsg"))
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

    /**
     * The networks a bouncer holds on our behalf.
     *
     * One connection reaches one of them, bound by `BOUNCER BIND` during
     * registration, so somebody with three networks behind a soju wants three
     * networks here. Reading the list is what makes that possible without
     * anybody having to know a network id — on soju it is a number nothing in
     * the interface has ever shown them.
     *
     * Updated in place rather than replaced, because
     * `soju.im/bouncer-networks-notify` sends changes one line at a time.
     */
    Handlers.on("BOUNCER") { session, message ->
        if (!message.param(0).equals("NETWORK", ignoreCase = true)) return@on
        val id = message.param(1) ?: return@on
        val attributes = Bouncer.attributes(message.param(2) ?: "")
        val state = session.state

        if (Bouncer.isRemoval(attributes)) {
            state.bouncerNetworks.remove(id)
        } else {
            state.bouncerNetworks[id] =
                Bouncer.networkFrom(id, attributes, state.bouncerNetworks[id])
        }

        session.emit("irc:bouncer-networks", buildJsonObject {
            put("serverId", state.serverId)
            put("boundTo", session.config.bouncerNetId?.let { JsonPrimitive(it) }
                ?: kotlinx.serialization.json.JsonNull)
            put("networks", buildJsonArray {
                for (network in state.bouncerNetworks.values) {
                    add(buildJsonObject {
                        put("id", network.id)
                        put("name", network.name)
                        put("host", network.host)
                        put("port", network.port)
                        put("tls", network.tls)
                        put("nickname", network.nickname)
                        put("state", network.state)
                    })
                }
            })
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

    /**
     * The conversation around one moment in it.
     *
     * What a jump asks for when the line it is aimed at is older than anything
     * this phone holds. `AROUND` is the one direction of `CHATHISTORY` neither
     * client had ever sent, and it is the only one that answers "show me this
     * with what was being said either side of it".
     */
    fun requestAround(session: IrcSession, target: String, timestamp: String, limit: Int = 50) {
        if (!session.state.capabilities.contains("draft/chathistory")) return
        session.send(
            "CHATHISTORY", "AROUND", target,
            "timestamp=$timestamp",
            allowed(session, limit).toString()
        )
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
 * What we say we are, when asked.
 *
 * Set once at startup from the packaged version, in the same shape the desktop
 * answers with — "Switchboard <version> (<platform>)" — so the two do not
 * describe the same client differently.
 */
private var appVersion = "0.0.0"
private var appPlatform = "unknown"

/** Tell the protocol layer what to answer CTCP VERSION with */
fun setAppVersion(version: String, platform: String) {
    appVersion = version
    appPlatform = platform
}

/**
 * How often this connection will answer.
 *
 * Per connection rather than one for the whole app: two networks are two
 * different rooms of people, and a survey on one should not use up the answer
 * owed to somebody on the other.
 */
private val ctcpGuards = java.util.WeakHashMap<IrcSession, CtcpGuard>()

@Synchronized
private fun guardFor(session: IrcSession): CtcpGuard =
    ctcpGuards.getOrPut(session) { CtcpGuard() }

/**
 * Answer a CTCP question, if we are willing to answer this one right now.
 *
 * Everything outside the list goes unanswered, which is the polite reading of
 * the convention.
 */
private fun answerCtcp(session: IrcSession, from: String, body: String) {
    val space = body.indexOf(' ')
    val verb = if (space == -1) body else body.substring(0, space)
    val args = if (space == -1) "" else body.substring(space + 1)

    val reply = Ctcp.reply(verb, args, appVersion, appPlatform, Instant.now()) ?: return
    if (from.isEmpty() || !guardFor(session).allow(from, System.currentTimeMillis())) return

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


/**
 * Somebody offered us a file.
 *
 * Recorded and shown; nothing connects until a person says so. Auto-accepting
 * a DCC is how the protocol got its reputation, and nothing here turns that on.
 *
 * Only SEND, and only forward SEND. Reverse DCC asks this phone to open a
 * listening socket, which behind mobile NAT nothing can reach — the failure
 * would be a transfer that hangs rather than one that is refused.
 */
private fun emitDccOffer(session: IrcSession, from: String, offer: Dcc.Offer) {
    if (offer.kind != "send" || Dcc.isReverse(offer)) return

    session.emit("dcc:offer", buildJsonObject {
        put("serverId", session.state.serverId)
        put("peer", from)
        put("filename", Dcc.safeFilename(offer.filename))
        put("address", offer.address)
        put("port", offer.port)
        put("size", offer.size)
    })
}
