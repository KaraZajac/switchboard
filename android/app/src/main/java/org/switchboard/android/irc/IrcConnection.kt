package org.switchboard.android.irc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLSocketFactory

/**
 * One IRC connection, on the phone.
 *
 * This is the standalone half of the client: when the desktop is gone, the
 * phone connects to the network itself rather than proxying. It emits the same
 * events the desktop emits over the link — `irc:message`, `irc:join`,
 * `irc:names` and the rest, with identical JSON — so
 * [org.switchboard.android.SwitchboardStore] and the UI above it cannot tell
 * which mode they are in. There is one rendering path, not two, and that is
 * what keeps a failover invisible.
 *
 * The protocol itself lives in [Handlers]; this class is the socket, the send
 * queue and the reconnect loop, and nothing else.
 */
class IrcConnection(
    initialConfig: ServerConfig,
    private val scope: CoroutineScope,
    private val emitEvent: (channel: String, data: JsonElement) -> Unit
) : IrcSession {

    /**
     * The settings this connection dials with.
     *
     * Not the caller's copy: an STS policy can move a server onto TLS, and that
     * has to apply to the retry this connection makes, not to whatever the
     * vault happened to say when it was built.
     */
    override var config: ServerConfig = initialConfig
        private set

    override val state = ConnectionState(config.id)

    private var socket: Socket? = null
    private var output: OutputStream? = null
    private var readJob: Job? = null
    private var writeJob: Job? = null

    /**
     * Lines waiting to go out, oldest first.
     *
     * A queue rather than a lock, so ordering is guaranteed: a multiline batch
     * must not have a NICK land in the middle of it, and that is exactly what
     * happens when each send races for a mutex.
     */
    private val outbound = Channel<String>(capacity = Channel.UNLIMITED)
    private var tokens = SEND_BURST.toDouble()
    private var lastRefill = System.currentTimeMillis()

    private var stopping = false
    private var attempt = 0

    val serverId: String get() = config.id
    val currentNick: String get() = state.nick
    val isConnected: Boolean get() = state.registered

    init {
        Handlers.installAll()
    }

    fun start() {
        stopping = false
        readJob = scope.launch(Dispatchers.IO) { runWithRetries() }
        writeJob = scope.launch(Dispatchers.IO) { drainOutbound() }
    }

    fun stop(quitMessage: String = "Switchboard") {
        stopping = true
        // Whatever is queued is for a conversation we are leaving, and holding
        // QUIT behind it would only delay a clean goodbye.
        while (outbound.tryReceive().isSuccess) { /* drop */ }
        runCatching { writeDirect(Irc.serialise("QUIT", listOf(quitMessage))) }
        closeSocket()
        readJob?.cancel()
        writeJob?.cancel()
        readJob = null
        writeJob = null
    }

    // ── IrcSession ────────────────────────────────────────────────────

    override fun send(command: String, vararg params: String) {
        sendRaw(Irc.serialise(command, params.toList()))
    }

    override fun sendRaw(line: String) {
        // Prevent injection: a newline would end the command and start another
        val sanitized = line.replace("\r", "").replace("\n", "")
        outbound.trySend(sanitized)
    }

    override fun emit(channel: String, data: JsonElement) = emitEvent(channel, data)

    /**
     * Come back over TLS, because the server says it is TLS-only.
     *
     * The settings are changed before the socket is dropped, so the retry that
     * the read loop is about to make dials the secure port. Reconnecting on the
     * old plaintext one would just have the two sides argue for ever.
     */
    override fun requireTls(port: Int): Boolean {
        if (config.tls && config.port == port) return false

        android.util.Log.i("SwitchboardIrc", "STS: ${config.host} is TLS-only; reconnecting on $port")
        config = config.copy(port = port, tls = true)
        socket?.close()
        return true
    }

    // ── connection lifecycle ──────────────────────────────────────────

    private suspend fun runWithRetries() {
        while (!stopping) {
            try {
                connectOnce()
                attempt = 0
                readLoop()
            } catch (e: Exception) {
                android.util.Log.w("SwitchboardIrc", "${config.host}:${config.port} failed", e)
                emitError(e.message ?: "Connection failed")
            }

            closeSocket()
            if (state.registered) {
                state.registered = false
                emit("irc:disconnected", buildJsonObject { put("serverId", config.id) })
            }
            if (stopping) return

            // Back off, but stay reachable: a phone that gives up is a phone
            // that silently stops being the connection.
            attempt++
            delay(minOf(60_000L, 2_000L * (1L shl minOf(attempt - 1, 5))))
        }
    }

    private suspend fun connectOnce() = withContext(Dispatchers.IO) {
        state.reset(config.nick)
        while (outbound.tryReceive().isSuccess) { /* nothing from last time */ }

        // A server that has told us it is TLS-only gets reached over TLS,
        // whatever the saved settings say. Checked on every dial, because the
        // connection a cached policy protects is the one *after* the one that
        // learned about it.
        Sts.upgradeFor(config.host, config.port, config.tls)?.let { (port, _) ->
            android.util.Log.i("SwitchboardIrc", "STS: dialling ${config.host}:$port over TLS")
            config = config.copy(port = port, tls = true)
        }

        val raw = Socket()
        raw.connect(InetSocketAddress(config.host, config.port), 15_000)
        raw.soTimeout = 0

        val connected = if (config.tls) {
            (SSLSocketFactory.getDefault() as SSLSocketFactory)
                .createSocket(raw, config.host, config.port, true)
                .also { (it as javax.net.ssl.SSLSocket).startHandshake() }
        } else {
            raw
        }

        android.util.Log.i("SwitchboardIrc", "connected to ${config.host}:${config.port}")
        socket = connected
        output = connected.getOutputStream()

        // CAP first: the server holds registration open until CAP END, which is
        // what gives SASL a chance to run before we are on the network.
        sendRaw("CAP LS 302")
        config.password?.takeIf { it.isNotEmpty() }?.let { send("PASS", it) }
        send("NICK", config.nick)
        send("USER", config.ident, "0", "*", config.gecos)
    }

    private suspend fun readLoop() = withContext(Dispatchers.IO) {
        val reader = BufferedReader(InputStreamReader(socket!!.getInputStream(), Charsets.UTF_8))
        while (!stopping) {
            val line = reader.readLine() ?: break
            if (line.isBlank()) continue

            val message = try {
                Irc.parse(line)
            } catch (e: IrcParseException) {
                // A line we cannot parse is the server's problem, not a reason
                // to drop a working connection.
                continue
            }

            // Keepalive is answered here rather than in a handler, so it cannot
            // be delayed by anything the protocol layer is doing.
            if (message.command == "PING") {
                writeDirect(Irc.serialise("PONG", message.params))
                continue
            }

            // A message inside a batch we handle ourselves is collected, not
            // acted on: replayed history must not drive live state.
            if (consumedByBatch(state, message)) continue

            Handlers.dispatch(this@IrcConnection, message)
        }
    }

    private fun closeSocket() {
        runCatching { socket?.close() }
        socket = null
        output = null
    }

    // ── sending ───────────────────────────────────────────────────────

    /**
     * Send what the bucket allows, in order.
     *
     * Every ircd has a send-queue limit and enforces it by dropping commands or
     * killing the connection. Taking over from the desktop is exactly when the
     * phone wants to say the most at once — subscribe, publish a profile, join
     * every channel, ask for history and names — so it is exactly when the
     * limit bites.
     */
    private suspend fun drainOutbound() {
        for (line in outbound) {
            if (stopping) return
            if (commandOf(line) !in ALWAYS_IMMEDIATE) awaitToken()
            withContext(Dispatchers.IO) { writeDirect(line) }
        }
    }

    /**
     * Wait for a token, taking one when it arrives.
     *
     * A token bucket rather than a fixed delay: a client that has been quiet
     * can say several things at once, which is what makes joining a few
     * channels feel instant, while a sustained stream settles to a rate servers
     * accept.
     */
    private suspend fun awaitToken() {
        while (true) {
            val now = System.currentTimeMillis()
            tokens = minOf(
                SEND_BURST.toDouble(),
                tokens + (now - lastRefill) / 1000.0 * SEND_RATE_PER_SECOND
            )
            lastRefill = now

            if (tokens >= 1.0) {
                tokens -= 1.0
                return
            }
            delay(maxOf(10L, ((1.0 - tokens) / SEND_RATE_PER_SECOND * 1000).toLong()))
        }
    }

    /** Straight to the socket, for PONG and QUIT */
    private fun writeDirect(line: String) {
        val stream = output ?: return
        runCatching {
            stream.write((line + "\r\n").toByteArray(Charsets.UTF_8))
            stream.flush()
        }
    }

    private fun emitError(reason: String) {
        emit("irc:error", buildJsonObject {
            put("serverId", config.id)
            put("message", reason)
        })
    }

    // ── what the engine above asks for ────────────────────────────────

    fun say(target: String, text: String) {
        // A line too long for the wire is refused outright — `417 :Input line
        // was too long`, nothing delivered — so every line is cut to fit before
        // anything else decides how to send it. `continued` marks the pieces
        // that were one line before we cut them.
        // `TARGMAX=PRIVMSG:1` and a message to two people comes back `407 :Too
        // many recipients`, delivered to neither — so a list goes as the
        // several commands the server will actually accept.
        val groups = Isupport.groupTargets(target, Isupport.targetMax(state.isupport, "PRIVMSG"))
        if (groups.size > 1) {
            for (group in groups) say(group, text)
            return
        }

        val budget = LineLength.budget(state.nick, state.userHost, state.isupport, "PRIVMSG", target)
        val parts = mutableListOf<Pair<String, Boolean>>()
        for (line in text.split("\n")) {
            LineLength.split(line, budget).forEachIndexed { index, piece ->
                parts.add(piece to (index > 0))
            }
        }

        if (parts.size > 1 && state.capabilities.contains("draft/multiline")) {
            val limits = Multiline.limitsFrom(state.available["draft/multiline"])
            for (batch in Multiline.split(parts.map { it.first }, limits, parts)) {
                // A batch of one is a message with no line breaks in it, and the
                // spec asks for a plain PRIVMSG rather than a batch wrapped
                // around nothing.
                if (batch.size == 1) {
                    send("PRIVMSG", target, batch[0].first)
                    continue
                }

                val reference = "ml${++multilineCounter}"
                sendRaw(Irc.serialise("BATCH", listOf("+$reference", "draft/multiline", target)))
                batch.forEachIndexed { index, (line, continued) ->
                    // The tag says "this ran on from the one before with no line
                    // break", which is what a line we had to cut did. Never on
                    // the first part: there is nothing before it to run on from.
                    val concat = if (continued && index > 0) "draft/multiline-concat;" else ""
                    sendRaw("@${concat}batch=$reference " + Irc.serialise("PRIVMSG", listOf(target, line)))
                }
                sendRaw(Irc.serialise("BATCH", listOf("-$reference")))
            }
        } else {
            for ((line, _) in parts) send("PRIVMSG", target, line)
        }

        // Without echo-message the server never tells us what we just said, so
        // the message has to appear locally or the user watches it vanish.
        if (!state.capabilities.contains("echo-message")) {
            emit("irc:message", buildJsonObject {
                put("serverId", config.id)
                put("channel", target)
                put("message", buildJsonObject {
                    put("id", "${config.id}-${System.currentTimeMillis()}-${++multilineCounter}")
                    put("nick", state.nick)
                    put("content", text)
                    put("timestamp", java.time.Instant.now().toString())
                    put("type", "privmsg")
                })
            })
        }
    }

    fun join(channel: String) = send("JOIN", channel)
    fun part(channel: String) = send("PART", channel)
    fun setTopic(channel: String, topic: String) = send("TOPIC", channel, topic)

    fun setNick(nick: String) {
        state.desiredNick = nick
        state.pendingNick = nick
        send("NICK", nick)
    }

    /** Whether this network can carry a profile at all */
    val supportsMetadata: Boolean get() = state.capabilities.contains("draft/metadata-2")

    /** Publish one of our own metadata keys */
    fun setMetadata(key: String, value: String) {
        if (!state.capabilities.contains("draft/metadata-2")) return
        if (value.isEmpty()) send("METADATA", "*", "SET", key)
        else send("METADATA", "*", "SET", key, value)
    }

    fun whois(nick: String) = send("WHOIS", nick)

    fun setAway(message: String?) {
        if (message.isNullOrBlank()) send("AWAY") else send("AWAY", message)
    }

    fun setTyping(target: String, typing: String) {
        if (!state.capabilities.contains("message-tags")) return
        sendRaw("@+typing=$typing " + Irc.serialise("TAGMSG", listOf(target)))
    }

    /** Answer one message in particular, with the reply client tag */
    fun reply(target: String, messageId: String, text: String) {
        if (!state.capabilities.contains("message-tags")) {
            say(target, text)
            return
        }
        sendRaw("@+reply=$messageId " + Irc.serialise("PRIVMSG", listOf(target, text)))
    }

    /** React to a message. TAGMSG, so it carries no text of its own. */
    /**
     * React to a message, or take the reaction back.
     *
     * The same tags the desktop sends, down to their spelling: two clients
     * emitting `+reply` and `+draft/reply` for the same thing works only for as
     * long as every server they meet is generous about both.
     */
    fun react(target: String, messageId: String, emoji: String, remove: Boolean = false) {
        if (!state.capabilities.contains("message-tags")) return
        val tag = if (remove) "+draft/unreact" else "+draft/react"
        sendRaw("@$tag=$emoji;+reply=$messageId " + Irc.serialise("TAGMSG", listOf(target)))
    }

    /** Take a message back, where the server allows it */
    fun redact(target: String, messageId: String, reason: String? = null) {
        if (!state.capabilities.contains("draft/message-redaction")) return
        if (reason != null) send("REDACT", target, messageId, reason)
        else send("REDACT", target, messageId)
    }

    fun requestHistoryBefore(target: String, timestamp: String) =
        ChatHistory.requestBefore(this, target, timestamp)

    fun requestHistoryLatest(target: String) = ChatHistory.requestLatest(this, target)

    /** Change a message already sent, with the edit client tag */
    fun edit(target: String, messageId: String, text: String) {
        if (!state.capabilities.contains("message-tags")) return
        sendRaw("@+draft/edit=$messageId " + Irc.serialise("PRIVMSG", listOf(target, text)))
    }

    fun kick(channel: String, nick: String, reason: String?) {
        if (reason.isNullOrBlank()) send("KICK", channel, nick)
        else send("KICK", channel, nick, reason)
    }

    fun invite(nick: String, channel: String) = send("INVITE", nick, channel)

    /** draft/account-registration — ask for an account */
    fun registerAccount(email: String?, password: String) {
        if (!state.capabilities.contains("draft/account-registration")) return
        send("REGISTER", "*", email ?: "*", password)
    }

    /**
     * The second half of registering: the code the server emailed.
     *
     * Without it a server that asks for verification leaves the account created
     * and unusable, which is a worse place to stop than not starting.
     */
    fun verifyAccount(account: String, code: String) {
        if (!state.capabilities.contains("draft/account-registration")) return
        send("VERIFY", account, code)
    }

    fun setMode(target: String, mode: String, vararg args: String) =
        send("MODE", target, mode, *args)

    /** Browse the network. The answer arrives as 322s, then a 323. */
    fun list(pattern: String? = null) {
        if (pattern.isNullOrBlank()) send("LIST") else send("LIST", pattern)
    }

    /** draft/read-marker — tell the network where we have read up to */
    fun markRead(target: String, timestamp: String) {
        if (!state.capabilities.contains("draft/read-marker")) return
        send("MARKREAD", target, "timestamp=$timestamp")
    }

    fun monitorAdd(nicks: List<String>) {
        if (nicks.isEmpty() || !state.isupport.containsKey("MONITOR")) return
        send("MONITOR", "+", nicks.joinToString(","))
    }

    fun monitorRemove(nicks: List<String>) {
        if (nicks.isEmpty() || !state.isupport.containsKey("MONITOR")) return
        send("MONITOR", "-", nicks.joinToString(","))
    }

    /** Whether this network can search its own history for us */
    val supportsSearch: Boolean get() = state.capabilities.contains("draft/search")

    /**
     * draft/search — ask the network what was said.
     *
     * Answers arrive as a batch, not as a reply to this line, which is why the
     * caller waits on the store rather than on a return value.
     */
    fun search(query: String, channel: String?) {
        if (!supportsSearch) return
        if (channel.isNullOrBlank()) send("SEARCH", query)
        else send("SEARCH", "in:$channel $query")
    }

    fun monitorList() {
        if (!state.isupport.containsKey("MONITOR")) return
        send("MONITOR", "L")
    }

    private var multilineCounter = 0

    companion object {
        /** RFC 1459's line limit, in bytes, including the trailing CRLF */
        const val MAX_LINE_BYTES = 512

        /** How many commands may go back to back, matching the desktop */
        const val SEND_BURST = 5

        /** Sustained rate once the burst is spent */
        const val SEND_RATE_PER_SECOND = 1.0

        /** Keepalive is answered out of band and belongs to no sequence */
        private val ALWAYS_IMMEDIATE = setOf("PING", "PONG")

        internal fun commandOf(line: String): String {
            var rest = line
            if (rest.startsWith("@")) rest = rest.substringAfter(' ').trimStart()
            if (rest.startsWith(":")) rest = rest.substringAfter(' ').trimStart()
            return rest.substringBefore(' ').uppercase()
        }

        /**
         * What we ask for, in the order the desktop asks.
         *
         * The same list as `tests/fixtures/capabilities.json`, which both test
         * suites check — a phone that negotiates different capabilities renders
         * the same channel differently from the desktop, and the seam shows up
         * exactly when one takes over from the other.
         */
        val WANTED_CAPABILITIES = listOf(
            "cap-notify",
            "message-tags",
            "batch",
            "labeled-response",
            "echo-message",
            "server-time",
            "sasl",
            "multi-prefix",
            "userhost-in-names",
            "extended-join",
            "account-notify",
            "account-tag",
            "away-notify",
            "chghost",
            "setname",
            "invite-notify",
            "standard-replies",
            "no-implicit-names",
            "monitor",
            "extended-monitor",
            "draft/message-redaction",
            "draft/message-edit",
            "draft/chathistory",
            "draft/read-marker",
            "draft/webpush",
            "draft/multiline",
            "draft/channel-rename",
            "draft/account-registration",
            "draft/metadata-2",
            "draft/event-playback",
            "draft/pre-away",
            "draft/search",
            "draft/auto-join",
            "draft/client-batch",
            "draft/oper-tag",
            "draft/extended-isupport",
            "draft/channel-context",
            "draft/react",
            "draft/unreact",
            "typing",
            "reply"
        )
    }
}

/**
 * A server, exactly as the desktop stores it.
 *
 * Field-for-field the desktop's `ServerConfig` (src/shared/types/server.ts), so
 * the vault payload deserialises here with no translation step to keep in sync.
 * Unknown fields are ignored, which lets the desktop add one without breaking
 * older phones.
 */
@Serializable
data class ServerConfig(
    val id: String,
    val name: String,
    val host: String,
    val port: Int = 6697,
    val tls: Boolean = true,
    val password: String? = null,
    val nick: String,
    val username: String = "",
    val realname: String = "",
    val saslMechanism: String? = null,
    val saslUsername: String? = null,
    val saslPassword: String? = null,
    val autoConnect: Boolean = true,
    val autoJoin: List<String> = emptyList(),
    val identifyCommand: String? = null,
    val sortOrder: Int = 0,
    val websocketUrl: String? = null,
    val avatarUrl: String? = null,
    val profile: Map<String, String> = emptyMap(),
    val preAwayMessage: String? = null
) {
    /** Falls back to the nick, the way every client does */
    val ident: String get() = username.ifBlank { nick }
    val gecos: String get() = realname.ifBlank { nick }
}
