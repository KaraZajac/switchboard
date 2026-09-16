package org.switchboard.android

import android.content.Intent
import org.switchboard.android.PendingShare
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.delay
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.irc.IrcUrl
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.luminance
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.switchboard.android.pairing.Pairing
import org.switchboard.android.pairing.PairingPayload
import org.switchboard.android.ui.Base
import org.switchboard.android.ui.Blue
import org.switchboard.android.ui.BrowseScreen
import org.switchboard.android.ui.AccountScreen
import org.switchboard.android.ui.ChatScreen
import org.switchboard.android.ui.FriendsScreen
import org.switchboard.android.ui.MentionsScreen
import org.switchboard.android.ui.SearchScreen
import org.switchboard.android.ui.ServersScreen
import org.switchboard.android.ui.Mantle
import org.switchboard.android.ui.PairingScreen
import org.switchboard.android.ui.ScannerScreen
import org.switchboard.android.ui.SettingsScreen
import org.switchboard.android.readMarkerFor

/**
 * Switchboard for Android.
 *
 * Not a remote control for the desktop and not a separate client either — both,
 * depending on what is running. While the desktop is up this is a second window
 * onto it; when it goes away this phone unseals the shared config and becomes
 * the connection itself, then hands back when the desktop returns.
 */
class MainActivity : ComponentActivity() {

    /**
     * The engine belongs to the process, not to this screen.
     *
     * An activity-scoped engine stops being a standby connection the moment
     * someone presses Home.
     */
    private val engine: SwitchboardEngine
        get() = (application as SwitchboardApp).engine

    /** A pairing link the phone was opened with, consumed once */
    private var launchPairing by mutableStateOf<PairingPayload?>(null)

    /** The conversation a tapped notification was about, consumed once */
    private var launchConversation by mutableStateOf<Conversation?>(null)
    /** An irc:// link the system handed over — see [IrcUrl] */
    private var launchLink by mutableStateOf<IrcUrl.Link?>(null)
    /** Text or a picture shared from another app, waiting for a conversation */
    private var launchShare by mutableStateOf<PendingShare?>(null)

    private val askNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* the service runs either way; without this its notification is silent */ }

    override fun onResume() {
        super.onResume()
        // While a screen is up, a message you can see is not worth a notification
        engine.isForeground = true
    }

    override fun onPause() {
        super.onPause()
        engine.isForeground = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launchPairing = pairingFrom(intent)
        launchConversation = conversationFrom(intent)
        launchLink = linkFrom(intent)
        launchShare = shareFrom(intent)

        // Android 13+ will not show the foreground-service notification without
        // this, and a foreground service with no visible notification is a
        // service the user cannot see or stop.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }

        SwitchboardService.start(this)

        setContent {
            App(
                engine,
                lifecycleScope,
                launchPairing,
                onPairingConsumed = { launchPairing = null },
                launchConversation = launchConversation,
                onConversationConsumed = { launchConversation = null },
                launchLink = launchLink,
                onLinkConsumed = { launchLink = null },
                launchShare = launchShare,
                onShareConsumed = { launchShare = null }
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Scanned with the system camera while we were already open
        pairingFrom(intent)?.let { launchPairing = it }
        // A notification tapped while we were already open
        conversationFrom(intent)?.let { launchConversation = it }
        linkFrom(intent)?.let { launchLink = it }
        shareFrom(intent)?.let { launchShare = it }
    }

    /** An irc:// or ircs:// link, if that is what opened us */
    private fun linkFrom(intent: Intent?): IrcUrl.Link? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        val scheme = intent.data?.scheme?.lowercase() ?: return null
        if (scheme != "irc" && scheme != "ircs") return null
        return intent.dataString?.let { IrcUrl.parse(it) }
    }

    /** Text or a picture another app shared with us */
    private fun shareFrom(intent: Intent?): PendingShare? {
        if (intent?.action != Intent.ACTION_SEND) return null
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        @Suppress("DEPRECATION")
        val stream = intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
        if (text.isNullOrBlank() && stream == null) return null
        return PendingShare(text = text?.trim()?.takeIf { it.isNotEmpty() }, image = stream)
    }

    private fun pairingFrom(intent: Intent?): PairingPayload? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        return intent.dataString?.let { Pairing.parse(it) }
    }

    /**
     * What a notification named, if this intent came from one.
     *
     * The tap intent carried the conversation from the day notifications were
     * written, and nothing read it: a tap opened Switchboard on whatever was
     * up last and left you to find the message yourself.
     */
    private fun conversationFrom(intent: Intent?): Conversation? {
        val serverId = intent?.getStringExtra(Notifier.EXTRA_SERVER) ?: return null
        val channel = intent.getStringExtra(Notifier.EXTRA_CHANNEL) ?: return null
        return Conversation(serverId, channel)
    }

    // Nothing is torn down here on purpose: leaving this screen must not take
    // the connection with it. The service decides when the engine stops.
}

private enum class Screen { PAIRING, SCANNING, CHAT, SETTINGS, SEARCH, MENTIONS, FRIENDS, BROWSE, SERVERS, ACCOUNT }

/** One conversation on one network, as a notification names it */
data class Conversation(val serverId: String, val channel: String)

@Composable
fun App(
    engine: SwitchboardEngine,
    scope: CoroutineScope,
    launchPairing: PairingPayload? = null,
    onPairingConsumed: () -> Unit = {},
    launchConversation: Conversation? = null,
    onConversationConsumed: () -> Unit = {},
    launchLink: IrcUrl.Link? = null,
    onLinkConsumed: () -> Unit = {},
    launchShare: PendingShare? = null,
    onShareConsumed: () -> Unit = {}
) {
    var screen by remember {
        mutableStateOf(
            // A phone that has paired before opens straight into the conversation,
            // and one that holds an unlocked vault can work with no desktop at all.
            // Never the pairing screen. This phone is a client on its own and
            // has a config from the moment it starts; pairing a desktop is
            // something you go and do, from Settings, if you want the two to
            // share one.
            Screen.CHAT
        )
    }
    /** Which network the networks screen should open on, if a rail long-press sent us there */
    var editingServer by remember { mutableStateOf<String?>(null) }
    /** And which one the account screen is about */
    var accountFor by remember { mutableStateOf<String?>(null) }
    val store = engine.store

    /**
     * Pull the same snapshot the desktop window rebuilds itself from.
     *
     * Safe to call repeatedly: it replaces channels and members wholesale, and
     * history is only fetched for a conversation that has none.
     */
    suspend fun refill() {
        runCatching {
            val servers = engine.remote.call("server:list")
            val snapshot = engine.remote.call("app:renderer-ready")
            store.applySnapshot(snapshot, servers)

            // Whatever this phone heard while it was the connection. The
            // desktop kept nothing of that time, and this is the only copy.
            engine.handOverHistory()

            // And the other direction: whatever the desktop heard while this
            // phone was away. Both, every time they meet, or the two records
            // drift a little further apart on each separation.
            engine.catchUpFromDesktop()

            store.activeServerId?.let { serverId ->
                store.activeChannel?.let { channel -> loadHistory(engine, serverId, channel) }
            }
        }
    }

    /** Pair or re-dial, then adopt what the desktop knows. */
    suspend fun connect(ticket: String, code: String?) {
        try {
            store.status = "Connecting…"
            engine.connectToDesktop(ticket, code, Build.MODEL ?: "Android", engine.identity.secretKey())
            engine.syncTheme()
            refill()

            engine.identity.rememberTicket(ticket)
            // The engine works out what to tell the user from whether a ticket
            // exists, and one does now.
            engine.refreshMode()
            screen = Screen.CHAT
        } catch (e: Exception) {
            store.status = "Could not reach the desktop: ${e.message}"
            // Not fatal: with the vault unlocked the coordinator notices there
            // is no peer, and this phone becomes the connection instead.
        }
    }

    // Opening a conversation clears what was waiting in it — and again whenever
    // something new arrives while you are looking, because reading it as it
    // lands is still reading it. Keyed on the newest message rather than only on
    // the selection: at the moment a channel is picked its history has not
    // arrived, so there is nothing yet to say we have read.
    val newestHere = store.activeServerId?.let { serverId ->
        store.activeChannel?.let { store.messagesFor(serverId, it).lastOrNull()?.id }
    }
    LaunchedEffect(store.activeServerId, store.activeChannel, newestHere) {
        val serverId = store.activeServerId ?: return@LaunchedEffect
        val channel = store.activeChannel ?: return@LaunchedEffect
        if (engine.isForeground) engine.markRead(serverId, channel)
    }

    LaunchedEffect(Unit) {
        // After a re-dial the desktop may have moved on without us
        engine.onRelinked = { scope.launch { refill() } }
        engine.start()

        engine.identity.ticket()?.let { connect(it, null) }
    }

    /*
     * A pairing link this phone was opened with — asked about, never obeyed.
     *
     * `switchboard://pair?ticket=…&code=…` is an exported intent, so anything
     * on the phone can send one: a web page, a message, another app. It used
     * to dial straight out and remember the ticket, which meant a link somebody
     * tapped could quietly re-pair their phone to a stranger's desktop — and
     * from then on that desktop is where their conversations go.
     *
     * The QR carries the code as well as the ticket, which is safe precisely
     * because a QR is scanned off the screen in front of you. A link is not,
     * and the design note in `src/shared/pairing.ts` says so. One tap is what
     * puts a person back in front of it.
     *
     * The in-app scanner and the paste-a-ticket button are untouched: those
     * are already somebody choosing.
     */
    var pairingAsked by remember { mutableStateOf<PairingPayload?>(null) }
    LaunchedEffect(launchPairing?.ticket) {
        pairingAsked = launchPairing
    }

    /*
     * A notification tapped: go where it was about.
     *
     * Straight to the conversation, whichever screen was up. On a cold start
     * the store is still filling from the vault, so wait for the network to
     * exist rather than selecting into nothing — the same wait a join gets.
     * The name is matched against what the store knows so a channel keeps its
     * spelling; a nick not seen yet is opened as it was said.
     */
    // An irc:// link. A network we have is joined, connected first if it
    // has to be; one we do not have is added with the nick from another,
    // since a link is how somebody was told to come and see. See [IrcUrl].
    LaunchedEffect(launchLink) {
        val link = launchLink ?: return@LaunchedEffect
        onLinkConsumed()
        val servers = engine.listServers()
        // Host *and* port — see the desktop's `openIrcLink`. Two networks on
        // one address is ordinary for anyone running their own server.
        val sameHost = servers.filter { it.host.equals(link.host, ignoreCase = true) }
        val known = sameHost.firstOrNull { it.port == link.port } ?: sameHost.firstOrNull()
        val target = link.channel ?: link.nick
        if (known != null) {
            if (store.servers[known.id]?.connected != true) engine.connectServer(known.id)
            if (link.channel != null) {
                // Joined once the network answers, or now if it already has
                withTimeoutOrNull(20_000) {
                    while (store.servers[known.id]?.connected != true) delay(250)
                }
                engine.join(known.id, link.channel)
            }
            if (target != null) {
                store.dmMode = !isChannel(target)
                store.select(known.id, target)
                screen = Screen.CHAT
            }
        } else {
            val nick = servers.firstOrNull()?.nick ?: "switchboard"
            val id = engine.addServer(
                ServerConfig(
                    id = "",
                    name = link.host,
                    host = link.host,
                    port = link.port,
                    tls = link.tls,
                    nick = nick,
                    autoJoin = listOfNotNull(link.channel)
                )
            )
            if (id != null) {
                engine.connectServer(id)
                if (target != null) {
                    store.dmMode = !isChannel(target)
                    store.select(id, target)
                }
                screen = Screen.CHAT
            }
        }
    }

    // Something shared from another app: held until the user picks the
    // conversation it is for, which the chat screen offers a button for
    LaunchedEffect(launchShare) {
        val share = launchShare ?: return@LaunchedEffect
        onShareConsumed()
        store.pendingShare = share
        screen = Screen.CHAT
    }

    LaunchedEffect(launchConversation) {
        val (serverId, channel) = launchConversation ?: return@LaunchedEffect
        onConversationConsumed()
        repeat(40) {
            if (store.servers.containsKey(serverId)) {
                val known = store.channelsFor(serverId)
                    .firstOrNull { it.name.equals(channel, ignoreCase = true) }?.name ?: channel
                // The rail's mode follows the conversation: a direct message
                // is read from the messages list, a channel from its network
                store.dmMode = !isChannel(known)
                store.select(serverId, known)
                loadHistory(engine, serverId, known)
                screen = Screen.CHAT
                return@LaunchedEffect
            }
            kotlinx.coroutines.delay(250)
        }
    }

    // Back leaves a secondary screen rather than the app. Without this, tapping
    // back out of search closes Switchboard, which is not what back means
    // anywhere else on the phone.
    androidx.activity.compose.BackHandler(enabled = screen != Screen.CHAT && screen != Screen.PAIRING) {
        screen = if (screen == Screen.SCANNING) Screen.PAIRING else Screen.CHAT
    }

    // Light themes exist — Catppuccin Latte among them — and handing Material a
    // dark scheme for one gives white text on a white sheet. The theme's own
    // background says which it is; nothing else has to know.
    val palette = org.switchboard.android.ui.theme
    val scheme = if (palette.base.luminance() > 0.5f) {
        lightColorScheme(
            primary = Blue,
            background = Base,
            surface = Mantle,
            onSurface = org.switchboard.android.ui.Text0
        )
    } else {
        darkColorScheme(
            primary = Blue,
            background = Base,
            surface = Mantle,
            onSurface = org.switchboard.android.ui.Text0
        )
    }

    MaterialTheme(colorScheme = scheme) {
        Surface(modifier = Modifier.fillMaxSize(), color = Base) {
            pairingAsked?.let { payload ->
                AlertDialog(
                    onDismissRequest = { pairingAsked = null; onPairingConsumed() },
                    // Not "a desktop": the other end may be a Switchboard
                    // running on a server, which is the setup somebody is most
                    // likely to be pairing into deliberately
                    title = { Text("Pair with another Switchboard?") },
                    text = {
                        Text(
                            "Something asked this phone to pair with another computer " +
                                "running Switchboard. Only continue if you have just " +
                                "scanned a QR code on your own computer, or pasted a ticket " +
                                "you printed yourself.\n\nPairing replaces whatever this " +
                                "phone is paired with now."
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            pairingAsked = null
                            scope.launch {
                                try {
                                    connect(payload.ticket, payload.code)
                                } finally {
                                    onPairingConsumed()
                                }
                            }
                        }) { Text("Pair") }
                    },
                    dismissButton = {
                        TextButton(onClick = { pairingAsked = null; onPairingConsumed() }) {
                            Text("Not now")
                        }
                    }
                )
            }

            when (screen) {
                Screen.PAIRING -> PairingScreen(
                    status = store.status,
                    onScan = { screen = Screen.SCANNING },
                    onPair = { ticket, code -> scope.launch { connect(ticket, code) } },
                    onBack = { screen = Screen.SETTINGS }
                )

                Screen.SCANNING -> ScannerScreen(
                    onScanned = { payload ->
                        screen = Screen.PAIRING
                        scope.launch { connect(payload.ticket, payload.code) }
                    },
                    onEnterManually = { screen = Screen.PAIRING },
                    onBack = { screen = Screen.PAIRING }
                )

                Screen.CHAT -> ChatScreen(
                    engine = engine,
                    onOpenSettings = { screen = Screen.SETTINGS },
                    onOpenSearch = { screen = Screen.SEARCH },
                    onOpenMentions = { screen = Screen.MENTIONS },
                    onOpenFriends = { screen = Screen.FRIENDS },
                    onOpenBrowse = { screen = Screen.BROWSE },
                    onOpenServers = {
                        editingServer = null
                        screen = Screen.SERVERS
                    },
                    onEditServer = { serverId ->
                        editingServer = serverId
                        screen = Screen.SERVERS
                    },
                    onOpenAccount = { serverId ->
                        accountFor = serverId
                        screen = Screen.ACCOUNT
                    },
                    onLoadHistory = { serverId, channel ->
                        scope.launch { loadHistory(engine, serverId, channel) }
                    }
                )

                Screen.SEARCH -> SearchScreen(
                    engine = engine,
                    onOpen = { serverId, channel ->
                        store.select(serverId, channel)
                        scope.launch { loadHistory(engine, serverId, channel) }
                        screen = Screen.CHAT
                    },
                    onClose = { screen = Screen.CHAT }
                )

                Screen.MENTIONS -> MentionsScreen(
                    engine = engine,
                    onOpen = { serverId, channel ->
                        store.select(serverId, channel)
                        scope.launch { loadHistory(engine, serverId, channel) }
                        screen = Screen.CHAT
                    },
                    onClose = { screen = Screen.CHAT }
                )

                Screen.FRIENDS -> FriendsScreen(
                    engine = engine,
                    onOpen = { serverId, nick ->
                        store.openConversation(serverId, nick)
                        store.select(serverId, nick)
                        scope.launch { loadHistory(engine, serverId, nick) }
                        screen = Screen.CHAT
                    },
                    onClose = { screen = Screen.CHAT }
                )

                Screen.BROWSE -> BrowseScreen(
                    engine = engine,
                    onJoin = { serverId, channel ->
                        engine.join(serverId, channel)
                        // Joining is how you get somewhere, so go there. The
                        // channel does not exist for us yet — select() would
                        // find nothing — so wait for the JOIN to come back.
                        scope.launch { openWhenJoined(engine, serverId, channel) }
                        screen = Screen.CHAT
                    },
                    onClose = { screen = Screen.CHAT }
                )

                Screen.ACCOUNT -> AccountScreen(
                    engine = engine,
                    serverId = accountFor ?: store.activeServerId.orEmpty(),
                    onClose = { screen = Screen.CHAT }
                )

                Screen.SERVERS -> ServersScreen(
                    engine = engine,
                    onClose = {
                        editingServer = null
                        screen = Screen.CHAT
                    },
                    editServerId = editingServer
                )

                Screen.SETTINGS -> SettingsScreen(
                    engine = engine,
                    onBack = { screen = Screen.CHAT },
                    onManageServers = {
                        editingServer = null
                        screen = Screen.SERVERS
                    },
                    onPairDesktop = { screen = Screen.PAIRING },
                    onUnpair = {
                        engine.identity.forgetTicket()
                        scope.launch { engine.remote.close() }
                        screen = Screen.PAIRING
                    }
                )
            }
        }
    }
}

/**
 * How much of a conversation to pull when opening it.
 *
 * A phone shows about a dozen messages. Pulling a hundred over the link on
 * every channel switch spends the user's battery on text nobody scrolls to —
 * and scrolling up fetches more, so the depth is still there when wanted.
 */
private const val HISTORY_FIRST_PAGE = 50

/**
 * Follow a JOIN we asked for into the channel.
 *
 * The channel is not ours until the server says so, and on a slow link that is
 * a second or two after the tap. Selecting it early would land on an empty
 * conversation the store then replaces underneath the reader.
 */
private suspend fun openWhenJoined(
    engine: SwitchboardEngine,
    serverId: String,
    channel: String
) {
    repeat(20) {
        if (engine.store.channelsFor(serverId).any { it.name.equals(channel, true) }) {
            engine.store.select(serverId, channel)
            loadHistory(engine, serverId, channel)
            return
        }
        kotlinx.coroutines.delay(250)
    }
}

/**
 * Backfill a conversation.
 *
 * Only meaningful while the desktop is holding the connections — it is the one
 * with the database. When this phone is the connection, history starts from the
 * moment it took over, which is the honest answer rather than a gap pretending
 * to be a full log.
 */
private suspend fun loadHistory(engine: SwitchboardEngine, serverId: String, channel: String) {
    // Where we left off, before anything is marked read — opening the
    // conversation is what moves the marker, so asking afterwards always
    // answers "the end".
    //
    // Both modes. This used to sit behind the return below, so a phone holding
    // its own connection never marked an entry point and never drew the line —
    // the one mode this client exists for was the one mode without it.
    engine.store.markEntryPoint(serverId, channel, engine.readMarkerFor(serverId, channel))

    // The rest of this is the desktop's stored history, and there is none to
    // ask for when this phone is the connection.
    if (engine.mode == EngineMode.HOLDING) return

    if (engine.store.messagesFor(serverId, channel).isNotEmpty()) return

    runCatching {
        engine.store.setHistory(
            serverId,
            channel,
            engine.remote.call(
                "history:fetch",
                JsonPrimitive(serverId),
                JsonPrimitive(channel),
                JsonNull,
                JsonPrimitive(HISTORY_FIRST_PAGE)
            )
        )

        // And keep it, so this conversation is still readable on a train with
        // no signal and after Android has stopped the app
        engine.rememberFetched(serverId, channel)
    }
}

