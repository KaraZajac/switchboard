package org.switchboard.android

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
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
import org.switchboard.android.ui.ChatScreen
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

        val prefs = getSharedPreferences("switchboard", Context.MODE_PRIVATE)
        setContent {
            App(engine, lifecycleScope, prefs, launchPairing) { launchPairing = null }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Scanned with the system camera while we were already open
        pairingFrom(intent)?.let { launchPairing = it }
    }

    private fun pairingFrom(intent: Intent?): PairingPayload? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        return intent.dataString?.let { Pairing.parse(it) }
    }

    // Nothing is torn down here on purpose: leaving this screen must not take
    // the connection with it. The service decides when the engine stops.
}

private enum class Screen { PAIRING, SCANNING, CHAT, SETTINGS, SEARCH, BROWSE, SERVERS }

@Composable
fun App(
    engine: SwitchboardEngine,
    scope: CoroutineScope,
    prefs: SharedPreferences,
    launchPairing: PairingPayload? = null,
    onPairingConsumed: () -> Unit = {}
) {
    var screen by remember {
        mutableStateOf(
            // A phone that has paired before opens straight into the conversation,
            // and one that holds an unlocked vault can work with no desktop at all.
            if (prefs.getString("ticket", null).isNullOrBlank()) Screen.PAIRING else Screen.CHAT
        )
    }
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

            store.activeServerId?.let { serverId ->
                store.activeChannel?.let { channel -> loadHistory(engine, serverId, channel) }
            }
        }
    }

    /** Pair or re-dial, then adopt what the desktop knows. */
    suspend fun connect(ticket: String, code: String?) {
        try {
            store.status = "Connecting…"
            engine.connectToDesktop(ticket, code, Build.MODEL ?: "Android", deviceKey(prefs))
            engine.syncTheme()
            refill()

            prefs.edit().putString("ticket", ticket).apply()
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

        val saved = prefs.getString("ticket", null)
        if (!saved.isNullOrBlank()) connect(saved, null)
    }

    // A pairing link this phone was opened with beats whatever it was doing.
    //
    // The payload is cleared *after* connecting, never before: clearing it
    // changes this effect's key, and changing the key cancels the coroutine
    // that is still in the middle of dialling.
    LaunchedEffect(launchPairing?.ticket) {
        val payload = launchPairing ?: return@LaunchedEffect
        try {
            connect(payload.ticket, payload.code)
        } finally {
            onPairingConsumed()
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
            when (screen) {
                Screen.PAIRING -> PairingScreen(
                    status = store.status,
                    onScan = { screen = Screen.SCANNING },
                    onPair = { ticket, code -> scope.launch { connect(ticket, code) } }
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
                    onOpenBrowse = { screen = Screen.BROWSE },
                    onOpenServers = { screen = Screen.SERVERS },
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

                Screen.SERVERS -> ServersScreen(
                    engine = engine,
                    onClose = { screen = Screen.CHAT }
                )

                Screen.SETTINGS -> SettingsScreen(
                    engine = engine,
                    onBack = { screen = Screen.CHAT },
                    onManageServers = { screen = Screen.SERVERS },
                    onUnpair = {
                        prefs.edit().remove("ticket").apply()
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
    if (engine.mode == EngineMode.HOLDING) return

    // Where we left off, before anything is marked read — opening the
    // conversation is what moves the marker, so asking afterwards always
    // answers "the end".
    engine.store.markEntryPoint(serverId, channel, engine.readMarkerFor(serverId, channel))

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
    }
}

/**
 * This device's iroh identity, created once and kept.
 *
 * The desktop's device list is a list of public keys; a phone that generated a
 * new key on every launch would have to be paired again every time.
 */
private fun deviceKey(prefs: SharedPreferences): ByteArray {
    prefs.getString("secretKey", null)?.let { saved ->
        val decoded = android.util.Base64.decode(saved, android.util.Base64.NO_WRAP)
        if (decoded.size == 32) return decoded
    }

    val key = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
    prefs.edit()
        .putString("secretKey", android.util.Base64.encodeToString(key, android.util.Base64.NO_WRAP))
        .apply()
    return key
}
