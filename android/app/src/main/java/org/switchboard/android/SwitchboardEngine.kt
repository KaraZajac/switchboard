package org.switchboard.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
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
import org.switchboard.android.irc.ChatHistory
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
                // The desktop is back. Only the networks it has to hold alone
                // go with it — see [releaseConnections].
                runCatching { releaseConnections(includingShared = false) }
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
            // Per network, not per device. On a server that lets both of us on
            // at once we have our own socket and our own copy of everything the
            // desktop is relaying; applying both would show every message
            // twice. On the servers we are not on, the desktop is still the
            // only source there is.
            val about = (data as? JsonObject)?.get("serverId")?.jsonPrimitive?.contentOrNull()

            if (about == null || !connections.containsKey(about)) {
                store.handleEvent(channel, data)
                if (channel == "irc:message") notifyIfWorthIt(data)

                // The desktop read it. Whatever this phone was showing about
                // that conversation is answered.
                if (channel == "irc:read-marker") clearNotificationFor(data)

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

        coordinator.onChange {
            // A follower is not a spectator any more: on the networks that
            // allow two of us, this phone is on them too.
            joinSharedConnections()
            recomputeMode()
        }
    }

    fun start() {
        watchTheNetwork()
        coordinator.start()
    }

    /**
     * Ask Android to say when the phone has a network again.
     *
     * The backoff between connection attempts is right for a server that is
     * down and wrong for the reason a phone actually loses a connection: it
     * walked out of range and walked back. Nothing told the client that had
     * happened, so after a blip it sat in a minute of backoff that the
     * operating system could have ended the moment the radio reattached.
     *
     * Only a nudge — connections that are up stay up, and the keepalive is
     * what decides whether they are really there.
     */
    private fun watchTheNetwork() {
        if (networkCallback != null) return
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                for (connection in connections.values) connection.networkAvailable()
            }
        }
        runCatching { manager.registerDefaultNetworkCallback(callback) }
            .onSuccess { networkCallback = callback }
    }

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

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

        // The server's own notices — "Looking up your hostname", and the rest
        // of the connection banner. Not somebody talking to you.
        if (isConsole(channel)) return

        val conversationKey = "$serverId:${channel.lowercase()}"
        if (isForeground && conversationKey == store.conversationKey()) return
        if (isMuted(serverId, channel)) return

        // A direct message is always for you; in a channel, your name has to
        // come up as a word rather than as part of a longer one.
        val direct = !channel.startsWith("#") && !channel.startsWith("&")
        val mentioned = direct || namesYou(text, me)

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

    /**
     * Ask which conversations had traffic while we were shut.
     *
     * A fortnight is long enough to cover a weekend away and short enough that
     * the list stays readable; the server caps it anyway. Channels are already
     * covered by rejoining them — this is about the DM from somebody we have
     * never spoken to, which leaves nothing at all behind for a client that was
     * not connected to see it arrive.
     */
    private fun askWhatWeMissed(serverId: String) {
        val connection = connections[serverId] ?: return
        val since = java.time.Instant.now().minus(14, java.time.temporal.ChronoUnit.DAYS)
        ChatHistory.requestTargets(connection, since.toString())
    }

    /**
     * Did the network really let us on beside the desktop?
     *
     * It answers by what it calls us. A server that allows two sessions of one
     * account gives the second one the same nick; a server that does not hands
     * out `kara_` and leaves the user standing in the channel twice under two
     * names, which is worse than not being there at all.
     *
     * Only while somebody else is primary. When this phone is the connection,
     * arriving as `kara_` is the ordinary nick-collision case and the recovery
     * loop is already working on it.
     *
     * Returns false when the connection was given back, so the caller stops.
     */
    private fun keptOurNameAlongside(serverId: String): Boolean {
        val config = vault.servers().find { it.id == serverId } ?: return true
        val connection = connections[serverId] ?: return true

        val keep = keepSharedConnection(
            primary = coordinator.state().role == SessionRole.PRIMARY,
            wanted = config.nick,
            got = connection.currentNick
        )
        if (keep) return true

        Log.i(
            TAG,
            "${config.host} would not have us as ${config.nick} " +
                "(we are ${connection.currentNick}); following the desktop instead"
        )
        refusedToShare.add(serverId)
        closeConnection(serverId, "The desktop is holding this one")
        return false
    }

    /**
     * Ask the server again to watch the people we watch.
     *
     * MONITOR lives on the connection: it is not an account setting, and the
     * server forgets the whole list the moment the socket goes. So a friend
     * list survived exactly until the first reconnect and then quietly stopped
     * working — no notices, no error, just nothing ever again.
     *
     * The vault is the record; this puts it back on the wire.
     */
    private fun rearmMonitor(serverId: String) {
        val watched = vault.watched(serverId)
        if (watched.isEmpty()) return

        store.setWatched(serverId, watched)
        connections[serverId]?.monitorAdd(watched)
    }

    /**
     * Keep the shared config's join-on-connect list matching where we actually
     * are.
     *
     * Only for our own connection: while the desktop holds them, the joins and
     * parts on screen are its business to record, and both devices writing the
     * same change would trade vault versions over nothing.
     *
     * A kick is left alone deliberately. Being thrown out of a channel is not a
     * decision to stop being in it, and a client that quietly removed it would
     * make the ban permanent on the user's behalf.
     */
    private fun rememberMembership(channel: String, data: JsonElement) {
        val payload = data as? JsonObject ?: return
        if (payload["isMe"]?.jsonPrimitive?.booleanOrNull != true) return

        val serverId = payload["serverId"]?.jsonPrimitive?.contentOrNull() ?: return
        val name = payload["channel"]?.jsonPrimitive?.contentOrNull() ?: return
        // Only rooms: a private message is not somewhere you can be rejoined to.
        if (!isChannel(name)) return

        when (channel) {
            "irc:join" -> rememberJoin(serverId, name)
            "irc:part" -> forgetJoin(serverId, name)
        }
    }

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

    /**
     * Put away what was waiting in a conversation somebody read elsewhere.
     *
     * With both devices on a network, both of them see every message and both
     * were about to say so. `draft/read-marker` is the network telling us the
     * other one got there first.
     */
    private fun clearNotificationFor(data: JsonElement) {
        val payload = data as? JsonObject ?: return
        val serverId = payload["serverId"]?.jsonPrimitive?.contentOrNull() ?: return
        val channel = payload["channel"]?.jsonPrimitive?.contentOrNull() ?: return
        notifier.clear("$serverId:${channel.lowercase()}")
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

    /**
     * Whether a desktop is part of this at all.
     *
     * Half the things the UI says read completely differently depending on it,
     * and for a phone used on its own the answer is no — which used to be the
     * case none of those sentences were written for.
     */
    var pairedWithDesktop by mutableStateOf(false)
        private set

    /**
     * Whether the desktop is on these networks too, right now.
     *
     * Not a fallback and not a takeover: both devices are simply on, the way
     * two phones are both signed in to the same chat app. Worth saying, because
     * the alternative sentence — "this phone is holding the connections" —
     * promises something about the desktop that is no longer true.
     */
    var sharingWithDesktop by mutableStateOf(false)
        private set

    /** Whether Doze is currently holding this phone back, for the UI to say so */
    var isDozeRestricted by mutableStateOf(false)
        private set

    fun noteDozeState(dozing: Boolean, exempt: Boolean) {
        isDozeRestricted = dozing || !exempt
    }

    fun stop() {
        networkCallback?.let { callback ->
            runCatching {
                context.getSystemService(ConnectivityManager::class.java)
                    ?.unregisterNetworkCallback(callback)
            }
        }
        networkCallback = null
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
            // this is the moment we can actually do it — and either way the
            // networks that let both devices on are ours to join now.
            if (coordinator.state().role == SessionRole.PRIMARY) takeConnections()
            joinSharedConnections()
            recomputeMode()
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
        // A config from the other device may carry credentials this phone did
        // not have, which is exactly what turns a network's "no" into a "yes".
        refusedToShare.clear()

        (vault.setting("theme") as? JsonPrimitive)?.contentOrNull()?.takeIf { it.isNotBlank() }
            ?.let { shared ->
                if (shared != themeId) {
                    themeId = shared
                    prefs.edit().putString(THEME_KEY, shared).apply()
                    applyTheme(shared)
                }
            }

        (vault.setting(MUTES_KEY) as? JsonObject)?.let { mutes = Mutes.fromJson(it) }

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

    /** How many networks this phone knows about, its own or a desktop's */
    val knownServers: Int get() = if (vault.isUnlocked) vault.servers().size else store.servers.size

    /** Whether the config carries a passphrase, which is what sharing it needs */
    val configHasPassphrase: Boolean get() = vault.hasPassphrase

    /**
     * Put a passphrase on this phone's config so a desktop can share it.
     *
     * Not needed to use the app — the config exists and is unlocked from the
     * first launch. This is the step that makes it shareable.
     */
    suspend fun setConfigPassphrase(passphrase: String, keepOpen: Boolean = true): Boolean {
        val set = withContext(Dispatchers.Default) { vault.setPassphrase(passphrase, keepOpen) }
        if (set) {
            vaultVersion = vault.version
            noteVaultChanged()
            recomputeMode()
        }
        return set
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
        /**
         * Whether failing is worth interrupting the user about.
         *
         * A typing indicator that could not be sent is nothing; a message that
         * could not be sent is the whole point of the app. Both come through
         * here, so the difference has to be stated.
         */
        quiet: Boolean = false,
        local: (IrcConnection) -> Unit
    ) {
        // Our own socket where we have one; the desktop's for the rest. Asking
        // whether *this phone* is holding anything would send everything down
        // whichever path the first network happened to take.
        val connection = connections[serverId]

        if (connection == null) {
            if (remote.isLinked) {
                scope.launch {
                    runCatching { remote.call(channel, JsonPrimitive(serverId), *args) }
                        .onFailure { Log.w(TAG, "$channel failed: ${it.message}") }
                }
                return
            }

            Log.w(TAG, "$channel: not connected to $serverId")
            if (!quiet) store.noteRefusal("Not connected — that was not sent")
            return
        }

        // A socket that has gone away still takes writes: the queue is
        // unbounded and `writeDirect` swallows the failure, so a message typed
        // while the connection was down disappeared without a word. The
        // reconnect will be along shortly; the message will not.
        if (!connection.isConnected) {
            if (!quiet) store.noteRefusal("Not connected — that was not sent")
            return
        }

        local(connection)
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

    /** True when this phone is talking to IRC at all */
    internal val isHolding: Boolean get() = mode == EngineMode.HOLDING

    /**
     * Whether we hold this particular network ourselves.
     *
     * The question used to be about the device — either this phone was the
     * connection or it was not. Sharing makes it about the network: we can have
     * our own socket to one server and be reading the desktop's relay for
     * another, in the same second. Anything that has a server in hand should
     * ask this rather than [isHolding], or a phone that shares one network
     * refuses to do anything on the others.
     */
    internal fun holds(serverId: String): Boolean = connections.containsKey(serverId)

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

    // ── quiet, please ─────────────────────────────────────────────────

    /**
     * What is muted, in the shape the desktop writes it.
     *
     * `{ servers: { id: until }, channels: { "id:#chan": until } }`, where the
     * timestamp is when the mute lapses and `0` means until someone unmutes it.
     * The phone only ever writes `0` — a timed mute wants a duration picker,
     * and the desktop has one — but it honours an expiry the desktop set, so
     * "mute for an hour" over there goes quiet here too.
     */
    var mutes by mutableStateOf(Mutes())
        private set

    /** True when this conversation should not light the phone up */
    fun isMuted(serverId: String, channel: String? = null): Boolean {
        if (mutes.serverMuted(serverId)) return true
        return channel != null && mutes.channelMuted(serverId, channel)
    }

    fun toggleServerMute(serverId: String) {
        applyMutes(mutes.toggleServer(serverId))
    }

    fun toggleChannelMute(serverId: String, channel: String) {
        applyMutes(mutes.toggleChannel(serverId, channel))
    }

    /**
     * Hold it, seal it, and tell the desktop.
     *
     * The vault write is what makes this survive a restart on a phone with no
     * desktop; the `settings:set` is what makes a mute show up over there
     * before the next vault exchange. Neither one is enough alone.
     */
    private fun applyMutes(next: Mutes) {
        mutes = next
        val encoded = next.toJson()
        vault.setSharedSetting(MUTES_KEY, encoded)
        vaultVersion = vault.version
        scope.launch { ask("settings:set", JsonPrimitive(MUTES_KEY), encoded) }
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
     * Join the desktop on the networks that allow it.
     *
     * The old rule was that exactly one device may be on a network at a time,
     * and the whole election exists to decide which. That rule is the server's
     * to make, not ours: given an account both connections can authenticate to,
     * a server that allows it treats the second one as another session of the
     * same person — the same messages, the same channels, the same nick.
     *
     * So on those networks there is nothing to take turns over, and taking
     * turns is what made switching devices a thing you had to wait for. Where
     * the server refuses, [sharesConnection] notices we did not get our own
     * nick and the connection goes back to the desktop.
     */
    private fun joinSharedConnections() {
        if (!vault.isUnlocked) return

        for (config in vault.servers()) {
            if (!config.autoConnect || !canShareConnection(config)) continue
            if (connections.containsKey(config.id)) continue
            if (refusedToShare.contains(config.id)) continue

            Log.i(TAG, "joining ${config.host} alongside the desktop as ${config.nick}")
            openConnection(config)
        }
    }

    /**
     * Networks that would not have both of us, so far.
     *
     * Asking is cheap but not free: a network that refuses hands out `kara_`
     * for the few seconds before we notice and give the connection back, and
     * the user is in the channel twice for those seconds. Doing that again on
     * every heartbeat would make it a flicker rather than a moment.
     *
     * Held for the session only, and cleared whenever the config changes —
     * credentials the network will accept are exactly the sort of thing that
     * turns a no into a yes.
     */
    private val refusedToShare = mutableSetOf<String>()

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

            // Notifying was wired only to the desktop's relay, so a phone
            // holding its own connection — the case this whole client exists
            // for — never told anyone anything. Messages arrived, the badge
            // counted them, and the phone stayed dark.
            if (channel == "irc:message") notifyIfWorthIt(data)

            rememberMembership(channel, data)

            // Registering is the moment this phone stops dialling and starts
            // being the connection, and nothing else was watching for it: the
            // mode was worked out when the socket opened and never again, so a
            // phone that had been in two channels for ten minutes went on
            // saying "Connecting…" until something unrelated recomputed it.
            if (channel == "irc:connected") {
                rearmMonitor(config.id)
                if (!keptOurNameAlongside(config.id)) return@IrcConnection
                askWhatWeMissed(config.id)
                recomputeMode()
            }

            // Read on the other device. Both of us are on the network now, so
            // both of us were about to tell the user about it — and a phone
            // that buzzes about something already read at the desk is the
            // reason people turn notifications off.
            if (channel == "irc:read-marker") clearNotificationFor(data)

            // A conversation somebody started while this phone was closed.
            // Opening it is the store's job; fetching what was said is ours.
            if (channel == "irc:chathistory-target") {
                val target = (data as? JsonObject)?.get("target")?.jsonPrimitive?.contentOrNull()
                if (target != null && !isChannel(target)) {
                    connections[config.id]?.requestHistoryLatest(target)
                }
            }
            if (channel == "irc:disconnected") recomputeMode()
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
        // Credentials a network will accept are exactly the sort of thing that
        // turns its "no" into a "yes", so a config change is worth another try.
        refusedToShare.clear()
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
    /**
     * Give the connections back to the desktop.
     *
     * All but the shared ones. On a network that lets both devices on at once
     * there is nothing to hand over: the desktop has its own socket and this
     * phone has its own, and dropping ours would mean going quiet and losing
     * everything said while the app was closed — which is precisely the thing
     * being on both devices was for.
     */
    private fun releaseConnections(includingShared: Boolean = true) {
        val handing = connections.filterKeys { serverId ->
            includingShared || !sharesConnection(serverId)
        }

        for ((serverId, connection) in handing) {
            connection.stop("Handing over to desktop")
            connections.remove(serverId)
            store.servers[serverId]?.let { store.servers[serverId] = it.copy(connected = false) }
        }
        recomputeMode()
    }

    /**
     * Whether we and the desktop can both be on this network.
     *
     * Two conditions, and the second is the one that took a while to see: the
     * config must carry credentials to arrive as, *and* the connection must
     * actually have got the nick it asked for. A network that does not allow
     * this answers by handing out `kara_` instead, and a phone that stayed on
     * under a name nobody recognises is worse than one that quietly follows.
     */
    private fun sharesConnection(serverId: String): Boolean {
        val config = vault.servers().find { it.id == serverId } ?: return false
        if (!canShareConnection(config)) return false

        val connection = connections[serverId] ?: return false
        if (!connection.isConnected) return true

        return connection.currentNick.equals(config.nick, ignoreCase = true)
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

        // Both of us on the same networks at once, which is the ordinary case
        // wherever the server allows it: nobody is standing in for anybody, and
        // there is nothing to wait for when you pick up the other device.
        sharingWithDesktop = live && !primary && remote.isLinked

        // Whether there is another device in the picture at all. Most of what
        // follows reads completely differently depending on it, and for a
        // phone used on its own the answer is no — which used to be the case
        // none of these messages were written for.
        pairedWithDesktop = hasPairedDesktop() || remote.isLinked

        isTakingOver = dialling
        // A config that arrived from a desktop and has not been opened. A
        // config made here is open already, so this is never about that.
        needsPassphrase = primary && !vault.isUnlocked && !remote.isLinked
        needsPairing = false
        needsSharedConfig = pairedWithDesktop && !vault.isUnlocked

        modeDetail = when {
            state.claiming -> "Asking the desktop to hand over…"
            sharingWithDesktop -> "On the same networks as your desktop"
            live && pairedWithDesktop -> "This phone is holding the connections"
            live -> "Connected"
            dialling && pairedWithDesktop ->
                lastConnectionError?.let { "Taking over — $it" } ?: "Taking over — connecting…"
            dialling -> lastConnectionError?.let { "Connecting — $it" } ?: "Connecting…"

            // On its own, and that is an ordinary way to use this. What is
            // wrong, if anything, is about this phone — not about a desktop
            // that was never part of it.
            // The banner below says this, with a tap that gets you there.
            // Repeating it in the subtitle is the noise that rule exists for.
            !pairedWithDesktop && vault.servers().isEmpty() -> "Not connected"
            !pairedWithDesktop && !vault.isUnlocked ->
                "Unlock your config to connect"
            !pairedWithDesktop -> "Not connected — open Networks to connect"

            primary && !vault.isUnlocked ->
                "The desktop is offline. Unlock the shared config to take over."
            primary && vault.servers().isEmpty() ->
                "The desktop is offline, and the shared config has no servers in it."
            primary && vault.servers().none { it.autoConnect } ->
                "The desktop is offline, and no network here is set to connect on its own."
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

        /** The shared setting both clients keep mutes in */
        const val MUTES_KEY = "mutes"
    }
}

/**
 * Muted servers and channels, as both clients store them.
 *
 * A value is the moment the mute lapses, in epoch milliseconds, with `0`
 * meaning "until unmuted" — the desktop's `mutePersistence.ts` shape, kept
 * byte-for-byte so a mute set on either device means the same thing on the
 * other. Channel keys are `serverId:channel`, lowercased, because IRC channel
 * names are case-insensitive and nobody types them consistently.
 */
data class Mutes(
    val servers: Map<String, Long> = emptyMap(),
    val channels: Map<String, Long> = emptyMap()
) {
    fun serverMuted(serverId: String, now: Long = System.currentTimeMillis()): Boolean =
        active(servers[serverId], now)

    fun channelMuted(
        serverId: String,
        channel: String,
        now: Long = System.currentTimeMillis()
    ): Boolean = active(channels[key(serverId, channel)], now)

    fun toggleServer(serverId: String): Mutes =
        copy(servers = servers.toMutableMap().also {
            if (serverMuted(serverId)) it.remove(serverId) else it[serverId] = 0L
        })

    fun toggleChannel(serverId: String, channel: String): Mutes =
        copy(channels = channels.toMutableMap().also {
            val at = key(serverId, channel)
            if (channelMuted(serverId, channel)) it.remove(at) else it[at] = 0L
        })

    fun toJson(): JsonObject = buildJsonObject {
        put("servers", JsonObject(servers.mapValues { JsonPrimitive(it.value) }))
        put("channels", JsonObject(channels.mapValues { JsonPrimitive(it.value) }))
    }

    private fun active(until: Long?, now: Long): Boolean =
        until != null && (until == 0L || until > now)

    companion object {
        fun key(serverId: String, channel: String): String = "$serverId:${channel.lowercase()}"

        fun fromJson(json: JsonObject): Mutes = Mutes(
            servers = longs(json["servers"]),
            channels = longs(json["channels"])
        )

        /**
         * The desktop writes numbers; be forgiving about how they arrive.
         *
         * A JSON number that has been through a round of `JSON.stringify` on a
         * timestamp is an integer, but a hand-edited config or an older write
         * could hold a string, and dropping the whole mute map because one
         * value is quoted would un-mute everything silently.
         */
        private fun longs(element: JsonElement?): Map<String, Long> =
            (element as? JsonObject)
                ?.mapNotNull { (key, value) ->
                    (value as? JsonPrimitive)?.content?.toLongOrNull()?.let { key to it }
                }
                ?.toMap()
                .orEmpty()
    }
}

private fun JsonPrimitive.contentOrNull(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else content

/**
 * Should a connection opened beside the other device be kept?
 *
 * The network answers by what it calls us. A server that allows two sessions
 * of one account gives the second one the same nick; a server that does not
 * hands out `kara_`, and a client that stayed on under a name nobody
 * recognises leaves the user standing in the channel twice.
 *
 * Only while somebody else is primary. When this device *is* the connection,
 * arriving as `kara_` is the ordinary nick-collision case and the recovery loop
 * is already working on it — dropping the connection there would take the user
 * off the network for a reason that fixes itself.
 */
internal fun keepSharedConnection(primary: Boolean, wanted: String, got: String): Boolean {
    if (primary) return true
    if (wanted.isBlank() || got.isBlank()) return true
    return got.equals(wanted, ignoreCase = true)
}
