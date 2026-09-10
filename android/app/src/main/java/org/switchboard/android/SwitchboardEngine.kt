package org.switchboard.android

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import android.util.Log
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.pairing.DeviceIdentity
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.session.Cancellable
import org.switchboard.android.session.ConnectionControl
import org.switchboard.android.session.CoordinatorTransport
import org.switchboard.android.session.PHONE_PRIORITY
import org.switchboard.android.session.SessionClock
import org.switchboard.android.session.SessionCoordinator
import org.switchboard.android.session.SessionFrame
import org.switchboard.android.session.SessionRole
import androidx.compose.ui.graphics.toArgb
import org.switchboard.android.ui.nickColor
import org.switchboard.android.ui.theme
import org.switchboard.android.ui.applyTheme
import org.switchboard.android.vault.VaultCrypto
import org.switchboard.android.vault.VaultStore
import java.util.Timer
import java.util.TimerTask

/**
 * What the phone is doing right now.
 *
 * The two modes are the point of the whole design. **Following** means the
 * desktop holds the connections and this is a second window onto them.
 * **Holding** means the desktop is gone and the phone connected to IRC itself,
 * using the servers and credentials out of the shared vault.
 *
 * Either way the events reaching [SwitchboardStore] are identical, so nothing
 * above this class knows which mode it is in — a failover changes the badge in
 * the header and nothing else.
 */
enum class EngineMode { FOLLOWING, HOLDING, OFFLINE }

class SwitchboardEngine(
    private val context: Context,
    internal val scope: CoroutineScope,
    val store: SwitchboardStore
) {
    val vault = VaultStore(context)

    /** This phone's identity to the desktop, and the ticket that reaches it */
    val identity = DeviceIdentity(context)
    val remote = RemoteClient(scope)
    private val notifier = Notifier(context).also { it.createChannels() }

    /** True while a screen is showing, so we do not notify about what is visible */
    var isForeground = false
        set(value) {
            field = value
            if (value) store.conversationKey()?.let(notifier::clear)
        }

    private val prefs = context.getSharedPreferences("switchboard", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    internal val connections = mutableMapOf<String, IrcConnection>()

    /** How to reach the desktop again, kept so the link can be re-dialled */
    private var link: LinkDetails? = null

    /** A ticket on disk means there is a desktop out there to wait for */
    private fun hasPairedDesktop(): Boolean = identity.ticket() != null
    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0

    /** The last thing a server said when we could not reach it */
    private var lastConnectionError: String? = null

    data class LinkDetails(val ticket: String, val deviceName: String, val secretKey: ByteArray)

    var mode by mutableStateOf(EngineMode.OFFLINE)
        private set

    /** Why the phone is in the mode it is in, in words the user can act on */
    var modeDetail by mutableStateOf("Not connected")
        private set

    var vaultVersion by mutableStateOf(0)
        private set

    /**
     * The desktop is gone and this phone cannot stand in for it.
     *
     * Worth its own flag rather than folding into [modeDetail]: it is the one
     * state the user can actually fix, and the UI should say so where they can
     * act on it.
     */
    var needsPassphrase by mutableStateOf(false)
        private set

    /** There is no desktop and no shared config: pairing is the only way forward */
    var needsPairing by mutableStateOf(false)
        private set

    /**
     * Paired, but there is no shared config to stand in with.
     *
     * The one setup step whose absence you only discover at the worst moment:
     * everything works, the phone mirrors the desktop happily, and then the
     * desktop goes off and nothing happens — because a phone with no server
     * list and no credentials cannot take over anything. Worth saying while
     * things are still working rather than after they stop.
     */
    var needsSharedConfig by mutableStateOf(false)
        private set

    private val coordinator = SessionCoordinator(
        PHONE_PRIORITY,
        object : CoordinatorTransport {
            override fun send(frame: SessionFrame, peerId: String?) {
                // Never let a send failure escape: this runs on the heartbeat,
                // which fires exactly when the desktop has stopped answering.
                scope.launch { runCatching { remote.sendPeerFrame(encodeSessionFrame(frame)) } }
            }

            /**
             * "Could a desktop be holding the connections?"
             *
             * A desktop this phone has paired with counts, not just one that is
             * dialled in. On a restart the link takes a few seconds to come
             * back, and assuming primacy in that gap has the phone connect
             * beside a desktop that is already there — the user turns up twice.
             * Waiting out the discovery window costs six seconds.
             */
            override fun hasPeers(): Boolean = remote.isLinked || hasPairedDesktop()
        },
        object : ConnectionControl {
            // Guarded because these run on the heartbeat thread: a failure to
            // bring connections up is a failure to take over, not a reason to
            // stop taking part in the election.
            override fun resume() {
                runCatching { takeConnections() }
                    .onFailure { Log.e(TAG, "could not take over", it) }
            }

            override fun release() {
                runCatching { releaseConnections() }
                    .onFailure { Log.e(TAG, "could not hand back", it) }
            }
            override fun vaultVersion(): Int = vault.version
        },
        AndroidClock()
    )

    init {
        vaultVersion = vault.version
        // Paint with the saved theme before the first frame. Read straight from
        // disk rather than from `themeId`, which is declared further down and so
        // does not exist yet.
        applyTheme(prefs.getString(THEME_KEY, null))

        remote.onPeerFrame = { frame -> handlePeerFrame(frame) }
        remote.onEvent = { channel, data ->
            // Only trust the desktop's events while it is the one connected;
            // otherwise our own engine is the source of truth.
            if (mode != EngineMode.HOLDING) {
                store.handleEvent(channel, data)
                if (channel == "irc:message") notifyIfWorthIt(data)

                // The desktop has just (re)joined a network, so what we are
                // holding is from before that and is now wrong — channels,
                // members and our own nick all changed. Refilling on the link
                // coming back is not enough: the desktop is usually still
                // connecting at that moment and has nothing to tell us yet.
                if (channel == "irc:connected") onRelinked?.invoke()
            }
        }
        remote.onStatus = { status ->
            store.status = status
            recomputeMode()
        }

        coordinator.onChange { recomputeMode() }
    }

    fun start() = coordinator.start()

    /**
     * Something outside thinks the world may have moved on.
     *
     * Doze suspends the heartbeat, so when the phone surfaces — a maintenance
     * window, an alarm that fired through it, someone picking it up — this is
     * the moment to find out whether the desktop is still there, and to put the
     * link back if it is not.
     */
    fun wake() {
        coordinator.poke()
        if (!remote.isLinked) scheduleReconnect()
        recomputeMode()
    }

    /**
     * Decide whether a message deserves the user's attention.
     *
     * Three things stop a notification: it is ours, it is in the conversation
     * already on screen, or it is history being replayed. Each of them would
     * otherwise produce the kind of noise that makes people turn notifications
     * off entirely.
     */
    private fun notifyIfWorthIt(data: JsonElement) {
        val payload = data as? JsonObject ?: return
        val serverId = payload["serverId"]?.jsonPrimitive?.contentOrNull() ?: return
        val channel = payload["channel"]?.jsonPrimitive?.contentOrNull() ?: return
        val message = payload["message"] as? JsonObject ?: return

        val nick = message["nick"]?.jsonPrimitive?.contentOrNull() ?: return
        val text = message["content"]?.jsonPrimitive?.contentOrNull() ?: return
        if (message["historical"]?.jsonPrimitive?.booleanOrNull == true) return

        val me = store.servers[serverId]?.nick.orEmpty()
        if (me.isNotEmpty() && nick.equals(me, ignoreCase = true)) return

        val conversationKey = "$serverId:${channel.lowercase()}"
        if (isForeground && conversationKey == store.conversationKey()) return

        // A direct message is always for you; in a channel, your name has to
        // come up as a word rather than as part of a longer one.
        val direct = !channel.startsWith("#") && !channel.startsWith("&")
        val mentioned = direct || (me.isNotEmpty() && mentions(text, me))

        notifier.show(
            conversationKey = conversationKey,
            conversation = channel,
            nick = nick,
            displayName = store.displayName(serverId, nick),
            text = text,
            colour = notificationColour(serverId, nick),
            mentioned = mentioned
        )
    }

    /** Your nick as a whole word, so "karaoke" is not you */
    private fun mentions(text: String, nick: String): Boolean =
        Regex("(?<![\\w\\[\\]{}\\\\`|^-])" + Regex.escape(nick) + "(?![\\w\\[\\]{}\\\\`|^-])",
            RegexOption.IGNORE_CASE).containsMatchIn(text)

    private fun notificationColour(serverId: String, nick: String): Int {
        val custom = store.metadataFor(serverId, nick).color?.trim()
        if (custom != null && Regex("^#[0-9a-fA-F]{6}$").matches(custom)) {
            return ("ff" + custom.substring(1)).toLong(16).toInt()
        }
        // Literally the UI's own function, so a person is the same colour in
        // the shade as in the channel — including after a theme change, which a
        // second copy of the palette here would have quietly ignored.
        return nickColor(nick).toArgb()
    }

    /** Reading a conversation clears what was waiting in it */
    fun markRead(serverId: String, channel: String) {
        notifier.clear("$serverId:${channel.lowercase()}")

        // And tell the rest of the world. Catching up in bed is not much use if
        // the desktop still shows forty unread in the morning — draft/read-marker
        // is what carries that across, and the desktop stores it either way.
        val latest = store.messagesFor(serverId, channel).lastOrNull()?.timestamp ?: return
        markReadUpTo(serverId, channel, latest)
    }

    /** Dialling out to take over, but not connected yet */
    var isTakingOver by mutableStateOf(false)
        private set

    /** Whether Doze is currently holding this phone back, for the UI to say so */
    var isDozeRestricted by mutableStateOf(false)
        private set

    fun noteDozeState(dozing: Boolean, exempt: Boolean) {
        isDozeRestricted = dozing || !exempt
    }

    fun stop() {
        reconnectJob?.cancel()
        reconnectJob = null
        // Say so, so the desktop takes over at once instead of waiting
        coordinator.leave()
        releaseConnections()
    }

    /**
     * Dial the desktop, and keep dialling.
     *
     * The link dies whenever the desktop does, which is precisely when this
     * phone takes over — and it has to come back on its own, because nothing
     * else will bring it back. Without this the phone holds the connections
     * forever and the desktop, returning, joins the network beside it.
     */
    suspend fun connectToDesktop(
        ticket: String,
        pairingCode: String?,
        deviceName: String,
        secretKey: ByteArray
    ) {
        link = LinkDetails(ticket, deviceName, secretKey)
        try {
            withContext(Dispatchers.IO) {
                remote.connect(ticket, pairingCode, deviceName, secretKey)
            }
            reconnectAttempt = 0
        } catch (e: Exception) {
            // Keep trying. A first attempt that fails is the ordinary case —
            // the phone woke before the desktop, or the desktop's link is not
            // on yet — and giving up there leaves the two never paired up
            // again until someone reopens the app.
            Log.i(TAG, "first dial failed (${e.message}); will keep trying")
            scheduleReconnect()
            throw e
        }
    }

    private fun scheduleReconnect() {
        val details = link ?: return
        if (reconnectJob?.isActive == true) return

        reconnectJob = scope.launch {
            while (!remote.isLinked) {
                // The first try is quick on purpose: a desktop that just came
                // back opens a short window in which it waits to hear from us,
                // and missing it means it joins the network under `nick_`
                // beside the phone that is still holding the connection.
                // After that, back off — but never give up, because the desktop
                // may be a closed laptop lid away from returning.
                val wait = if (reconnectAttempt == 0) {
                    1_000L
                } else {
                    minOf(30_000L, 2_000L * (1L shl minOf(reconnectAttempt - 1, 4)))
                }
                reconnectAttempt++
                delay(wait)

                val reconnected = runCatching {
                    withContext(Dispatchers.IO) {
                        remote.connect(details.ticket, null, details.deviceName, details.secretKey)
                    }
                }.isSuccess

                if (reconnected) {
                    reconnectAttempt = 0
                    onRelinked?.invoke()
                    return@launch
                }
            }
        }
    }

    /** Called after the link comes back, so the UI can refill from the desktop */
    var onRelinked: (() -> Unit)? = null

    /**
     * Unlock the shared config so the phone can stand in for the desktop.
     *
     * Suspends, and does the work on a background thread: the KDF is 600,000
     * iterations by design, which is around a second of solid CPU on a phone.
     * On the main thread that is long enough for Android to put up "Switchboard
     * isn't responding" — the cost is the point, so it has to be paid off-thread.
     */
    suspend fun unlockVault(passphrase: String, keepOpen: Boolean = false): Boolean {
        val opened = withContext(Dispatchers.Default) { vault.unlock(passphrase, keepOpen) }
        if (opened) {
            vaultVersion = vault.version
            applySharedState()
            // If we already won the election but had nothing to connect to,
            // this is the moment we can actually do it.
            if (coordinator.state().role == SessionRole.PRIMARY) takeConnections() else recomputeMode()
        }
        return opened
    }

    /**
     * Take on the parts of the vault that are not servers.
     *
     * The theme and the watched-nick lists belong to the person rather than to
     * either device, and the vault is where they travel: `settings:get` over
     * the link only answers while the desktop is reachable, and this has to be
     * right on a phone that is on its own.
     */
    private fun applySharedState() {
        (vault.setting("theme") as? JsonPrimitive)?.contentOrNull()?.takeIf { it.isNotBlank() }
            ?.let { shared ->
                if (shared != themeId) {
                    themeId = shared
                    prefs.edit().putString(THEME_KEY, shared).apply()
                    applyTheme(shared)
                }
            }

        for (server in vault.servers()) {
            val watched = vault.watched(server.id)
            if (watched.isNotEmpty()) store.setWatched(server.id, watched)
        }
    }

    fun lockVault() {
        vault.lock()
        releaseConnections()
    }

    /** Whether this phone has a config of its own, desktop or no desktop */
    val hasOwnConfig: Boolean get() = vault.exists

    /**
     * Begin a config on this phone alone.
     *
     * The way in for someone who has no desktop and does not want one. What it
     * makes is the same shared config a desktop would have handed over, so
     * pairing one later is a merge rather than a fresh start.
     */
    suspend fun startOwnConfig(passphrase: String, keepOpen: Boolean = true): Boolean {
        val made = withContext(Dispatchers.Default) { vault.create(passphrase, keepOpen) }
        if (made) {
            vaultVersion = vault.version
            recomputeMode()
        }
        return made
    }

    val vaultFingerprint: String? get() = vault.fingerprint
    val isVaultUnlocked: Boolean get() = vault.isUnlocked
    val isVaultKeptOpen: Boolean get() = vault.isKeptOpen

    // ── acting, whichever mode we are in ──────────────────────────────

    /**
     * Do something, wherever the connection happens to live.
     *
     * Every action the app offers has this shape: holding the connection means
     * acting on it directly, following means asking the desktop to act for us.
     * That is the only difference between the two modes, so it is said once
     * here instead of in each of the thirty methods in `EngineActions.kt`.
     */
    internal fun act(
        serverId: String,
        channel: String,
        vararg args: JsonElement,
        local: (IrcConnection) -> Unit
    ) {
        if (mode == EngineMode.HOLDING) {
            connections[serverId]?.let(local)
                ?: Log.w(TAG, "$channel: holding, but not connected to $serverId")
        } else {
            scope.launch {
                runCatching { remote.call(channel, JsonPrimitive(serverId), *args) }
                    .onFailure { Log.w(TAG, "$channel failed: ${it.message}") }
            }
        }
    }

    /**
     * Ask for something and wait for the answer.
     *
     * Null means the desktop could not be asked, which the caller has to show
     * rather than render as an empty result — "no messages match" and "the
     * search never happened" are different things to a person looking at a
     * blank screen.
     */
    internal suspend fun ask(channel: String, vararg args: JsonElement): JsonElement? =
        try {
            remote.call(channel, *args)
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            // The caller went away. That is not an answer of "nothing", and
            // treating it as one is how a screen decides there is no more
            // history and stops asking.
            throw cancelled
        } catch (e: Exception) {
            Log.w(TAG, "$channel failed: ${e.message}")
            null
        }

    /** True when this phone is the one talking to IRC */
    internal val isHolding: Boolean get() = mode == EngineMode.HOLDING

    // ── how it looks ──────────────────────────────────────────────────

    /**
     * The theme, which is a shared setting rather than a per-device one.
     *
     * Kept on disk here as well so the phone paints correctly before the
     * desktop is reachable — and while it never is, for a phone standing in on
     * its own. The shared copy wins whenever the two disagree.
     */
    var themeId by mutableStateOf(theme.id)
        private set

    fun setTheme(id: String) {
        themeId = id
        prefs.edit().putString(THEME_KEY, id).apply()
        applyTheme(id)
        scope.launch { ask("settings:set", JsonPrimitive("theme"), JsonPrimitive(id)) }
    }

    /**
     * Adopt whatever the desktop and phone have agreed on.
     *
     * Called when the link comes up. A phone that has never been told anything
     * publishes what it is using, so the first device to have an opinion sets
     * it rather than both sitting on their own defaults.
     */
    suspend fun syncTheme() {
        val shared = (ask("settings:get", JsonPrimitive("theme")) as? JsonPrimitive)
            ?.contentOrNull()
        if (shared.isNullOrBlank()) {
            ask("settings:set", JsonPrimitive("theme"), JsonPrimitive(themeId))
            return
        }
        if (shared == themeId) return
        themeId = shared
        prefs.edit().putString(THEME_KEY, shared).apply()
        applyTheme(shared)
    }

    // ── becoming, and un-becoming, the connection ─────────────────────

    /**
     * Take over: connect to everything the desktop was holding.
     *
     * A locked vault stops this cold, and it has to — without the vault there is
     * no server list and no credentials. The UI says so rather than silently
     * showing an empty client, which is the failure a user would misread as the
     * app being broken.
     */
    private fun takeConnections() {
        Log.i(TAG, "taking over: vault=${if (vault.isUnlocked) "unlocked" else "locked"}, " +
            "servers=${vault.servers().size}, already=${connections.size}")

        if (vault.isUnlocked) {
            for (config in vault.servers().filter { it.autoConnect }) openConnection(config)
        }
        recomputeMode()
    }

    /**
     * Bring up one network.
     *
     * Separate from [takeConnections] because a server can be added, or
     * reconnected by hand, long after the takeover that opened the rest.
     */
    internal fun openConnection(config: ServerConfig) {
        if (connections.containsKey(config.id)) return
        Log.i(TAG, "connecting to ${config.host}:${config.port} as ${config.nick}")
        seedServer(config)
        val connection = IrcConnection(config, scope) { channel, data ->
            store.handleEvent(channel, data)
        }
        connections[config.id] = connection
        connection.start()
        recomputeMode()
    }

    /** Close one network, leaving the rest alone */
    internal fun closeConnection(serverId: String, reason: String = "Disconnecting") {
        connections.remove(serverId)?.stop(reason)
        store.servers[serverId]?.let { store.servers[serverId] = it.copy(connected = false) }
        recomputeMode()
    }

    /** The server list out of the vault, whatever mode we are in */
    internal fun vaultServers(): List<ServerConfig> = vault.servers()

    /**
     * We changed the shared config ourselves.
     *
     * The desktop learns about it the same way we learn about its changes — an
     * offer carrying the new version, which it pulls if it is behind. Doing it
     * this way means a phone that adds a network while the desktop is asleep
     * does not have to remember to tell it later.
     */
    internal fun noteVaultChanged() {
        vaultVersion = vault.version
        for (config in vault.servers()) {
            if (store.servers.containsKey(config.id)) continue
            seedServer(config)
        }
        scope.launch {
            runCatching {
                remote.sendPeerFrame(buildJsonObject {
                    put("t", JsonPrimitive("vault-offer"))
                    put("version", JsonPrimitive(vault.version))
                })
            }
        }
    }

    /** Hand back: disconnect cleanly so the desktop can take our place */
    private fun releaseConnections() {
        for (connection in connections.values) connection.stop("Handing over to desktop")
        connections.clear()
        recomputeMode()
    }

    /**
     * Work out what to show, from what is actually true.
     *
     * Holding the connections means holding sockets, not merely having won the
     * election — a phone that is nominally primary but has a locked vault is not
     * connected to anything, and saying otherwise would be a lie the user acts on.
     */
    /**
     * Something outside the engine changed what mode we are in.
     *
     * Pairing is the case: the ticket is written by the screen that dialled,
     * after the dial succeeds, and until something looks again the banner goes
     * on telling a phone that just paired to go and pair.
     */
    fun refreshMode() = recomputeMode()

    private fun recomputeMode() {
        val state = coordinator.state()
        val primary = state.role == SessionRole.PRIMARY

        // "Holding" means holding a registered connection, not merely having
        // decided to. A socket that is still dialling — or failing and backing
        // off — is not cover, and saying it is leaves the user believing their
        // messages are going somewhere.
        val live = connections.values.any { it.isConnected }
        val dialling = connections.isNotEmpty() && !live

        Log.i(TAG, "role=${state.role} live=$live dialling=$dialling " +
            "linked=${remote.isLinked} vault=${vault.isUnlocked}")

        mode = when {
            live -> EngineMode.HOLDING
            remote.isLinked && !primary -> EngineMode.FOLLOWING
            else -> EngineMode.OFFLINE
        }

        // Only when there is actually something to unlock. A phone with no
        // vault at all has a different problem, and a different answer.
        isTakingOver = dialling
        needsPassphrase = primary && vault.exists && !vault.isUnlocked && !remote.isLinked

        // Being paired and having a shared config are separate things, and
        // telling someone who is already paired to go and pair is no help at
        // all. The second is what failover actually needs.
        needsPairing = !hasPairedDesktop() && !vault.exists
        needsSharedConfig = hasPairedDesktop() && !vault.exists

        modeDetail = when {
            state.claiming -> "Asking the desktop to hand over…"
            live -> "This phone is holding the connections"
            dialling -> lastConnectionError?.let { "Taking over — $it" } ?: "Taking over — connecting…"
            primary && vault.exists && !vault.isUnlocked ->
                "The desktop is offline. Unlock the shared config to take over."
            primary && !vault.exists && hasPairedDesktop() ->
                "The desktop is offline, and never shared its config — so there is " +
                    "nothing here to take over with."
            primary && !vault.exists ->
                "No desktop, and no shared config yet. Pair to get one."
            primary && vault.servers().none { it.autoConnect } ->
                "The desktop is offline, and the shared config has no servers to connect to."
            primary -> "Taking over from the desktop…"
            remote.isLinked -> "Following the desktop"
            else -> "Looking for the desktop…"
        }
    }

    /**
     * Put the server in the store before it connects.
     *
     * Otherwise the first `irc:connected` event arrives for a server the store
     * has never heard of and is dropped, and the user watches an empty screen
     * while the connection is in fact working.
     */
    private fun seedServer(config: ServerConfig) {
        store.servers[config.id] = Server(
            id = config.id,
            name = config.name,
            host = config.host,
            nick = config.nick,
            connected = false
        )
    }

    // ── the peer protocol ─────────────────────────────────────────────

    private fun handlePeerFrame(frame: JsonObject) {
        when (frame["t"]?.jsonPrimitive?.content) {
            "peer-gone" -> {
                coordinator.peerGone(DESKTOP_PEER)
                recomputeMode()
                scheduleReconnect()
            }

            "heartbeat" -> {
                coordinator.handleFrame(
                    DESKTOP_PEER,
                    SessionFrame.Heartbeat(
                        role = if (frame["role"]?.jsonPrimitive?.content == "primary") {
                            SessionRole.PRIMARY
                        } else {
                            SessionRole.FOLLOWER
                        },
                        priority = frame["priority"]?.jsonPrimitive?.int ?: 0,
                        since = frame["since"]?.jsonPrimitive?.contentOrNull(),
                        vaultVersion = frame["vaultVersion"]?.jsonPrimitive?.int ?: 0
                    )
                )

                // The desktop advertises its vault version in every beat, so a
                // phone that has been away notices it is behind without asking.
                val theirs = frame["vaultVersion"]?.jsonPrimitive?.int ?: 0
                if (theirs > vault.version) requestVault()
            }

            "claim" -> coordinator.handleFrame(
                DESKTOP_PEER,
                SessionFrame.Claim(frame["priority"]?.jsonPrimitive?.int ?: 0)
            )

            "yielded" -> coordinator.handleFrame(DESKTOP_PEER, SessionFrame.Yielded)

            "goodbye" -> {
                // The desktop is closing on purpose. Take over now rather than
                // spending the heartbeat timeout finding out.
                coordinator.handleFrame(DESKTOP_PEER, SessionFrame.Goodbye)
                recomputeMode()
            }

            "vault-offer" -> {
                val offered = frame["version"]?.jsonPrimitive?.int ?: 0
                if (offered > vault.version) requestVault()
            }

            "vault-request" -> {
                // The desktop is behind us — offer what we hold
                val envelope = vault.sealedEnvelope() ?: return
                scope.launch {
                    runCatching {
                        remote.sendPeerFrame(buildJsonObject {
                            put("t", JsonPrimitive("vault-payload"))
                            put("envelope", json.parseToJsonElement(VaultCrypto.encode(envelope)))
                        })
                    }
                }
            }

            "vault-payload" -> {
                val envelope = frame["envelope"] ?: return
                val result = runCatching { vault.accept(VaultCrypto.decode(envelope)) }.getOrNull()
                    ?: return
                vaultVersion = vault.version
                store.status = result.reason
                applySharedState()
            }
        }
    }

    private fun requestVault() {
        scope.launch {
            runCatching {
                remote.sendPeerFrame(buildJsonObject { put("t", JsonPrimitive("vault-request")) })
            }
        }
    }

    private fun encodeSessionFrame(frame: SessionFrame): JsonObject = when (frame) {
        is SessionFrame.Heartbeat -> buildJsonObject {
            put("t", JsonPrimitive("heartbeat"))
            put("role", JsonPrimitive(if (frame.role == SessionRole.PRIMARY) "primary" else "follower"))
            put("priority", JsonPrimitive(frame.priority))
            put("since", frame.since?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            put("vaultVersion", JsonPrimitive(frame.vaultVersion))
        }

        is SessionFrame.Claim -> buildJsonObject {
            put("t", JsonPrimitive("claim"))
            put("priority", JsonPrimitive(frame.priority))
        }

        SessionFrame.Yielded -> buildJsonObject { put("t", JsonPrimitive("yielded")) }

        SessionFrame.Goodbye -> buildJsonObject { put("t", JsonPrimitive("goodbye")) }
    }


    /** The real clock, wrapping java.util.Timer so the coordinator stays testable */
    /**
     * The real clock, wrapping java.util.Timer so the coordinator stays testable.
     *
     * Two things about `Timer` matter here, and both are the kind that end
     * failover without a word:
     *
     * A task that throws kills the timer thread and every task scheduled on it,
     * for the life of the process. The heartbeat, the discovery window and the
     * claim fallback all run here, so one unlucky exception anywhere in a beat
     * and the phone simply stops noticing that the desktop is gone. Hence the
     * catch — a beat that fails is a beat, not the end of beating.
     *
     * And `scheduleAtFixedRate` makes up the beats it missed: a phone that
     * sleeps for an hour wakes to hundreds of them at once. Fixed *delay* is
     * what a heartbeat wants.
     */
    private class AndroidClock : SessionClock {
        private val timer = Timer("switchboard-session", true)

        override fun now(): Long = System.currentTimeMillis()

        private fun guarded(action: () -> Unit) = object : TimerTask() {
            override fun run() {
                try {
                    action()
                } catch (e: Throwable) {
                    Log.w(TAG, "session timer task failed", e)
                }
            }
        }

        override fun schedule(delayMs: Long, action: () -> Unit): Cancellable {
            val task = guarded(action)
            timer.schedule(task, delayMs)
            return Cancellable { task.cancel() }
        }

        override fun repeating(intervalMs: Long, action: () -> Unit): Cancellable {
            val task = guarded(action)
            timer.schedule(task, intervalMs, intervalMs)
            return Cancellable { task.cancel() }
        }
    }

    private companion object {
        const val TAG = "SwitchboardEngine"

        /** Where the chosen theme is cached on this device */
        const val THEME_KEY = "theme"

        /** There is exactly one desktop on this link, so it needs only one name */
        const val DESKTOP_PEER = "desktop"
    }
}

private fun JsonPrimitive.contentOrNull(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else content
