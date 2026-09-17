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
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import android.util.Log
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.switchboard.android.irc.Aliases
import org.switchboard.android.irc.Bouncer
import org.switchboard.android.irc.AutoAway
import org.switchboard.android.irc.ChatHistory
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.irc.JoinReason
import org.switchboard.android.irc.Profile
import org.switchboard.android.irc.Socks
import org.switchboard.android.irc.Reconnect
import org.switchboard.android.pairing.DeviceIdentity
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.session.Cancellable
import org.switchboard.android.session.ConnectionControl
import org.switchboard.android.session.CoordinatorTransport
import org.switchboard.android.session.PHONE_PRIORITY
import org.switchboard.android.session.SERVER_PRIORITY
import org.switchboard.android.session.SessionClock
import org.switchboard.android.session.SessionCoordinator
import org.switchboard.android.session.SessionFrame
import org.switchboard.android.session.SessionRole
import androidx.compose.ui.graphics.toArgb
import org.switchboard.android.ui.nickColor
import org.switchboard.android.ui.theme
import org.switchboard.android.ui.applyTheme
import org.switchboard.android.vault.VaultCrypto
import java.util.Timer
import java.util.TimerTask
import org.switchboard.android.irc.Ignore
import org.switchboard.android.store.MessageStore
import kotlinx.serialization.json.JsonArray
import org.switchboard.android.vault.VaultStore
import org.switchboard.android.push.offerPushEndpoint

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
    internal val context: Context,
    internal val scope: CoroutineScope,
    val store: SwitchboardStore
) {
    val vault = VaultStore(context)

    /**
     * What was said, kept on this phone — see [MessageStore].
     *
     * Small and local. It is what makes a conversation still be there after
     * Android has stopped the process, and what stops an evening of holding
     * the connections being lost before the desktop comes back to be told.
     */
    val history = MessageStore(context)

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
    /**
     * Why the last attempt on this network failed, for the status line.
     *
     * Read in three places and assigned in none, so every branch that meant to
     * explain itself fell through to "Connecting…" instead. A client that
     * knows exactly why it cannot connect and says nothing is worse than one
     * that does not know.
     */
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

            /** What this phone has open, so a returning desktop dials the same */
            override fun holding(): List<String> = connections.keys.toList()
        },
        AndroidClock()
    )

    init {
        // The badges ask the same question the notifier asks, of the same
        // markers — see [Unread.countsAsUnread]
        store.readMarkerFor = { serverId, channel ->
            runCatching { history.readMarker(serverId, channel) }.getOrNull()
        }

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

            if ((about == null || !connections.containsKey(about)) && !silenced(channel, data)) {
                // Relayed from whatever is holding it. Worth acting on here
                // because a headless Switchboard has no screen of its own to
                // make the offer on.
                if (channel == "irc:bouncer-networks") noteBouncerNetworks(data)
                store.handleEvent(channel, data)
                if (channel == "irc:message") notifyIfWorthIt(data)
                // Relayed from the desktop, which wrote it down as it sent it
                // — nothing to hand back, but worth keeping so this phone
                // opens with the conversation still in it
                record(channel, data, ours = false)

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
        // Everything in the config that is not a server: the theme, the mutes,
        // the ignore list, the words that ring a bell, the aliases, how long of
        // nothing counts as away.
        //
        // This only ever ran when a passphrase was typed or a desktop handed
        // over a vault, so a phone whose config stays unlocked in its keystore
        // — which is most of them, and every phone with no desktop — came back
        // from a restart having forgotten all of it. An alias made yesterday
        // was gone this morning, and so was everyone you had ignored.
        //
        // Not in `init`: the properties it writes are declared further down,
        // and their own initialisers would run afterwards and overwrite it.
        applySharedState()

        // What the last run of this app heard. Before anything dials, so the
        // conversation is there to read while the network is still answering.
        restoreHistory()

        watchTheNetwork()
        coordinator.start()

        // Half a minute is often enough for a rule counted in minutes, and the
        // loop costs nothing while the feature is off — the action is NOTHING
        // for every connection and no line is sent.
        awayJob?.cancel()
        awayJob = scope.launch {
            while (true) {
                delay(AWAY_TICK_MS)
                applyAutoAway()
            }
        }
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
        // Doze freezes the half-minute poll, and the screen being off is
        // exactly when the away is owed. The backstop alarm that got us here
        // is the only thing still running, so this rides on it.
        applyAutoAway()
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

        /*
         * Nothing at or before where this conversation was read up to.
         *
         * `historical` only covers a replay this client recognised as one —
         * the server wraps `CHATHISTORY` in a batch, but only for a client
         * that negotiated both `batch` and `message-tags`, and the desktop
         * marks nothing it relays. So an old message can arrive looking
         * entirely live, and did: a reconnect brought a burst of notifications
         * for direct messages read days ago. A direct message always notifies,
         * which is why it showed up there first and not in channels.
         *
         * The read marker is the honest test, and it is the same one on both
         * devices. Anything genuinely new is newer than it.
         */
        val at = message["timestamp"]?.jsonPrimitive?.contentOrNull()
        if (runCatching { history.hasBeenRead(serverId, channel, at) }.getOrDefault(false)) return

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
        val mentioned = direct ||
            notifyAll.contains(conversationKey) ||
            mentionsYou(text, me, store.highlightWords)

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
     * Draw a notification for something that did not come down a socket.
     *
     * A Web Push arrives when the client is not connected, which is the whole
     * point of it — so the checks an ordinary message goes through do not all
     * apply. What still does: a conversation already read somewhere else, and
     * one the user is looking at.
     */
    internal fun notifyPushed(
        serverId: String,
        conversation: String,
        nick: String,
        text: String,
        mentioned: Boolean
    ) {
        val conversationKey = "$serverId:${conversation.lowercase()}"
        if (isForeground && conversationKey == store.conversationKey()) return
        if (isMuted(serverId, conversation)) return

        notifier.show(
            conversationKey = conversationKey,
            conversation = conversation,
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

        // Once per connection. A network announces itself over several 005
        // lines and this is called from that, so without the guard a long
        // friend list goes out once per line — which is a flood, and a flood
        // is what a server disconnects you for.
        if (!friendListArmed.add(serverId)) return
        connections[serverId]?.monitorAdd(watched)
        connections[serverId]?.monitorStatus()
    }

    /**
     * Put the friend list on screen, whether or not it can go on the wire.
     *
     * A network that offers neither MONITOR nor WATCH never reaches
     * [rearmMonitor] — nothing can be sent to it — and the people you watch
     * there would then be missing from a list that is supposed to hold all of
     * them. Showing them offline is honest; not showing them is not.
     */
    private fun loadWatched(serverId: String) {
        val watched = vault.watched(serverId)
        if (watched.isNotEmpty()) store.setWatched(serverId, watched)
    }

    /** Networks whose friend list has gone out on this connection */
    private val friendListArmed = mutableSetOf<String>()

    /**
     * Networks already told where to push, this connection.
     *
     * Told at `irc:isupport` rather than at `irc:connected`, because that is
     * the first moment both halves are known: SASL finishes before 001 so the
     * account is in hand, and `VAPID` arrives with 005 like every other token.
     * Once per connection, because a registration is an upsert and repeating
     * it every time a token lands is a line per 005.
     */
    private val pushOffered = mutableSetOf<String>()

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

    /** Whether the peer we follow is an always-on Switchboard rather than a desktop */
    var followingAlwaysOn by mutableStateOf(false)
        private set

    /** Whether every network this phone holds is reached through a bouncer */
    var allThroughBouncer by mutableStateOf(false)
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
        awayJob?.cancel()
        awayJob = null
        awaySetByUs.clear()
        // Say so, so the desktop takes over at once instead of waiting
        coordinator.leave()
        releaseConnections()

        // And let go of the link itself, or "switch off" leaves a phone still
        // dialled in to a desktop it has just said goodbye to.
        //
        // After the goodbye rather than with it: the coordinator's transport
        // launches its sends, so closing the connection in the same breath
        // races the one frame that tells the desktop to take over now rather
        // than in sixteen seconds. A moment covers it — this is a local write
        // to a connection that is already up.
        scope.launch {
            delay(500)
            runCatching { remote.close() }
        }
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
     * Somebody pressed "Switch off" on the notification.
     *
     * Set by the activity, which is the only thing that can close itself. Off
     * has to mean the whole app and not just the service: a phone left showing
     * a chat screen it is no longer connected behind is worse than one that
     * simply went away, and leaving the activity up means reopening is a
     * resume rather than a launch — so nothing runs again and it comes back
     * connected to nothing.
     */
    var onSwitchOff: (() -> Unit)? = null

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
        (vault.setting(NOTIFY_ALL_KEY) as? JsonArray)?.let { list ->
            notifyAll = list.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
        }
        (vault.setting(IGNORES_KEY) as? JsonArray)?.let { ignores = readIgnores(it) }
        (vault.setting(HIGHLIGHTS_KEY) as? JsonArray)?.let { array ->
            store.highlightWords = array.mapNotNull { (it as? JsonPrimitive)?.content }
        }
        (vault.setting(ALIASES_KEY) as? JsonArray)?.let { storedAliases = readAliases(it) }
        (vault.setting(AWAY_MINUTES_KEY) as? JsonPrimitive)?.let {
            awayAfterMinutes = (it.contentOrNull()?.toIntOrNull() ?: 0).coerceAtLeast(0)
        }
        (vault.setting(AWAY_MESSAGE_KEY) as? JsonPrimitive)?.let {
            awayMessage = it.contentOrNull().orEmpty()
        }
        (vault.setting(REJOIN_KEY) as? JsonPrimitive)?.let {
            rejoinOnKick = it.booleanOrNull ?: false
        }
        (vault.setting(SHOW_JOINS_KEY) as? JsonPrimitive)?.let {
            showJoinsParts = it.booleanOrNull ?: false
            store.showJoinsParts = showJoinsParts
        }

        for (server in vault.servers()) {
            val watched = vault.watched(server.id)
            if (watched.isNotEmpty()) store.setWatched(server.id, watched)
        }

        // The config we have just opened, or just been handed, is the whole
        // list — not only the part of it that dials on its own.
        seedKnownServers()
    }

    fun lockVault() {
        vault.lock()
        releaseConnections()
    }

    /** Whether this phone has a config of its own, desktop or no desktop */
    val hasOwnConfig: Boolean get() = vault.exists

    /**
     * Whether the config we hold is one worth unlocking.
     *
     * The placeholder this phone makes for itself on first launch is not: it
     * is already open, nobody chose it, and there is nothing in it. Anything
     * else — a config shared from a desktop, or one made here and given a
     * passphrase — is.
     */
    val holdsSharedConfig: Boolean get() = vault.exists && !vault.isPlaceholder

    /**
     * How many networks this phone knows about, its own or a desktop's.
     *
     * The config first, then whatever a desktop has relayed. Reading only the
     * config meant a phone following a desktop — showing that desktop's
     * channel, on that desktop's network, with the network's name in the
     * header — was told "No networks yet", and offered an Add button that
     * would have made a second one nobody wanted.
     */
    val knownServers: Int get() {
        val configured = if (vault.isUnlocked) vault.servers().size else 0
        return if (configured > 0) configured else store.servers.size
    }

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

    /**
     * What this phone heard while it was the connection.
     *
     * It has no database: the store is what is on screen and Android may stop
     * the process at any time. So an evening spent holding the connections
     * used to end with those messages nowhere — gone from here on the next
     * restart, and never on the desktop at all unless the network happened to
     * offer `chathistory` for it to catch up from.
     *
     * They are kept here until the desktop is reachable and then handed over.
     * In memory on purpose: this is the same lifetime as the messages
     * themselves, and writing a queue to disk that outlived what it describes
     * would promise more than the rest of this client keeps.
     */
    /**
     * One hand-over at a time.
     *
     * A batch is dropped only once the desktop has taken it, so two flushes
     * running together would each drop what the other sent — and the second
     * drop would throw away messages nobody had ever handed anywhere.
     */
    private val handoverLock = kotlinx.coroutines.sync.Mutex()

    /**
     * Write a message down on this phone.
     *
     * [ours] is the difference between the two directions: a message this
     * phone heard on its own socket exists nowhere else until the desktop is
     * told, and is kept marked until it has been. One relayed from the desktop
     * is stored too — that is what lets the app open with the conversation
     * still in it — but there is nothing to hand back.
     */
    private fun record(channel: String, data: JsonElement, ours: Boolean) {
        when (channel) {
            "irc:message" -> keep(data, ours)

            // A correction and a retraction are part of what was said, and a
            // phone that kept only the first wording would hand the desktop
            // something nobody wrote
            "irc:edit" -> {
                val payload = data as? JsonObject ?: return
                val id = (payload["originalId"] as? JsonPrimitive)?.contentOrNull() ?: return
                val content = (payload["newContent"] as? JsonPrimitive)?.contentOrNull() ?: return
                val at = (payload["editedAt"] as? JsonPrimitive)?.contentOrNull().orEmpty()
                runCatching { history.edit(id, content, at) }
            }

            "irc:redact" -> {
                val payload = data as? JsonObject ?: return
                val id = (payload["msgid"] as? JsonPrimitive)?.contentOrNull() ?: return
                val by = (payload["by"] as? JsonPrimitive)?.contentOrNull() ?: "someone"
                runCatching { history.redact(id, by) }
            }

            // Somebody read this conversation — on the desktop, or on this
            // phone in an earlier run. Either way it is where the line goes.
            "irc:read-marker" -> {
                val payload = data as? JsonObject ?: return
                val server = (payload["serverId"] as? JsonPrimitive)?.contentOrNull() ?: return
                val channel = (payload["channel"] as? JsonPrimitive)?.contentOrNull() ?: return
                val at = (payload["timestamp"] as? JsonPrimitive)?.contentOrNull() ?: return
                runCatching { history.rememberReadMarker(server, channel, at) }
            }
        }
    }

    /**
     * Take everything the desktop heard while this phone was away.
     *
     * The other half of [handOverHistory]. That one gives the desktop what
     * only this phone heard; this takes what only the desktop heard, so the
     * two records agree again rather than drifting a little further apart
     * every time they are separated.
     *
     * Walked forward a page at a time from the newest thing held for each
     * network, because a phone that has been off for a week must not ask for
     * a week of a busy channel in one call. Capped: past a point this is no
     * longer catching up, and what is older than the cap is a scroll away
     * from the desktop whenever somebody actually opens the conversation.
     */
    internal suspend fun catchUpFromDesktop() {
        if (!remote.isLinked) return

        for (server in store.servers.keys.toList()) {
            var since = runCatching { history.newestFor(server) }.getOrNull() ?: EPOCH
            var pages = 0

            while (pages < CATCHUP_PAGES) {
                val page = ask(
                    "history:since",
                    JsonPrimitive(server),
                    JsonPrimitive(since),
                    JsonPrimitive(CATCHUP_PAGE)
                ) as? JsonArray ?: return

                if (page.isEmpty()) break

                var newest = since
                for (entry in page) {
                    val row = entry as? JsonObject ?: continue
                    val channel = (row["channel"] as? JsonPrimitive)?.contentOrNull() ?: continue
                    val at = (row["timestamp"] as? JsonPrimitive)?.contentOrNull().orEmpty()
                    // The desktop's own record, so nothing is owed back to it
                    runCatching {
                        history.remember(server, channel, row.toMessage(), needsHandover = false)
                    }
                    if (at > newest) newest = at
                }

                Log.i(TAG, "caught up ${page.size} message(s) on $server")
                pages++

                // A page that did not move the cursor would ask for the same
                // rows for ever
                if (newest == since) break
                since = newest
                if (page.size < CATCHUP_PAGE) break
            }
        }

        restoreHistory()
    }

    /** Put the phone's own record back into the conversations it belongs to */
    private fun restoreHistory() {
        runCatching {
            var newest: Pair<String, String>? = null
            var newestAt = ""

            for (conversation in history.conversations()) {
                val earlier = history.recent(conversation.serverId, conversation.channel)
                store.restore(conversation.serverId, conversation.channel, earlier)

                val last = earlier.lastOrNull()?.timestamp.orEmpty()
                if (last > newestAt) {
                    newestAt = last
                    newest = conversation.serverId to conversation.channel
                }
            }

            // Open on whatever was said most recently, the way it was left.
            // Only when nothing is chosen yet: a snapshot or a notification
            // tap has a better idea than this does.
            if (store.activeServerId == null) {
                newest?.let { (serverId, channel) -> store.select(serverId, channel) }
            }
        }.onFailure { Log.w(TAG, "could not read what was said last time", it) }
    }

    /** What this run of the app already knows, written down for the next one */
    internal fun rememberFetched(serverId: String, channel: String) {
        runCatching {
            for (message in store.messagesFor(serverId, channel)) {
                history.remember(serverId, channel, message, needsHandover = false)
            }
        }.onFailure { Log.w(TAG, "could not write fetched history down", it) }
    }

    private fun keep(data: JsonElement, ours: Boolean) {
        val payload = data as? JsonObject ?: return
        val serverId = (payload["serverId"] as? JsonPrimitive)?.contentOrNull() ?: return
        val channel = (payload["channel"] as? JsonPrimitive)?.contentOrNull() ?: return
        val body = payload["message"] as? JsonObject ?: return
        // Replayed history, which whoever replayed it already has
        if (body["historical"]?.jsonPrimitive?.booleanOrNull == true) return

        runCatching { history.remember(serverId, channel, body.toMessage(), needsHandover = ours) }
            .onFailure { Log.w(TAG, "could not write a message down", it) }
    }

    /**
     * Give the desktop what it missed.
     *
     * Safe to call whenever the link is up: the desktop writes with the
     * message id as the key, so a batch that arrives twice — a flush that
     * raced a reconnect, an answer this phone never heard — costs nothing.
     * Dropped from the queue only once the desktop has actually answered.
     */
    /**
     * Networks a peer has already refused, so it is said once and not per beat.
     *
     * Cleared when the shared config changes, because that is the one event
     * that can make a refusal stale.
     */
    private val refusedHandover = mutableSetOf<String>()

    internal suspend fun handOverHistory() {
        if (!remote.isLinked) return
        if (runCatching { history.pendingCount() }.getOrDefault(0) == 0) return

        handoverLock.withLock { handOverPending() }
    }

    private suspend fun handOverPending() {
        while (true) {
            val batch = runCatching { history.pendingHandover() }.getOrNull() ?: return

            /*
             * Messages for a network nobody has any more.
             *
             * The queue means "give these to whichever device is holding this
             * network". If this phone's own config no longer contains it —
             * because the shared config was replaced by one from another
             * device, and the two were different accounts on the same server —
             * then there is nobody to give them to, ever. They stayed queued
             * and were re-offered and refused every few seconds for as long as
             * the phone was linked.
             *
             * Taken out of the queue, not deleted: they are still the person's
             * history and still show in the conversation. Only the promise to
             * hand them somewhere is given up.
             */
            if (vault.isUnlocked && vault.servers().none { it.id == batch.serverId }) {
                Log.i(
                    TAG,
                    "${batch.rows.size} message(s) for ${batch.serverId} belong to a network " +
                        "nothing has any more; keeping them here and giving up on handing them on"
                )
                history.markHandedOver(batch.rows.map { (_, message) -> message.id })
                continue
            }

            val rows = JsonArray(
                batch.rows.map { (channel, message) ->
                    buildJsonObject {
                        put("id", JsonPrimitive(message.id))
                        put("channel", JsonPrimitive(channel))
                        put("nick", JsonPrimitive(message.nick))
                        put("content", JsonPrimitive(message.content))
                        put("timestamp", JsonPrimitive(message.timestamp))
                        put("type", JsonPrimitive(message.type))
                        message.replyTo?.let { put("replyTo", JsonPrimitive(it)) }
                        message.oper?.let { put("oper", JsonPrimitive(it)) }
                        message.relayedBy?.let { put("relayedBy", JsonPrimitive(it)) }
                    }
                }
            )

            val answer = ask("history:store", JsonPrimitive(batch.serverId), rows)
            if (answer == null) {
                /*
                 * They stay queued. It refuses outright for a network it does
                 * not have, which is exactly the case worth keeping them for —
                 * the config may still be on its way.
                 *
                 * Said once per network rather than every time. Two devices
                 * can hold the same server under different accounts, which are
                 * different networks and rightly do not merge; those messages
                 * are then refused for as long as the two are linked, and a
                 * warning on every attempt buries everything else in the log.
                 */
                if (refusedHandover.add(batch.serverId)) {
                    Log.w(
                        TAG,
                        "the other device would not take ${batch.rows.size} message(s) " +
                            "for ${batch.serverId}; keeping them here"
                    )
                }
                return
            }

            refusedHandover.remove(batch.serverId)
            Log.i(TAG, "handed ${batch.rows.size} message(s) on for ${batch.serverId}")
            history.markHandedOver(batch.rows.map { (_, message) -> message.id })
        }
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
        // Into the shared config as well as down the link. It is a shared
        // setting like the other ten, and a theme picked here with the desktop
        // asleep used to be told to nobody.
        shareSetting(THEME_SETTING to JsonPrimitive(id))
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
     * Conversations where every line rings, not only your name — keyed like
     * the mutes. Shared with the desktop: which channel you cannot miss a
     * word of is a fact about you, not about the phone.
     */
    var notifyAll by mutableStateOf<Set<String>>(emptySet())
        private set

    fun notifiesAll(serverId: String, channel: String): Boolean =
        notifyAll.contains("$serverId:${channel.lowercase()}")

    fun toggleNotifyAll(serverId: String, channel: String) {
        val key = "$serverId:${channel.lowercase()}"
        notifyAll = if (notifyAll.contains(key)) notifyAll - key else notifyAll + key
        val encoded = JsonArray(notifyAll.sorted().map { JsonPrimitive(it) })
        shareSetting(NOTIFY_ALL_KEY to encoded)
    }

    /**
     * Hold it, seal it, and tell the desktop.
     *
     * The vault write is what makes this survive a restart on a phone with no
     * desktop; the `settings:set` is what makes a mute show up over there
     * before the next vault exchange. Neither one is enough alone.
     */
    /**
     * People this client has been told not to hear from.
     *
     * Shared with the desktop rather than kept here: silencing somebody at the
     * desk and being messaged by them in your pocket is not a working ignore
     * list. See `src/shared/ignore.ts` for the matching, which both clients do
     * identically.
     */
    // Snapshot state rather than @Volatile: the settings screen lists these,
    // and a plain field changing tells Compose nothing — the list would sit
    // there stale until something else forced a redraw.
    var ignores: List<Ignore.Entry> by mutableStateOf(emptyList())
        private set

    /** Whether this is somebody we have decided not to hear from */
    internal fun isIgnored(
        serverId: String,
        nick: String,
        userHost: String?,
        kind: String = "messages"
    ): Boolean {
        if (ignores.isEmpty()) return false
        val at = userHost?.indexOf('@') ?: -1
        val who = Ignore.Who(
            nick = nick,
            user = if (at == -1) null else userHost?.substring(0, at),
            host = if (at == -1) userHost else userHost?.substring(at + 1)
        )
        return Ignore.isIgnored(ignores, serverId, who, kind)
    }

    /**
     * Whether this event is from somebody we have decided not to hear from.
     *
     * Applied to what the desktop relays as well as to what this phone reads
     * off a socket: the two clients share the list, so they must silence the
     * same people whichever of them is holding the connection.
     */
    private fun silenced(channel: String, data: JsonElement): Boolean {
        if (ignores.isEmpty()) return false
        val row = data as? JsonObject ?: return false
        val serverId = (row["serverId"] as? JsonPrimitive)?.content ?: return false

        // Messages and invitations only. Joins, parts and quits are what
        // keeps the member list right, so dropping them would leave somebody
        // you ignored in the roster after they left, for good.
        val kind = when (channel) {
            "irc:message" -> "messages"
            "irc:invite" -> "requests"
            else -> return false
        }

        // A message carries the sender under `message`; the rest name them
        // directly. An invite names whoever sent it as `from`.
        val message = row["message"] as? JsonObject
        val nick = (message?.get("nick") as? JsonPrimitive)?.content
            ?: (row["nick"] as? JsonPrimitive)?.content
            ?: (row["from"] as? JsonPrimitive)?.content
            ?: return false
        val userHost = (message?.get("userHost") as? JsonPrimitive)?.content
            ?: (row["userHost"] as? JsonPrimitive)?.content

        return isIgnored(serverId, nick, userHost, kind)
    }

    /**
     * Change the words that ring the same bell your nick does.
     *
     * Sealed and relayed the way a mute is: the vault write survives a restart
     * with no desktop, and `settings:set` reaches the other device before the
     * next vault exchange.
     */
    fun setHighlightWords(words: List<String>) {
        store.highlightWords = words
        val encoded = JsonArray(words.map { JsonPrimitive(it) })
        shareSetting(HIGHLIGHTS_KEY to encoded)
    }

    /**
     * Whether being kicked out of a channel means going back to it.
     *
     * Off unless asked for. Rejoining the instant an operator removes you is
     * rude, and on some networks it is what turns a kick into a ban.
     *
     * Shared with the desktop, because it is a preference about how you use
     * IRC rather than about a machine.
     */
    var rejoinOnKick by mutableStateOf(false)
        private set

    // Named for the action rather than the field: a property called
    // `rejoinOnKick` already generates a `setRejoinOnKick`, and the two collide
    // on the same JVM signature. The alias list has the same shape for the
    // same reason.
    fun setRejoinAfterKick(on: Boolean) {
        rejoinOnKick = on
        shareSetting(REJOIN_KEY to JsonPrimitive(on))
    }

    /**
     * Whether joins, parts and quits are lines in the conversation.
     *
     * Off by default: the member list already says who is here, and in a
     * busy channel these bury the talk. Shared with the desktop, because how
     * you like to read a channel is not a fact about the screen — see
     * [org.switchboard.android.irc.Events].
     */
    var showJoinsParts by mutableStateOf(false)
        private set

    fun setShowJoinsAndParts(on: Boolean) {
        showJoinsParts = on
        store.showJoinsParts = on
        shareSetting(SHOW_JOINS_KEY to JsonPrimitive(on))
    }

    /**
     * Go back, after a pause.
     *
     * The wait is not politeness theatre: an immediate JOIN races the `+b`
     * that usually follows a kick, gets refused, and has the client announce a
     * failure it caused itself. [REJOIN_AFTER_KICK_MS] is the desktop's number
     * too — see `src/shared/constants.ts`.
     */
    private fun rejoinAfterKick(serverId: String, data: JsonElement) {
        if (!rejoinOnKick) return
        val row = data as? JsonObject ?: return
        if (row["isMe"]?.jsonPrimitive?.booleanOrNull != true) return
        val channel = (row["channel"] as? JsonPrimitive)?.content ?: return

        scope.launch {
            delay(REJOIN_AFTER_KICK_MS)
            val connection = connections[serverId] ?: return@launch
            // Still connected, and not already back by hand
            if (!connection.isConnected) return@launch
            if (connection.state.channels.containsKey(connection.state.casemap(channel))) {
                return@launch
            }
            // Going back where we were, not deciding to go somewhere new
            connection.noteJoinRequest(channel, JoinReason.DIAL)
            connection.send("JOIN", channel)
        }
    }

    // ── away when nobody is there ─────────────────────────────────────

    /**
     * How long of nothing counts as away, and what to say when it does.
     *
     * Shared with the desktop, because how long you have to be gone before you
     * are gone is a fact about you rather than about the thing measuring it.
     * What each device measures is not shared and cannot be: the desktop asks
     * the system how long since any input, and this counts from the screen
     * going dark. See [IdleWatch] for why that is the honest answer here.
     */
    var awayAfterMinutes by mutableStateOf(0)
        private set

    var awayMessage by mutableStateOf("")
        private set

    /** Seconds since anybody touched this phone. Installed by the service. */
    var idleSeconds: () -> Long = { 0L }

    /**
     * Networks this put into away, so it only ever takes back its own.
     *
     * Somebody who typed `/away lunch` and then picked the phone up has not
     * come back from lunch.
     */
    private val awaySetByUs = mutableSetOf<String>()

    private var awayJob: Job? = null

    fun setAutoAway(minutes: Int, message: String) {
        awayAfterMinutes = minutes.coerceAtLeast(0)
        awayMessage = message
        shareSetting(
            AWAY_MINUTES_KEY to JsonPrimitive(awayAfterMinutes),
            AWAY_MESSAGE_KEY to JsonPrimitive(message)
        )
        // Switching it off should take back the away it set now, not in half a
        // minute, and switching it on with the phone already dark should act
        // now too.
        applyAutoAway()
    }

    /**
     * One look at the clock, across the networks this phone is holding.
     *
     * Only those: while the desktop holds a connection it is the desktop's
     * idle clock that governs it, and a phone in a pocket marking the desk
     * away would be this feature working against itself.
     *
     * Reached from three threads — the poll, the screen broadcast and the
     * alarm that fires through Doze — so it is serialised, and the map is
     * copied before walking it. Two of those would otherwise be able to send
     * the same AWAY twice, and one of them could walk the map while a
     * connection was being added to it.
     */
    @Synchronized
    internal fun applyAutoAway() {
        val idle = runCatching { idleSeconds() }.getOrDefault(0L)

        for ((serverId, connection) in connections.toList()) {
            if (!connection.isConnected) continue

            val action = AutoAway.action(
                idleSeconds = idle,
                afterMinutes = awayAfterMinutes,
                alreadyAway = connection.state.away,
                setByUs = serverId in awaySetByUs
            )

            when (action) {
                AutoAway.Action.SET -> {
                    connection.setAway(AutoAway.message(awayMessage))
                    awaySetByUs += serverId
                }

                AutoAway.Action.CLEAR -> {
                    connection.setAway(null)
                    awaySetByUs -= serverId
                }

                AutoAway.Action.NOTHING -> Unit
            }
        }
    }

    /**
     * Commands somebody made up themselves.
     *
     * Shared with the desktop: an alias that works at the desk and not in your
     * pocket is two clients, and the whole point of one is that it is shorter
     * than what it stands for.
     */
    // Snapshot state, for the same reason the ignore list is. Named for the
    // field rather than the thing, because a property called `aliases`
    // generates a `setAliases` that collides with the one below.
    private var storedAliases: List<Aliases.Alias> by mutableStateOf(emptyList())

    internal fun savedAliases(): List<Aliases.Alias> = storedAliases

    /** Change them, and seal them for the other device */
    fun setAliases(next: List<Aliases.Alias>) {
        storedAliases = next
        val encoded = JsonArray(
            next.map {
                buildJsonObject {
                    put("name", it.name)
                    put("expansion", it.expansion)
                }
            }
        )
        shareSetting(ALIASES_KEY to encoded)
    }

    private fun readAliases(array: JsonArray): List<Aliases.Alias> = array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        Aliases.Alias(
            name = (row["name"] as? JsonPrimitive)?.content ?: return@mapNotNull null,
            expansion = (row["expansion"] as? JsonPrimitive)?.content ?: return@mapNotNull null
        )
    }

    /**
     * Somebody offered a file.
     *
     * Recorded and shown; nothing connects until a person presses Accept.
     * Somebody on the ignore list is offering nothing, as far as this client
     * is concerned — an unsolicited file is exactly the sort of thing an
     * ignore is for.
     */
    private fun noteDccOffer(data: JsonElement) {
        val row = data as? JsonObject ?: return
        val serverId = (row["serverId"] as? JsonPrimitive)?.content ?: return
        val peer = (row["peer"] as? JsonPrimitive)?.content ?: return
        if (isIgnored(serverId, peer, null, "requests")) return

        val filename = (row["filename"] as? JsonPrimitive)?.content ?: return
        dcc.offered(
            serverId = serverId,
            peer = peer,
            filename = filename,
            address = (row["address"] as? JsonPrimitive)?.content ?: return,
            port = (row["port"] as? JsonPrimitive)?.content?.toIntOrNull() ?: return,
            size = (row["size"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0
        )

        // Say so in the conversation it belongs to. An offer from somebody you
        // have never messaged otherwise has nowhere to appear — and a line
        // saying what was offered is worth having afterwards either way.
        store.handleEvent("irc:message", buildJsonObject {
            put("serverId", serverId)
            put("channel", peer)
            put("message", buildJsonObject {
                put("id", java.util.UUID.randomUUID().toString())
                put("nick", "")
                put("content", "$peer is offering you $filename")
                put("type", "system")
                put("timestamp", java.time.Instant.now().toString())
            })
        })
    }

    /**
     * A bouncer, offering the networks it holds.
     *
     * Only from the connection bound to none of them — that one is talking to
     * the bouncer itself, and its list is news. A connection already bound to
     * a network is describing its siblings, which somebody has dealt with.
     *
     * The desktop has offered this since bouncer support landed and the phone
     * emitted the same event to nobody, so a phone reaching a soju with three
     * networks behind it got one network and no way to find the others. The
     * phone is now the only thing that will offer at all when what it follows
     * is a headless Switchboard, which has no screen to show a toast on.
     */
    private fun noteBouncerNetworks(data: JsonElement) {
        val row = data as? JsonObject ?: return
        val serverId = (row["serverId"] as? JsonPrimitive)?.content ?: return
        // `contentOrNull`, not a type test: `JsonNull` *is* a `JsonPrimitive`,
        // so asking whether this is one is asking nothing at all — and the
        // unbound connection, the only one worth listening to, is exactly the
        // one that sends null here.
        if ((row["boundTo"] as? JsonPrimitive)?.contentOrNull() != null) return

        val offered = (row["networks"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        if (offered.isEmpty()) return

        /*
         * Which ones are already here has to come from the config, because a
         * network id is the only thing that tells two of a bouncer's networks
         * apart. With the vault locked there is no config to read, and
         * offering to add what may already be there is worse than waiting
         * until it opens — the lines come again on the next connection.
         */
        if (!vault.isUnlocked) return
        val servers = vault.servers()
        val parent = servers.firstOrNull { it.id == serverId } ?: return
        val known = servers
            .filter { it.host == parent.host && it.port == parent.port }
            .mapNotNull { it.bouncerNetId }
            .toSet()

        val missing = offered.filter { network ->
            ((network["id"] as? JsonPrimitive)?.content ?: "") !in known
        }
        if (missing.isEmpty()) {
            // It was taken, or the desktop took it — either way there is
            // nothing left to ask about
            store.bouncerOffer = null
            return
        }

        store.bouncerOffer = BouncerOffer(
            serverId = serverId,
            bouncer = parent.name.ifBlank { parent.host },
            networks = missing.map { network ->
                fun text(key: String) = (network[key] as? JsonPrimitive)?.content.orEmpty()
                val host = text("host")
                OfferedNetwork(
                    id = text("id"),
                    name = text("name").ifBlank { host },
                    host = host,
                    port = text("port").toIntOrNull() ?: parent.port,
                    tls = (network["tls"] as? JsonPrimitive)?.content?.toBoolean() ?: parent.tls,
                    nickname = text("nickname")
                )
            }
        )
    }

    /** Stop hearing from whoever matches this mask */
    fun addIgnore(mask: String, network: String, scope: Ignore.Scope = Ignore.Scope()) {
        val wanted = Ignore.toMask(mask)
        if (wanted.isEmpty()) return
        applyIgnores(
            Ignore.with(
                ignores,
                Ignore.Entry(wanted, network, scope, System.currentTimeMillis())
            )
        )
    }

    /** Start hearing from them again */
    fun removeIgnore(mask: String, network: String) {
        applyIgnores(Ignore.without(ignores, mask, network))
    }

    /**
     * Hold it, seal it, and tell the desktop — the same three steps a mute
     * takes, and for the same reason: the vault write is what survives a
     * restart with no desktop, and `settings:set` is what reaches the other
     * device before the next vault exchange.
     */
    private fun applyIgnores(next: List<Ignore.Entry>) {
        ignores = next
        val encoded = writeIgnores(next)
        shareSetting(IGNORES_KEY to encoded)
    }

    private fun readIgnores(array: JsonArray): List<Ignore.Entry> = array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val scope = row["scope"] as? JsonObject
        Ignore.Entry(
            mask = (row["mask"] as? JsonPrimitive)?.content ?: return@mapNotNull null,
            network = (row["network"] as? JsonPrimitive)?.content ?: Ignore.EVERYWHERE,
            scope = Ignore.Scope(
                messages = (scope?.get("messages") as? JsonPrimitive)?.booleanOrNull ?: true,
                requests = (scope?.get("requests") as? JsonPrimitive)?.booleanOrNull ?: true
            ),
            added = (row["added"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0
        )
    }

    private fun writeIgnores(list: List<Ignore.Entry>): JsonArray = JsonArray(
        list.map { entry ->
            buildJsonObject {
                put("mask", entry.mask)
                put("network", entry.network)
                put("added", entry.added)
                put("scope", buildJsonObject {
                    put("messages", entry.scope.messages)
                    put("requests", entry.scope.requests)
                })
            }
        }
    )

    private fun applyMutes(next: Mutes) {
        mutes = next
        val encoded = next.toJson()
        shareSetting(MUTES_KEY to encoded)
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
            "servers=${vault.servers().size}, desktopHeld=${store.heldByDesktop.size}, " +
            "already=${connections.size}")

        if (vault.isUnlocked) {
            freeSeededProfiles()

            // What the desktop was holding, as well as what this phone would
            // open on its own. `autoConnect` answers "dial this when the app
            // starts", which is not the question here: standing in for a
            // desktop means taking the networks it actually had — and a
            // network somebody connected by hand is still a network they are
            // in the middle of using. A phone that took over and connected to
            // nothing looked exactly like one that had taken over correctly.
            for (config in vault.servers()) {
                if (config.autoConnect || config.id in store.heldByDesktop) openConnection(config)
            }
        }
        recomputeMode()
    }

    /**
     * Let the networks that were only ever given a copy follow you again.
     *
     * Adding a network used to copy your profile into it, so every network had
     * one of its own without anybody choosing that — and under the rule that a
     * network with its own profile ignores the global one, editing your name
     * would have changed nothing anywhere.
     *
     * Narrowed field by field rather than all or nothing: somebody who changed
     * their display name on one network got a whole frozen copy along with it,
     * and only the name was ever a choice. What matches the global goes back to
     * following it; what differs stays.
     *
     * The desktop does the same on startup, and whichever device gets there
     * first reseals for the other.
     */
    private fun freeSeededProfiles() {
        val global = vault.defaultProfile()
        val servers = vault.servers()
        var freed = 0
        val narrowed = servers.map { server ->
            if (!Profile.hasOverride(server.profile)) return@map server
            val kept = Profile.overrideFrom(global, server.profile).orEmpty()
            if (Profile.same(kept, server.profile)) return@map server
            freed++
            server.copy(profile = kept)
        }
        if (freed == 0) return

        Log.i(TAG, "$freed network(s) now follow your profile again")
        vault.reseal(narrowed, deviceName = "phone") ?: return
        noteVaultChanged()
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
        // A new connection knows nothing about who we watch, so the list has
        // to go out again once it says which command it takes
        friendListArmed.remove(config.id)
        pushOffered.remove(config.id)
        seedServer(config)
        val connection = IrcConnection(config, scope, { vault.defaultProfile() }, { savedProxy() }) { channel, data ->
            // Somebody on the ignore list said nothing, as far as this client
            // is concerned. Dropped before the store rather than hidden in the
            // UI: an ignored message that is kept still counts towards a badge
            // and still wakes the phone up.
            if (silenced(channel, data)) return@IrcConnection
            if (channel == "dcc:offer") {
                noteDccOffer(data)
                return@IrcConnection
            }
            if (channel == "irc:bouncer-networks") {
                noteBouncerNetworks(data)
                return@IrcConnection
            }
            store.handleEvent(channel, data)

            // Notifying was wired only to the desktop's relay, so a phone
            // holding its own connection — the case this whole client exists
            // for — never told anyone anything. Messages arrived, the badge
            // counted them, and the phone stayed dark.
            if (channel == "irc:message") notifyIfWorthIt(data)

            // This phone is the connection, so whatever this was exists here
            // and nowhere else until the desktop is told — see
            // [handOverHistory]
            record(channel, data, ours = true)

            rememberMembership(channel, data)

            /*
             * The network has just said which watch command it takes, which is
             * the first moment the friend list can go out at all — see the 005
             * handler. Doing it on `irc:connected` looked right and sent
             * nothing: that fires on 001, before any of this is known.
             */
            // Where to push, once this network has said enough for us to know
            // whether it can be asked — see [pushOffered].
            if (channel == "irc:isupport" && pushOffered.add(config.id)) {
                offerPushEndpoint(config.id)
            }

            if (channel == "irc:friendlist-ready") {
                (data as? JsonObject)?.get("serverId")?.jsonPrimitive?.contentOrNull()
                    ?.let { rearmMonitor(it) }
                return@IrcConnection
            }

            // Registering is the moment this phone stops dialling and starts
            // being the connection, and nothing else was watching for it: the
            // mode was worked out when the socket opened and never again, so a
            // phone that had been in two channels for ten minutes went on
            // saying "Connecting…" until something unrelated recomputed it.
            if (channel == "irc:connected") {
                lastConnectionError = null
                // On screen now; on the wire when 005 says which command to
                // use, which is after this — see `irc:friendlist-ready`
                loadWatched(config.id)
                if (!keptOurNameAlongside(config.id)) return@IrcConnection
                askWhatWeMissed(config.id)
                recomputeMode()
            }

            // Kicked, and told to go back.
            //
            // The desktop has done this since 2.2.0 and this did not, so what
            // happened after a kick depended on which device happened to be
            // holding the connection — which is exactly the seam the two
            // clients exist to hide.
            if (channel == "irc:kick") rejoinAfterKick(config.id, data)

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

            // Why we are not on. Only while there is no connection to speak
            // of: once we are in, an ordinary error is about a command rather
            // than about being able to get here at all.
            if (channel == "irc:error" && connections[config.id]?.isConnected != true) {
                (data as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull()
                    ?.let { lastConnectionError = it }
            }

            // Entering or leaving a backoff. Nothing else fires for an attempt
            // that never registered, so without this the screen keeps saying
            // "Connecting…" through a minute of deliberate waiting.
            if (channel == "irc:waiting") recomputeMode()
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
    /**
     * Files somebody has offered over DCC.
     *
     * Receiving only: sending needs a listening socket the other side can
     * reach, which behind mobile NAT it almost never can, and offering a
     * transfer that cannot complete is worse than not offering one.
     */
    val dcc = DccTransfers(context, scope)

    internal fun vaultServers(): List<ServerConfig> = vault.servers()

    /**
     * The proxy this phone dials through, if any.
     *
     * Kept on the device rather than in the shared config: a proxy describes
     * where you are, not who you are, and the desktop's is almost never the
     * one a phone on mobile data should use.
     */
    internal fun savedProxy(): Socks.Settings? {
        val type = prefs.getString(PROXY_TYPE, "none").orEmpty()
        if (type != "socks5" && type != "socks4") return null
        return Socks.Settings(
            type = type,
            host = prefs.getString(PROXY_HOST, "").orEmpty(),
            port = prefs.getInt(PROXY_PORT, 0),
            username = prefs.getString(PROXY_USER, "").orEmpty(),
            password = prefs.getString(PROXY_PASS, "").orEmpty()
        )
    }

    /** Remember a proxy, for the next dial */
    internal fun saveProxy(proxy: Socks.Settings) {
        prefs.edit()
            .putString(PROXY_TYPE, proxy.type)
            .putString(PROXY_HOST, proxy.host)
            .putInt(PROXY_PORT, proxy.port)
            .putString(PROXY_USER, proxy.username)
            .putString(PROXY_PASS, proxy.password)
            .apply()
    }

    /**
     * We changed the shared config ourselves.
     *
     * The desktop learns about it the same way we learn about its changes — an
     * offer carrying the new version, which it pulls if it is behind. Doing it
     * this way means a phone that adds a network while the desktop is asleep
     * does not have to remember to tell it later.
     */
    /**
     * A shared setting changed here.
     *
     * Written into this phone's copy of the shared config, offered to the
     * desktop, and told to the desktop directly as well. All three, because
     * either device can be the one that is away: the ask keeps a desktop that
     * is listening in step at once, and the offer is what a desktop that was
     * asleep picks up when it comes back.
     *
     * The offer was the missing half. A setting changed on the phone with no
     * desktop around was sealed at a higher version nobody was ever told
     * about, so the desktop's older offer was refused on the next link and the
     * two stayed apart until some desktop edit overtook the phone's version —
     * which then quietly threw the phone's change away.
     */
    private fun shareSetting(vararg pairs: Pair<String, JsonElement>) {
        for ((key, value) in pairs) vault.setSharedSetting(key, value)
        noteVaultChanged()
        scope.launch {
            for ((key, value) in pairs) ask("settings:set", JsonPrimitive(key), value)
        }
    }

    internal fun noteVaultChanged() {
        vaultVersion = vault.version
        // Credentials a network will accept are exactly the sort of thing that
        // turns its "no" into a "yes", so a config change is worth another try.
        refusedToShare.clear()
        seedKnownServers()
        // Never the config this phone made for itself: nobody chose it, there
        // is nothing in it, and a desktop that adopted it would be left with
        // an empty server list.
        if (vault.isPlaceholder) return
        scope.launch {
            runCatching {
                remote.sendPeerFrame(buildJsonObject {
                    put("t", JsonPrimitive("vault-offer"))
                    put("version", JsonPrimitive(vault.version))
                    put("updatedAt", JsonPrimitive(vault.sealedEnvelope()?.updatedAt.orEmpty()))
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

        // The connections may be the desktop's again; so is what was said on
        // them. Before the early return below, because a network both devices
        // can share leaves nothing to release and the messages still have to
        // go somewhere.
        scope.launch { handOverHistory() }

        // Asked more than once — the coordinator reconciles as well as
        // transitions — and there is nothing to say when there is nothing to
        // hand over.
        if (handing.isEmpty()) return

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
        val connection = connections[serverId]

        /*
         * A bouncer takes both of us, whatever the config says.
         *
         * It is built to multiplex, so there is no nick to collide over and no
         * credentials needed to prove the second connection is also us — the
         * bouncer already knows. Following the desktop off one would give up
         * the exact thing somebody ran a bouncer for.
         *
         * Asked of the live connection rather than the config, because it is
         * not something you configure. It is what the far end says about
         * itself, and it changes the day somebody moves a network behind one.
         */
        if (connection != null &&
            // What the server offered, not what we asked for: whether this is
            // a bouncer is a fact about the far end
            Bouncer.isBouncer(connection.state.isupport, connection.state.available.keys)
        ) {
            return true
        }

        if (!canShareConnection(config)) return false

        if (connection == null) return false
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

        // The link is the only way what this phone heard while it was the
        // connection ever reaches a disk. Cheap when there is nothing waiting,
        // and this runs on every change of state — which includes the link
        // coming back, which is exactly when it matters.
        if (remote.isLinked) scope.launch { handOverHistory() }

        // Both of us on the same networks at once, which is the ordinary case
        // wherever the server allows it: nobody is standing in for anybody, and
        // there is nothing to wait for when you pick up the other device.
        sharingWithDesktop = live && !primary && remote.isLinked

        // Whether there is another device in the picture at all. Most of what
        // follows reads completely differently depending on it, and for a
        // phone used on its own the answer is no — which used to be the case
        // none of these messages were written for.
        pairedWithDesktop = hasPairedDesktop() || remote.isLinked

        /*
         * What this phone is following, when it is following something.
         *
         * A desktop and an always-on instance are not the same thing to
         * somebody looking at the badge and wondering why their phone is not
         * holding the connection. Told apart by rank, which is the one thing
         * every peer advertises.
         */
        followingAlwaysOn = coordinator.state().peers.values.any { it.priority >= SERVER_PRIORITY }

        /*
         * Whether everything this phone holds is reached through a bouncer.
         *
         * All rather than any, because the word on the pill has to be true of
         * the whole picture: with one network through a soju and two straight
         * to the server, this phone is the one on those two and `LIVE` is the
         * honest word.
         */
        val held = connections.values.filter { it.isConnected }
        allThroughBouncer = held.isNotEmpty() &&
            held.all { Bouncer.isBouncer(it.state.isupport, it.state.available.keys) }

        // Sitting out a backoff is not dialling. The two look identical from
        // here and read completely differently to somebody watching: a client
        // that has been told to slow down and is doing so says so, rather than
        // showing "Connecting" for the minute it has been asked to wait.
        val waitingFor = connections.values
            .map { it.waitingUntil }
            .filter { it > 0 }
            .minOrNull()
            ?.minus(System.currentTimeMillis())
            ?.coerceAtLeast(0L)

        isTakingOver = dialling
        // A config that arrived from a desktop and has not been opened. A
        // config made here is open already, so this is never about that.
        //
        // Not gated on the desktop being away. Knowing the passphrase before
        // the desktop stops is exactly what makes taking over instant — asking
        // for it afterwards means the handover waits on somebody typing.
        needsPassphrase = !vault.isUnlocked && holdsSharedConfig
        needsPairing = false
        // And only where there is genuinely nothing to open. The phone used to
        // say this while holding the desktop's config, because locked and
        // absent were the same test.
        needsSharedConfig = pairedWithDesktop && !vault.isUnlocked && !holdsSharedConfig

        modeDetail = when {
            state.claiming -> "Asking the desktop to hand over…"
            sharingWithDesktop -> "On the same networks as your desktop"
            // Says which thing, so it cannot contradict the word on the pill
            live && allThroughBouncer -> "A bouncer is holding the connections"
            live && pairedWithDesktop -> "This phone is holding the connections"
            live -> "Connected"
            dialling && pairedWithDesktop ->
                lastConnectionError?.let { "Taking over — $it" } ?: "Taking over — connecting…"
            // Told to slow down, and doing it. Deliberately not a countdown:
            // this is worked out when something happens, and nothing happens
            // during a wait — a "Waiting 60s" computed once would still say 60
            // a minute later. The reason is the server's own words, which is
            // the only thing here that says why.
            waitingFor != null && waitingFor >= Reconnect.THROTTLED_FLOOR_MS / 2 ->
                lastConnectionError?.let { "Waiting before trying again — $it" }
                    ?: "Waiting before trying again"

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
    /**
     * Every network in the config on the rail, connected or not.
     *
     * The rail used to be built out of the connections, so a network with
     * "connect automatically" off was invisible on this phone — configured,
     * shared, and nowhere to be seen or tapped. It showed up if you had just
     * added it here, because that path seeded it, and vanished at the next
     * restart.
     *
     * Never over the top of a row already there: seeding writes it as
     * disconnected, and that row is where the green dot is read from.
     */
    private fun seedKnownServers() {
        for (config in vault.servers()) {
            if (store.servers.containsKey(config.id)) continue
            seedServer(config)
        }

        // And drop what the shared config no longer lists. This only ever
        // added, so every network the phone had ever seen stayed on the rail
        // for good — the same server under two ids showed up twice, and a
        // network removed on the desktop never went away here.
        val configured = vault.servers().map { it.id }.toSet()
        if (configured.isEmpty()) return

        for (id in store.servers.keys.toList()) {
            if (id in configured || connections.containsKey(id)) continue
            Log.i(TAG, "dropping $id; the shared config no longer lists it")
            store.forgetServer(id)
            runCatching { history.forgetServer(id) }
        }

        // And anything left in the database for a network that is not listed
        // at all. These are what a spell of disagreement leaves behind: rows
        // caught up from the desktop under an id it has since stopped using,
        // belonging to no network here and reachable from nothing.
        runCatching {
            for (id in history.knownServers()) {
                if (id in configured || connections.containsKey(id)) continue
                Log.i(TAG, "dropping stored messages for $id; no such network")
                history.forgetServer(id)
            }
        }
    }

    /**
     * Move what is stored for a network onto the id the config knows it by.
     *
     * Before the prune, or the rows would be dropped as belonging to a network
     * that is no longer listed — which is exactly what they are, under an id
     * nobody uses any more.
     */
    private fun applyReidentified(moves: Map<String, String>) {
        for ((from, to) in moves) {
            Log.i(TAG, "the shared config knows $from as $to; moving what is stored")
            runCatching { history.reidentify(from, to) }
            store.servers.remove(from)
        }
    }

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
                        vaultVersion = frame["vaultVersion"]?.jsonPrimitive?.int ?: 0,
                        holding = frame["holding"]?.jsonArray
                            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull() }
                            .orEmpty(),
                        // Absent from a peer on an older build, which reads as
                        // "I can see nobody holding" — what it used to mean
                        following = frame["following"]?.jsonPrimitive?.intOrNull
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
                // Ask whenever theirs might win, which is the adopter's rule
                // and not a stricter one. It used to be `>`, so two configs at
                // the same version never spoke — and the tiebreak both devices
                // implement for exactly that case could never be reached.
                val offered = frame["version"]?.jsonPrimitive?.int ?: 0
                val sealedAt = frame["updatedAt"]?.jsonPrimitive?.contentOrNull().orEmpty()
                if (vault.mightAdopt(offered, sealedAt)) requestVault()
            }

            "vault-request" -> {
                // The desktop is behind us — offer what we hold. Never the
                // config this phone made for itself: nobody chose it, there is
                // nothing in it, and handing it to a desktop that adopted it
                // would empty that desktop's server list.
                if (vault.isPlaceholder) return
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
                /*
                 * The guard belongs to the result, not to the renaming.
                 *
                 * It used to hang off the end of the `reidentified` chain,
                 * where it also fired whenever there was nothing to rename —
                 * which is the ordinary case. A config adopted from another
                 * device with the same network ids then returned here and
                 * never reached `applySharedState`, so the version, the status
                 * line and the connections were all left on the old one.
                 */
                val result = runCatching { vault.accept(VaultCrypto.decode(envelope)) }.getOrNull()
                    ?: return

                result.reidentified.takeIf { it.isNotEmpty() }?.let { applyReidentified(it) }

                // A config that has changed is the one event that can make a
                // refused hand-over worth trying again
                if (result.accepted) refusedHandover.clear()

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
            put("holding", buildJsonArray { frame.holding.forEach { add(JsonPrimitive(it)) } })
            // Left out rather than sent null, so a peer that reads it as
            // absent and one that reads it as null agree
            frame.following?.let { put("following", JsonPrimitive(it)) }
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

        /** The shared-settings name for the theme; [THEME_KEY] is this phone's own copy */
        const val THEME_SETTING = "theme"

        /** How many messages to take from the desktop in one call */
        const val CATCHUP_PAGE = 250

        /** And how many of those calls before this stops being catching up */
        const val CATCHUP_PAGES = 8

        /** Everything, for a network this phone holds nothing for yet */
        private const val EPOCH = "1970-01-01T00:00:00.000Z"
        const val NOTIFY_ALL_KEY = "notifyAll"

        /** And the one they keep the ignore list in */
        const val IGNORES_KEY = "ignores"

        /** And the words that ring the same bell your nick does */
        const val HIGHLIGHTS_KEY = "highlights"

        /** And the commands somebody made up themselves */
        const val ALIASES_KEY = "aliases"

        /** And how long of nothing counts as away, and what to say then */
        const val AWAY_MINUTES_KEY = "autoAwayMinutes"
        const val AWAY_MESSAGE_KEY = "autoAwayMessage"

        /** How often to look at the idle clock */
        const val AWAY_TICK_MS = 30_000L

        /** And whether a kick means going back */
        const val REJOIN_KEY = "rejoinOnKick"
        const val SHOW_JOINS_KEY = "showJoinsParts"

        /**
         * How long to wait before going back.
         *
         * The desktop holds the same number in `src/shared/constants.ts`; they
         * have to agree, or a kick looks different depending on which device
         * happened to be holding the connection.
         */
        const val REJOIN_AFTER_KICK_MS = 5_000L

        // Where this phone's proxy is kept. On the device, not in the shared
        // config: a proxy describes where you are, and the desktop's is almost
        // never the one a phone on mobile data should use.
        const val PROXY_TYPE = "proxy.type"
        const val PROXY_HOST = "proxy.host"
        const val PROXY_PORT = "proxy.port"
        const val PROXY_USER = "proxy.username"
        const val PROXY_PASS = "proxy.password"
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
