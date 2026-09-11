package org.switchboard.android.irc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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
    /**
     * Read, not copied: the profile you carry everywhere can be edited while
     * this connection is up, and the copy taken when it was dialled would be
     * the old one.
     */
    private val globalProfileOf: () -> Map<String, String> = { emptyMap() },
    /**
     * The proxy to dial through, read rather than copied: it is changed while
     * connections are up, and it applies from the next dial onward.
     */
    private val proxyOf: () -> Socks.Settings? = { null },
    private val emitEvent: (channel: String, data: JsonElement) -> Unit
) : IrcSession, IrcCommandTarget {

    override val globalProfile: Map<String, String> get() = globalProfileOf()

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
    private var pingJob: Job? = null

    /** When the server last said anything at all */
    @Volatile
    private var lastHeard = 0L

    /**
     * Lines waiting to go out, oldest first.
     *
     * A queue rather than a lock, so ordering is guaranteed: a multiline batch
     * must not have a NICK land in the middle of it, and that is exactly what
     * happens when each send races for a mutex.
     */
    private val outbound = Channel<String>(capacity = Channel.UNLIMITED)
    private val bucket = TokenBucket(SEND_BURST, SEND_RATE_PER_SECOND)

    private var stopping = false
    private var attempt = 0

    /**
     * Woken when the phone gets a network back.
     *
     * The backoff between attempts is there for a server that is down, and it
     * is right to grow: hammering one helps nobody. It is wrong for the other
     * reason a connection fails, which on a phone is most of them — the
     * network went away and has come back. Waiting out a minute of backoff
     * that the operating system could have ended the moment the radio
     * reattached is a minute of staring at CONNECTING for no reason.
     */
    private val retryNow = Channel<Unit>(capacity = Channel.CONFLATED)

    val serverId: String get() = config.id
    val currentNick: String get() = state.nick
    val isConnected: Boolean get() = state.registered

    /**
     * When the next attempt is due, or 0 while one is actually in flight.
     *
     * A client waiting out a backoff is not connecting, and telling somebody it
     * is leaves them watching a spinner that will not move for a minute.
     */
    @Volatile
    var waitingUntil: Long = 0L
        private set

    init {
        Handlers.installAll()
    }

    fun start() {
        stopping = false
        readJob = scope.launch(Dispatchers.IO) { runWithRetries() }
        writeJob = scope.launch(Dispatchers.IO) { drainOutbound() }
    }

    override fun stop(quitMessage: String) {
        stopping = true
        // Whatever is queued is for a conversation we are leaving, and holding
        // QUIT behind it would only delay a clean goodbye.
        while (outbound.tryReceive().isSuccess) { /* drop */ }
        runCatching { writeDirect(Irc.serialise("QUIT", listOf(quitMessage))) }
        closeSocket()
        readJob?.cancel()
        writeJob?.cancel()
        pingJob?.cancel()
        readJob = null
        writeJob = null
        pingJob = null
    }

    // ── IrcSession ────────────────────────────────────────────────────

    override fun send(command: String, vararg params: String) {
        sendRaw(Irc.serialise(command, params.toList()))
    }

    override fun sendRaw(line: String) {
        outbound.trySend(line)
    }

    /**
     * The phone has a network again: try now rather than when the timer says.
     *
     * Only nudges a connection that is already waiting to retry. One that is
     * up stays up — the keepalive is what decides whether it is really there.
     */
    fun networkAvailable() {
        if (stopping) return
        attempt = 0
        retryNow.trySend(Unit)
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
                // Deliberately not resetting `attempt` here. A socket that
                // opens is not a server that let us in: a connect throttle, a
                // full server, a ban and a TLS-only port all accept the
                // connection and then close it. Resetting here pinned the
                // counter at its first value and dialled every two seconds for
                // ever. [HandlersRegistration] resets it on 001.
                pingJob = scope.launch(Dispatchers.IO) { keepalive() }
                readLoop()
            } catch (e: Exception) {
                android.util.Log.w("SwitchboardIrc", "${config.host}:${config.port} failed", e)
                emitError(e.message ?: "Connection failed")
            }

            pingJob?.cancel()
            pingJob = null
            closeSocket()
            if (state.registered) {
                state.registered = false
                emit("irc:disconnected", buildJsonObject { put("serverId", config.id) })
            }
            if (stopping) return

            // Back off, but stay reachable: a phone that gives up is a phone
            // that silently stops being the connection. Cut short the moment
            // the network comes back.
            attempt++
            val backoff = Reconnect.delay(attempt, state.closingMessage)
            // Deliberately idle, which is not the same as dialling. Saying
            // "Connecting" through a minute of waiting is how a client that is
            // behaving correctly looks broken.
            waitingUntil = System.currentTimeMillis() + backoff
            if (backoff >= Reconnect.THROTTLED_FLOOR_MS) {
                android.util.Log.i(
                    "SwitchboardIrc",
                    "${config.host}: waiting ${backoff / 1000}s — ${state.closingMessage}"
                )
            }

            // Say so, or nothing recomputes and the screen goes on claiming to
            // be connecting for the whole wait. A failed attempt that never
            // registered emits nothing at all — `irc:disconnected` only fires
            // for a connection that had got in — so without this the last
            // thing the UI heard was the dial starting.
            emit("irc:waiting", buildJsonObject {
                put("serverId", config.id)
                put("ms", backoff)
            })

            withTimeoutOrNull(backoff) { retryNow.receive() }

            waitingUntil = 0L
            emit("irc:waiting", buildJsonObject {
                put("serverId", config.id)
                put("ms", 0L)
            })
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

        // Through a proxy, when one is configured. The TCP connection goes to
        // the proxy and the proxy is asked for the server, so TLS — if any — is
        // negotiated afterwards over the tunnel, against the real host's name.
        val proxy = proxyOf()
        val raw = Socket()
        if (Socks.inUse(proxy)) {
            raw.connect(InetSocketAddress(proxy!!.host.trim(), proxy.port), 15_000)
            raw.soTimeout = 30_000
            openTunnel(raw, proxy)
        } else {
            raw.connect(InetSocketAddress(config.host, config.port), 15_000)
        }
        raw.soTimeout = 0

        val connected = if (config.tls) {
            // A client certificate, where one is set up. SASL EXTERNAL has
            // nothing to authenticate with unless the handshake presents it,
            // which is why choosing that mechanism used to end in 904.
            val factory = CertFp.socketFactory(config.clientCert)
                ?: SSLSocketFactory.getDefault() as SSLSocketFactory

            factory.createSocket(raw, config.host, config.port, true)
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

    /**
     * Talk the proxy into connecting us to the server.
     *
     * Blocking and exact: every reply is read to its own length and no
     * further, so nothing of the server's own greeting is swallowed. The bytes
     * themselves come from [Socks], which both clients share — see
     * `src/shared/socks.ts`.
     */
    private fun openTunnel(raw: Socket, proxy: Socks.Settings) {
        val out = raw.getOutputStream()
        val input = raw.getInputStream()

        fun exactly(count: Int): ByteArray {
            val bytes = ByteArray(count)
            var got = 0
            while (got < count) {
                val read = input.read(bytes, got, count - got)
                if (read <= 0) throw java.io.IOException("The proxy closed the connection")
                got += read
            }
            return bytes
        }

        if (proxy.type == "socks4") {
            out.write(Socks.connect4(config.host, config.port, proxy.username))
            out.flush()
            val reply = Socks.readReply4(exactly(8))
            if (reply.ok != true) throw java.io.IOException(reply.error ?: "The proxy refused the connection")
            return
        }

        out.write(Socks.greeting(proxy.username.isNotEmpty()))
        out.flush()

        when (Socks.readChoice(exactly(2))) {
            Socks.AUTH_NONE -> Unit
            Socks.AUTH_USERPASS -> {
                if (proxy.username.isEmpty()) {
                    throw java.io.IOException("The proxy wants a username and password, and none is saved for it")
                }
                out.write(Socks.authRequest(proxy.username, proxy.password))
                out.flush()
                if (Socks.readAuthReply(exactly(2)) != true) {
                    throw java.io.IOException("The proxy refused the username and password")
                }
            }
            else -> throw java.io.IOException("The proxy would not accept how we offered to authenticate")
        }

        out.write(Socks.connect5(config.host, config.port))
        out.flush()

        // Four bytes, then an address whose length depends on its type, then
        // the port. Read in that order so the byte after it — already the IRC
        // server talking — is left for the read loop.
        val head = exactly(4)
        val addressLength = when (head[3].toInt() and 0xff) {
            0x01 -> 4
            0x04 -> 16
            0x03 -> (exactly(1)[0].toInt() and 0xff)
            else -> throw java.io.IOException("The proxy answered with an address we cannot read")
        }
        val tail = exactly(addressLength + 2)

        val whole = if ((head[3].toInt() and 0xff) == 0x03) {
            head + byteArrayOf(addressLength.toByte()) + tail
        } else {
            head + tail
        }
        val reply = Socks.readReply5(whole)
        if (reply.ok != true) throw java.io.IOException(reply.error ?: "The proxy refused the connection")
    }

    private suspend fun readLoop() = withContext(Dispatchers.IO) {
        val input = socket!!.getInputStream()
        val chunk = ByteArray(8192)
        val lines = LineBuffer()

        while (!stopping) {
            val read = input.read(chunk)
            if (read <= 0) break
            lastHeard = System.currentTimeMillis()

            for (line in lines.feed(chunk, read)) {
                handle(line)
                // Registered is what a successful connection means, so it is
                // what starts the ladder over. Anything short of it — a
                // throttle, a ban, a full server — closed a socket that opened.
                if (attempt != 0 && state.registered) attempt = 0
            }
        }
    }

    /** One line, once it has been decoded */
    private fun handle(line: String) {
        val message = try {
            Irc.parse(line)
        } catch (e: IrcParseException) {
            // A line we cannot parse is the server's problem, not a reason to
            // drop a working connection.
            return
        }

        // Keepalive is answered here rather than in a handler, so it cannot be
        // delayed by anything the protocol layer is doing.
        if (message.command == "PING") {
            writeDirect(Irc.serialise("PONG", message.params))
            return
        }

        // A message inside a batch we handle ourselves is collected, not acted
        // on: replayed history must not drive live state.
        if (consumedByBatch(state, message)) return

        Handlers.dispatch(this@IrcConnection, message)
    }

    /**
     * Notice when the connection has stopped existing.
     *
     * A phone loses the network by walking into a lift, not by being told. No
     * FIN arrives, nothing fails, and a blocking read on a socket with no
     * timeout waits for a line that is never coming — so the client went on
     * saying LIVE, with a member list and a topic, for as long as you cared to
     * leave it. Three minutes into a test with the radio off it was still
     * claiming to be connected.
     *
     * So: say something every minute, and if nothing at all has come back
     * within [PING_TIMEOUT_MS] of that, close the socket. Closing it is what
     * unblocks the read, which is what starts the reconnect. The same numbers
     * the desktop has always used.
     */
    private suspend fun keepalive() {
        lastHeard = System.currentTimeMillis()
        while (!stopping) {
            delay(PING_INTERVAL_MS)
            if (stopping || socket == null) return

            val silent = System.currentTimeMillis() - lastHeard
            if (silent > PING_INTERVAL_MS + PING_TIMEOUT_MS) {
                android.util.Log.i(
                    "SwitchboardIrc",
                    "${config.host}: nothing heard for ${silent}ms, reconnecting"
                )
                emitError("Connection timed out")
                closeSocket()
                return
            }

            // Straight out rather than through the queue: a keepalive that
            // waits behind a backlog is not measuring the connection.
            writeDirect(Irc.serialise("PING", listOf(System.currentTimeMillis().toString())))
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
            val wait = bucket.take()
            if (wait == 0L) return
            delay(wait)
        }
    }

    /**
     * Straight to the socket, for PONG and QUIT.
     *
     * The one place every byte we send passes through, and so the place the
     * newlines come out. A newline inside a command ends it and starts
     * another, which turns anything built from typed text into a way to send
     * commands nobody typed — and the composer here treats Enter as a line
     * break, so typing one is the easy thing to do rather than the hard one.
     *
     * This lived a layer up, on the queue, and `/quit <message>` did not go
     * through the queue: a QUIT is written immediately so that leaving is not
     * held up behind whatever else was waiting.
     */
    private fun writeDirect(line: String) {
        val stream = output ?: return
        val safe = Irc.oneLine(line)
        runCatching {
            stream.write((safe + "\r\n").toByteArray(Charsets.UTF_8))
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

    override fun say(target: String, text: String) {
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
        if (!state.capabilities.contains("echo-message")) echoLocally(target, text, "privmsg")
    }

    /** Put our own message on screen, for a server that will not send it back */
    private fun echoLocally(target: String, text: String, type: String) {
        emit("irc:message", buildJsonObject {
            put("serverId", config.id)
            put("channel", target)
            put("message", buildJsonObject {
                put("id", "${config.id}-${System.currentTimeMillis()}-${++multilineCounter}")
                put("nick", state.nick)
                put("content", text)
                put("timestamp", java.time.Instant.now().toString())
                put("type", type)
            })
        })
    }

    override fun join(channel: String, key: String?) =
        if (key.isNullOrBlank()) send("JOIN", channel) else send("JOIN", channel, key)

    override fun part(channel: String, reason: String?) =
        if (reason.isNullOrBlank()) send("PART", channel) else send("PART", channel, reason)

    override fun setTopic(channel: String, topic: String) = send("TOPIC", channel, topic)

    /**
     * A CTCP ACTION — what `/me` sends.
     *
     * The wrapper costs bytes too, so it comes out of the budget before the
     * text is cut: an action long enough to be refused is refused as completely
     * as anything else.
     */
    override fun action(target: String, text: String) {
        val wrapper = "\u0001ACTION \u0001".length
        val budget =
            LineLength.budget(state.nick, state.userHost, state.isupport, "PRIVMSG", target) - wrapper

        for (piece in LineLength.split(text, budget)) {
            send("PRIVMSG", target, "\u0001ACTION $piece\u0001")
        }

        if (!state.capabilities.contains("echo-message")) echoLocally(target, text, "action")
    }

    /** A notice, which by convention is not answered automatically */
    override fun notice(target: String, text: String) {
        val budget =
            LineLength.budget(state.nick, state.userHost, state.isupport, "NOTICE", target)
        for (piece in LineLength.split(text, budget)) send("NOTICE", target, piece)

        if (!state.capabilities.contains("echo-message")) echoLocally(target, text, "notice")
    }

    override fun setNick(nick: String) {
        state.desiredNick = nick
        state.pendingNick = nick
        send("NICK", nick)
    }

    /** Whether this network can carry a profile at all */
    val supportsMetadata: Boolean get() = Metadata.supported(this)

    /** Publish one of our own metadata keys */
    fun setMetadata(key: String, value: String) {
        if (!Metadata.supported(this)) return
        if (value.isEmpty()) send("METADATA", "*", "SET", key)
        else send("METADATA", "*", "SET", key, value)
    }

    /**
     * Say again who you are.
     *
     * For when the profile behind this connection changed while it was up —
     * the one you carry everywhere, or this network's own. Publishes what is
     * now true and clears what is not, and shows it to this device either way,
     * because a server without metadata will never echo it back.
     */
    fun refreshProfile() = Metadata.publishProfile(this)

    /** Take this network's own profile as it now stands in the config */
    fun applyProfile(profile: Map<String, String>) {
        config = config.copy(profile = profile)
    }

    override fun whois(nick: String) = send("WHOIS", nick)

    override fun setAway(message: String?) {
        if (message.isNullOrBlank()) send("AWAY") else send("AWAY", message)
    }

    fun setTyping(target: String, typing: String) {
        if (!state.capabilities.contains("message-tags")) return
        // Nothing to say if the network drops it: a TAGMSG with its only tag
        // stripped is a line that means nothing to everyone who receives it.
        val tag = ClientTags.toUse(state.isupport["CLIENTTAGDENY"], ClientTags.TYPING) ?: return
        sendRaw("@+$tag=$typing " + Irc.serialise("TAGMSG", listOf(target)))
    }

    /**
     * Answer one message in particular, with the reply client tag.
     *
     * Whichever spelling this network carries. FurNet allows `draft/reply` and
     * denies `reply`, which was the one we always sent — so the reply arrived
     * as an ordinary line, attached to nothing. A network that carries neither
     * still gets the message; it is the threading that is lost, not the words.
     */
    fun reply(target: String, messageId: String, text: String) {
        val tag = if (state.capabilities.contains("message-tags")) {
            ClientTags.toUse(state.isupport["CLIENTTAGDENY"], ClientTags.REPLY)
        } else {
            null
        }
        if (tag == null) {
            say(target, text)
            return
        }
        sendRaw("@+$tag=$messageId " + Irc.serialise("PRIVMSG", listOf(target, text)))
    }

    /**
     * React to a message, or take the reaction back. TAGMSG, so it carries no
     * text of its own.
     *
     * A reaction is two client tags and needs both: the emoji, and which
     * message it is about. Libera carries neither, and the TAGMSG that arrived
     * there had been stripped of everything that made it a reaction — so the
     * button appeared to work and nothing happened. Returns false so the caller
     * can say so instead.
     */
    fun react(
        target: String,
        messageId: String,
        emoji: String,
        remove: Boolean = false
    ): Boolean {
        if (!state.capabilities.contains("message-tags")) return false

        val deny = state.isupport["CLIENTTAGDENY"]
        val names = if (remove) ClientTags.UNREACT else ClientTags.REACT
        val tag = ClientTags.toUse(deny, names) ?: return false
        val replyTag = ClientTags.toUse(deny, ClientTags.REPLY) ?: return false

        sendRaw("@+$tag=$emoji;+$replyTag=$messageId " + Irc.serialise("TAGMSG", listOf(target)))
        return true
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

    override fun kick(channel: String, nick: String, reason: String?) {
        if (reason.isNullOrBlank()) send("KICK", channel, nick)
        else send("KICK", channel, nick, reason)
    }

    override fun invite(nick: String, channel: String) = send("INVITE", nick, channel)

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

    override fun setMode(target: String, mode: String, vararg args: String) =
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

    /**
     * Watch these nicks, in whichever command this network takes.
     *
     * Nothing goes out on a network that offers neither: the names stay saved,
     * and reach the server the moment we are on one that does.
     */
    fun monitorAdd(nicks: List<String>) {
        val kind = Friends.kind(state.isupport) ?: return
        for (line in Friends.lines(kind, nicks, add = true)) sendRaw(line)
    }

    fun monitorRemove(nicks: List<String>) {
        val kind = Friends.kind(state.isupport) ?: return
        for (line in Friends.lines(kind, nicks, add = false)) sendRaw(line)
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
        val kind = Friends.kind(state.isupport) ?: return
        sendRaw(Friends.listLine(kind))
    }

    private var multilineCounter = 0

    companion object {
        /** RFC 1459's line limit, in bytes, including the trailing CRLF */
        const val MAX_LINE_BYTES = 512


        /** How many commands may go back to back, matching the desktop */
        const val SEND_BURST = 5

        /** Sustained rate once the burst is spent */
        const val SEND_RATE_PER_SECOND = 1.0

        /** How often we say something, to find out whether anyone is there */
        const val PING_INTERVAL_MS = 60_000L

        /** How long after that we wait before calling the connection dead */
        const val PING_TIMEOUT_MS = 30_000L

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
            "draft/metadata-3",
            "draft/metadata-2",
            "draft/event-playback",
            "draft/pre-away",
            "draft/search",
            "draft/auto-join",
            "draft/client-batch",
            "draft/oper-tag",
            // Bridged messages, so a relayed line is attributed to the
            // person who wrote it rather than to the bot that carried it
            "draft/relaymsg",
            // What we said from another client, where a bouncer is holding
            // the connection. Without it the phone never sees what the
            // desktop typed, and the other way about.
            "znc.in/self-message",
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
    val preAwayMessage: String? = null,
    /**
     * A client certificate and its key, in PEM, for SASL EXTERNAL.
     *
     * A credential. It belongs to this phone: the desktop never sends its own,
     * and this one never goes the other way either.
     */
    val clientCert: String? = null
) {
    /** Falls back to the nick, the way every client does */
    val ident: String get() = username.ifBlank { nick }
    val gecos: String get() = realname.ifBlank { nick }
}
