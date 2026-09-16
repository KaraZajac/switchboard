@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.activity.compose.BackHandler
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import androidx.compose.runtime.LaunchedEffect
import org.switchboard.android.irc.Completion
import org.switchboard.android.irc.Emoji
import org.switchboard.android.irc.Typing
import org.switchboard.android.EngineMode
import org.switchboard.android.Message
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.isChannel
import org.switchboard.android.isConsole
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.trustCertificate
import org.switchboard.android.adoptBouncerNetworks
import org.switchboard.android.attach
import org.switchboard.android.canAttach
import org.switchboard.android.connectServer
import org.switchboard.android.disconnectServer
import org.switchboard.android.editMessage
import org.switchboard.android.join
import org.switchboard.android.loadOlder
import org.switchboard.android.part
import org.switchboard.android.previewLink
import org.switchboard.android.react
import org.switchboard.android.redact
import org.switchboard.android.reply
import org.switchboard.android.say
import org.switchboard.android.setAway
import org.switchboard.android.setTyping
import androidx.compose.ui.text.buildAnnotatedString
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.platform.LocalContext
import org.switchboard.android.irc.Formatter
import org.switchboard.android.irc.Formatting
import org.switchboard.android.irc.History
import androidx.compose.material.icons.filled.Share
import org.switchboard.android.irc.Transcript
import org.switchboard.android.irc.ChanModes
import org.switchboard.android.irc.MaskLists
import androidx.compose.material.icons.filled.Lock

/**
 * The whole client, once it is running.
 *
 * Two drawers, as on Discord: channels from the left, people from the right,
 * conversation in the middle. Compose only ships a left-hand drawer, so the
 * member panel is the same component with the layout direction flipped around it
 * — cheaper and better behaved than hand-rolling a second gesture.
 */
@Composable
fun ChatScreen(
    engine: SwitchboardEngine,
    onOpenSettings: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenBrowse: () -> Unit,
    onOpenServers: () -> Unit,
    onEditServer: (serverId: String) -> Unit,
    onOpenAccount: (serverId: String) -> Unit,
    onLoadHistory: (serverId: String, channel: String) -> Unit
) {
    val store = engine.store
    val channelDrawer = rememberDrawerState(DrawerValue.Closed)
    val memberDrawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    var viewingProfile by remember { mutableStateOf<String?>(null) }
    var editingProfile by remember { mutableStateOf(false) }

    // A drawer opening means you have stopped writing.
    //
    // The composer keeps focus otherwise, so the keyboard stays up over the
    // list you just asked to see — which on a phone is half of it. Watching
    // `targetValue` rather than `isOpen` puts the keyboard away as the swipe
    // commits rather than when it lands, so the list is never drawn behind it.
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    LaunchedEffect(channelDrawer.targetValue, memberDrawer.targetValue) {
        if (channelDrawer.targetValue == DrawerValue.Open ||
            memberDrawer.targetValue == DrawerValue.Open
        ) {
            // Both: hiding the keyboard while the composer still holds focus
            // invites it straight back on the next recomposition.
            focus.clearFocus()
            keyboard?.hide()
        }
    }

    // A conversation picked from outside the drawer — a notification, search —
    // is what the drawer was for, so it goes. Picking from inside it already
    // closed it; this covers the rest, or the tap landed behind the list.
    LaunchedEffect(store.activeServerId, store.activeChannel) {
        if (channelDrawer.isOpen) channelDrawer.close()
    }

    /*
     * Back goes up a level, and above a conversation is the list of them.
     *
     * It used to leave Switchboard outright from anywhere, which no other chat
     * app on the phone does and which is a rough thing to do to somebody
     * mid-sentence.
     *
     * The conversation list is the top of the app, so back from *there* does
     * leave — two presses out rather than one, the same shape as every other
     * messenger. Deliberately not a third state that closes the list and
     * returns to the conversation: that is "down", which back never means, and
     * it makes back a loop you can never leave the app with.
     *
     * Off while a sheet is up. Those dismiss themselves, and opening the
     * channel list behind one is not what the press meant.
     */
    BackHandler(
        enabled = channelDrawer.isClosed && memberDrawer.isClosed &&
            viewingProfile == null && !editingProfile
    ) {
        scope.launch { channelDrawer.open() }
    }

    // The member list is a detail of the conversation rather than a level above
    // it, so back puts it away and leaves you where you were. Without this it
    // falls through and closes the app from a panel somebody opened to look up
    // one nick.
    BackHandler(enabled = memberDrawer.isOpen) {
        scope.launch { memberDrawer.close() }
    }

    // Right-hand drawer: mirror the layout, then mirror its contents back
    Mirrored {
        ModalNavigationDrawer(
            drawerState = memberDrawer,
            drawerContent = {
                Mirrored {
                    ModalDrawerSheet(
                        drawerContainerColor = Mantle,
                        drawerShape = RoundedCornerShape(0.dp),
                        modifier = Modifier.width(280.dp)
                    ) {
                        MemberList(
                            store,
                            onSelect = { member ->
                                viewingProfile = member.nick
                                scope.launch { memberDrawer.close() }
                            },
                            modifier = Modifier.statusBarsPadding()
                        )
                    }
                }
            }
        ) {
            Mirrored {
                ModalNavigationDrawer(
                    drawerState = channelDrawer,
                    drawerContent = {
                        ModalDrawerSheet(
                            drawerContainerColor = Mantle,
                            drawerShape = RoundedCornerShape(0.dp),
                            modifier = Modifier.width(300.dp)
                        ) {
                            Navigator(
                                store = store,
                                mode = engine.mode,
                                modeDetail = engine.modeDetail,
                                takingOver = engine.isTakingOver,
                                pairedWithDesktop = engine.pairedWithDesktop,
                                followingAlwaysOn = engine.followingAlwaysOn,
                                allThroughBouncer = engine.allThroughBouncer,
                                vaultUnlocked = engine.isVaultUnlocked,
                                onSelect = { serverId, channel ->
                                    store.select(serverId, channel)
                                    onLoadHistory(serverId, channel)
                                    scope.launch { channelDrawer.close() }
                                },
                                onSelectServer = { serverId ->
                                    store.activeServerId = serverId
                                    // Where you left this network, not whatever
                                    // is first in its list — which is the
                                    // console, because that exists before any
                                    // channel does.
                                    store.channelToOpen(serverId)?.let { channel ->
                                        store.select(serverId, channel)
                                        onLoadHistory(serverId, channel)
                                    }
                                },
                                onEditServer = { serverId ->
                                    scope.launch { channelDrawer.close() }
                                    onEditServer(serverId)
                                },
                                onOpenAccount = { serverId ->
                                    scope.launch { channelDrawer.close() }
                                    onOpenAccount(serverId)
                                },
                                onToggleConnection = { serverId ->
                                    if (store.servers[serverId]?.connected == true) {
                                        engine.disconnectServer(serverId)
                                    } else {
                                        engine.connectServer(serverId)
                                    }
                                },
                                isMuted = { serverId -> engine.isMuted(serverId) },
                                onToggleMute = { serverId -> engine.toggleServerMute(serverId) },
                                onJoin = { serverId, channel ->
                                    engine.join(serverId, channel)
                                    scope.launch { channelDrawer.close() }
                                },
                                onLeave = { serverId, channel ->
                                    engine.part(serverId, channel)
                                },
                                isChannelMuted = { serverId, channel ->
                                    engine.mutes.channelMuted(serverId, channel)
                                },
                                onToggleChannelMute = { serverId, channel ->
                                    engine.toggleChannelMute(serverId, channel)
                                },
                                notifiesAll = { serverId, channel -> engine.notifiesAll(serverId, channel) },
                                onToggleNotifyAll = { serverId, channel ->
                                    engine.toggleNotifyAll(serverId, channel)
                                },
                                onOpenSettings = onOpenSettings,
                                onEditProfile = {
                                    editingProfile = true
                                    scope.launch { channelDrawer.close() }
                                },
                                onToggleAway = { serverId, away ->
                                    engine.setAway(serverId, if (away) "Away" else null)
                                },
                                onBrowse = {
                                    scope.launch { channelDrawer.close() }
                                    onOpenBrowse()
                                },
                                onManageServers = {
                                    scope.launch { channelDrawer.close() }
                                    onOpenServers()
                                }
                            )
                        }
                    }
                ) {
                    Conversation(
                        engine = engine,
                        onOpenChannels = { scope.launch { channelDrawer.open() } },
                        onOpenMembers = { scope.launch { memberDrawer.open() } },
                        onOpenSettings = onOpenSettings,
                        onOpenSearch = onOpenSearch,
                        onOpenServers = onOpenServers,
                        onOpenAccount = onOpenAccount
                    )
                }
            }
        }
    }

    // Sheets sit outside the mirrored subtree: they are not part of either
    // drawer, and inheriting a flipped layout direction would right-align them.
    viewingProfile?.let { nick ->
        ProfileSheet(
            engine = engine,
            nick = nick,
            onDismiss = { viewingProfile = null },
            onMessage = { who ->
                viewingProfile = null
                // A direct message is a conversation named for them, and one
                // nothing has created yet — no JOIN ever arrives for a person.
                store.activeServerId?.let {
                    store.openConversation(it, who)
                    store.select(it, who)
                }
            }
        )
    }

    if (editingProfile) {
        EditProfileSheet(engine = engine, onDismiss = { editingProfile = false })
    }
}

/** Flips layout direction for the subtree, so a left drawer opens on the right */
@Composable
private fun Mirrored(content: @Composable () -> Unit) {
    val direction = LocalLayoutDirection.current
    androidx.compose.runtime.CompositionLocalProvider(
        LocalLayoutDirection provides if (direction == LayoutDirection.Ltr) {
            LayoutDirection.Rtl
        } else {
            LayoutDirection.Ltr
        },
        content = content
    )
}

@Composable
private fun Conversation(
    engine: SwitchboardEngine,
    onOpenChannels: () -> Unit,
    onOpenMembers: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenServers: () -> Unit,
    onOpenAccount: (serverId: String) -> Unit
) {
    val store = engine.store
    var viewingChannelSettings by remember { mutableStateOf(false) }

    // Bans and what the channel is set to. A sheet rather than a screen: it is
    // about the conversation on screen, and coming back should not be a
    // navigation step.
    val settingsServer = store.activeServerId
    val settingsChannel = store.activeChannel
    if (viewingChannelSettings && settingsServer != null && settingsChannel != null) {
        ChannelSheet(engine, settingsServer, settingsChannel) { viewingChannelSettings = false }
    }

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        ChannelHeader(engine, onOpenChannels, onOpenMembers, onOpenSearch) {
            viewingChannelSettings = true
        }

        // A banner only when something has changed or needs doing. Repeating
        // the header's own subtitle back at the reader is noise.
        val pairedWithDesktop = engine.identity.ticket() != null

        when {
            // Nothing to connect to yet. The way out is a network, not a
            // desktop — this phone does not need one.
            engine.knownServers == 0 -> Banner(
                text = "No networks yet — add one and this phone will connect",
                color = Overlay,
                action = "Add",
                onClick = onOpenServers
            )

            engine.needsPassphrase -> Banner(
                text = if (pairedWithDesktop) {
                    "Unlock the shared config so this phone can take over"
                } else {
                    "Unlock the shared config so this phone can connect"
                },
                color = Yellow,
                action = "Unlock",
                onClick = onOpenSettings
            )

            // Only meaningful with a desktop in the picture. Telling someone
            // using this phone by itself that it cannot take over from a
            // desktop they do not have is noise about a feature they are not
            // using.
            pairedWithDesktop && engine.needsSharedConfig -> Banner(
                text = "No shared config — this phone cannot take over if the desktop stops",
                color = Yellow,
                action = "How",
                onClick = onOpenSettings
            )

            // Both devices on at once, which is the ordinary case wherever the
            // server allows it — so there is nothing to announce. A banner
            // saying everything is normal is a banner people learn to skip,
            // and then miss when it stops being true.
            engine.sharingWithDesktop -> {}

            // Deliberately nothing for "this phone is holding the
            // connections". The pill in the header says it in one word, and a
            // banner repeating it pushed the conversation down the screen for
            // news that is not news — which is the reasoning written above for
            // every other ordinary state.
        }

        // NickServ has asked us to log in. This is the moment the offer is
        // worth making: it stays until it is acted on or the login lands,
        // because unlike a refusal it is about something still undone.
        store.identifyPrompt?.let { prompt ->
            Banner(
                text = prompt.text,
                color = Yellow,
                action = "Log in",
                onClick = {
                    store.clearIdentifyPrompt()
                    onOpenAccount(prompt.serverId)
                },
                onDismiss = { store.clearIdentifyPrompt() }
            )
        }

        // A certificate nobody vouches for. The connection is going nowhere
        // until this is answered, so it stays — with the fingerprint, which
        // is the one thing the user can check. See [TrustedCertificate].
        store.certificatePrompt?.let { prompt ->
            val trusting = rememberCoroutineScope()
            Banner(
                text = prompt.text,
                detail = prompt.detail,
                color = Yellow,
                action = "Trust it",
                onClick = {
                    trusting.launch { engine.trustCertificate(prompt.serverId, prompt.fingerprint) }
                },
                onDismiss = { store.certificatePrompt = null }
            )
        }

        // A bouncer holding networks this phone has no row for. Worth asking
        // about the moment it is known rather than burying it in a settings
        // screen: until it is answered, most of somebody's IRC is missing and
        // nothing on screen says why.
        store.bouncerOffer?.let { offer ->
            val adopting = rememberCoroutineScope()
            Banner(
                text = "${offer.bouncer} holds ${offer.networks.size} network" +
                    (if (offer.networks.size == 1) "" else "s") + " that are not here yet",
                detail = offer.networks.joinToString(", ") { it.name },
                color = Blue,
                action = "Add them",
                onClick = {
                    adopting.launch { engine.adoptBouncerNetworks(offer) }
                    store.bouncerOffer = null
                },
                onDismiss = { store.bouncerOffer = null }
            )
        }

        // Something shared from another app. It waits here while the user
        // finds the conversation it is for, then goes as a message — text as
        // it is, a picture through the network's filehost.
        store.pendingShare?.let { share ->
            val here = store.activeServerId?.let { s -> store.activeChannel?.let { c -> s to c } }
            val sending = rememberCoroutineScope()
            val context = LocalContext.current
            val what = share.text?.let { "“${it.take(60)}${if (it.length > 60) "…" else ""}”" } ?: "a picture"
            Banner(
                text = if (here != null) "Shared from another app: $what. Send it to ${here.second}?"
                else "Shared from another app: $what. Open the conversation it is for.",
                color = Blue,
                action = if (here != null) "Send here" else null,
                onClick = {
                    val (serverId, channel) = here ?: return@Banner
                    share.text?.let { engine.say(serverId, channel, it) }
                    val image = share.image
                    if (image == null) {
                        store.pendingShare = null
                    } else {
                        // The banner stays until the upload is done: its scope
                        // is what runs the upload, and goes when it goes
                        sending.launch {
                            engine.attach(serverId, image, context)?.let { link -> engine.say(serverId, channel, link) }
                            store.pendingShare = null
                        }
                    }
                },
                onDismiss = { store.pendingShare = null }
            )
        }

        // What the server last refused, shown briefly and then let go.
        //
        // A refusal is worth interrupting for and not worth keeping: it is
        // about the thing you just tried, and a banner that stays becomes
        // furniture nobody reads.
        store.lastError?.let { refusal ->
            LaunchedEffect(refusal.at) {
                kotlinx.coroutines.delay(6_000)
                store.clearError()
            }
            Banner(
                text = refusal.subject?.let { "${refusal.text} — $it" } ?: refusal.text,
                color = Red,
                action = "Dismiss",
                onClick = { store.clearError() }
            )
        }

        var replyingTo by remember(store.activeChannel) { mutableStateOf<Message?>(null) }
        var reactingTo by remember { mutableStateOf<Message?>(null) }
        var editingMessage by remember(store.activeChannel) { mutableStateOf<Message?>(null) }
        val clipboard = LocalClipboardManager.current

        // Sharing a photograph is most of what a phone is for, and until now
        // the desktop was the only half of this client that could send a file
        // at all. Only offered where the network runs a filehost.
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        var attaching by remember { mutableStateOf(false) }
        val canAttach = store.activeServerId?.let { engine.canAttach(it) } == true

        val picker = rememberLauncherForActivityResult(
            ActivityResultContracts.GetContent()
        ) { uri ->
            val serverId = store.activeServerId
            val channel = store.activeChannel
            if (uri == null || serverId == null || channel == null) return@rememberLauncherForActivityResult

            attaching = true
            scope.launch {
                val link = engine.attach(serverId, uri, context)
                attaching = false
                // The link goes to the channel as an ordinary message, which is
                // what a filehost URL is — the receiving client makes it a
                // picture, and one that cannot still has something to click.
                if (link != null) engine.say(serverId, channel, link)
            }
        }

        MessageList(
            store,
            modifier = Modifier.weight(1f),
            onAction = { message, action ->
                val serverId = store.activeServerId ?: return@MessageList
                val channel = store.activeChannel ?: return@MessageList
                when (action) {
                    MessageAction.Reply -> replyingTo = message
                    MessageAction.React -> reactingTo = message
                    MessageAction.Copy -> clipboard.setText(AnnotatedString(message.content))
                    MessageAction.Edit -> {
                        replyingTo = null
                        editingMessage = message
                    }
                    MessageAction.Redact -> engine.redact(serverId, channel, message.id)
                }
            },
            onReaction = { message, emoji, mine ->
                val serverId = store.activeServerId ?: return@MessageList
                val channel = store.activeChannel ?: return@MessageList
                engine.react(serverId, channel, message.id, emoji, remove = mine)
            },
            onPreview = { url -> engine.previewLink(url) },
            onLoadOlder = {
                val serverId = store.activeServerId
                val channel = store.activeChannel
                if (serverId == null || channel == null) 0 else engine.loadOlder(serverId, channel)
            }
        )

        TypingLine(store)

        replyingTo?.let { target ->
            ContextBar("Replying to", store.displayNameOf(target.nick), target.content, Blue) {
                replyingTo = null
            }
        }
        editingMessage?.let { target ->
            ContextBar("Editing your message", null, target.content, Yellow) {
                editingMessage = null
            }
        }

        // Files somebody is offering, in the conversation they offered them in.
        // Only in a direct message: DCC is between two people, and an offer
        // made to a channel is not how anybody sends a file to a person.
        val serverNow = store.activeServerId
        val channelNow = store.activeChannel
        if (serverNow != null && channelNow != null && !isChannel(channelNow)) {
            TransfersStrip(engine, serverNow, channelNow)
        }

        Composer(
            channel = store.activeChannel,
            enabled = store.activeServerId != null &&
                store.activeChannel != null &&
                !isConsole(store.activeChannel.orEmpty()),
            onAttach = if (canAttach) ({ picker.launch("*/*") }) else null,
            attaching = attaching,
            seedKey = editingMessage?.id,
            seedText = editingMessage?.content,
            people = store.activeServerId?.let { serverId ->
                store.activeChannel?.let { channel -> store.membersFor(serverId, channel) }
            }.orEmpty().map { it.nick },
            onTyping = { typing ->
                val serverId = store.activeServerId ?: return@Composer
                val channel = store.activeChannel ?: return@Composer
                engine.setTyping(serverId, channel, typing)
            },
            onSend = { text ->
                val serverId = store.activeServerId ?: return@Composer
                val channel = store.activeChannel ?: return@Composer
                val answering = replyingTo
                val amending = editingMessage
                when {
                    amending != null -> {
                        engine.editMessage(serverId, channel, amending.id, text)
                        editingMessage = null
                    }
                    answering != null -> {
                        engine.reply(serverId, channel, answering.id, text)
                        replyingTo = null
                    }
                    else -> engine.say(serverId, channel, text)
                }
            }
        )

        reactingTo?.let { target ->
            EmojiPicker(
                onDismiss = { reactingTo = null },
                onPick = { emoji ->
                    val serverId = store.activeServerId
                    val channel = store.activeChannel
                    if (serverId != null && channel != null) {
                        engine.react(serverId, channel, target.id, emoji)
                    }
                    reactingTo = null
                }
            )
        }
    }
}

/**
 * Who is typing, on one line above the composer.
 *
 * Recomputed on a timer rather than only on events: the "done" that would clear
 * someone is exactly what gets lost when they close their laptop mid-sentence,
 * so the list has to age out on its own.
 */
@Composable
private fun TypingLine(store: SwitchboardStore) {
    val serverId = store.activeServerId
    val channel = store.activeChannel
    var tick by remember { mutableStateOf(0L) }

    LaunchedEffect(serverId, channel) {
        while (true) {
            kotlinx.coroutines.delay(1_000)
            tick = System.currentTimeMillis()
        }
    }

    val who = remember(tick, serverId, channel, store.typing.size) {
        if (serverId == null || channel == null) emptyList()
        else store.typingIn(serverId, channel)
    }
    if (who.isEmpty()) return

    val names = who.map { store.displayName(serverId!!, it) }
    Text(
        when (names.size) {
            1 -> "${names[0]} is typing…"
            2 -> "${names[0]} and ${names[1]} are typing…"
            else -> "${names.size} people are typing…"
        },
        color = Overlay,
        fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)
    )
}

/** The message about to be answered, cancellable */
@Composable
private fun ContextBar(
    label: String,
    who: String?,
    preview: String,
    accent: androidx.compose.ui.graphics.Color,
    onCancel: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Mantle)
            .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.width(2.dp).height(28.dp).background(accent, RoundedCornerShape(1.dp)))
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                if (who != null) "$label $who" else label,
                color = accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                preview.replace('\n', ' '),
                color = Overlay,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconAction(Icons.Filled.Close, "Cancel", onCancel, inRow = true)
    }
}

/**
 * The reactions offered first, in the desktop's order.
 *
 * Shared by both clients on purpose: reaching for the third emoji from the left
 * should not land somewhere different depending on which screen you picked up.
 */
private val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "🎉", "😢", "🤔", "👀", "🔥")

/** The composer's corner, shared by the box and the button beside it */
private val COMPOSER_RADIUS = 12.dp

/** What the empty composer says it will send, and where */
private fun conversationHint(channel: String?): String = when {
    channel == null -> "No channel"
    // The server talks; it does not listen. There is no target to send to.
    isConsole(channel) -> "What the server has said"
    isChannel(channel) -> "Message #" + channel.removePrefix("#")
    else -> "Message $channel"
}

/** The name to show for someone in the current conversation */
private fun SwitchboardStore.displayNameOf(nick: String): String =
    activeServerId?.let { displayName(it, nick) } ?: nick

/** A small set of reactions, because a full picker is a different feature */
@Composable
private fun EmojiPicker(onDismiss: () -> Unit, onPick: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Mantle) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // The sheet ends where the system's gesture bar begins, and the
                // last row of anything tappable was sitting underneath it
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 32.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            // Each takes an equal share of the width. Laying them out at a
            // fixed size instead fits on a wide phone and clips the last one on
            // anything narrower, which is a strange way to lose an emoji.
            for (emoji in QUICK_REACTIONS) {
                Text(
                    emoji,
                    fontSize = 26.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onPick(emoji) }
                        .padding(vertical = 8.dp)
                )
            }
        }
    }
}

@Composable
private fun ChannelHeader(
    engine: SwitchboardEngine,
    onOpenChannels: () -> Unit,
    onOpenMembers: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenChannelSettings: () -> Unit
) {
    val store = engine.store
    val serverId = store.activeServerId
    val channel = store.activeChannel
    val topic = serverId?.let { id ->
        store.channelsFor(id).firstOrNull { it.name.equals(channel, true) }?.topic
    }
    val members = if (serverId != null && channel != null) {
        store.membersFor(serverId, channel).size
    } else {
        0
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Mantle)
            .statusBarsPadding()
            .padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconAction(Icons.Filled.Menu, "Channels", onOpenChannels)

        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // A person is not a room, and prefixing their nick with a hash
                // says they are. Nor is the app itself: with nothing selected
                // the title is the product's name, not a channel called
                // "#Switchboard".
                if (channel != null && isChannel(channel)) {
                    Text("#", color = Overlay, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(3.dp))
                }
                Text(
                    when {
                        channel == null -> "Switchboard"
                        // `*` is how the console is addressed on the wire, not
                        // what it is called. The drawer says "Server messages"
                        // and the desktop says "Server"; only this line showed
                        // the reader the sentinel.
                        isConsole(channel) -> "Server"
                        else -> channel.removePrefix("#")
                    },
                    color = Text0,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(6.dp))
                ModePill(
                    engine.mode,
                    engine.isTakingOver,
                    engine.pairedWithDesktop,
                    engine.followingAlwaysOn,
                    engine.allThroughBouncer
                )
            }
            Text(
                // The banner already carries the mode when there is one to
                // carry, so the subtitle spends its line on the topic instead.
                // Drawn the way the channel set it, the same as the desktop
                // draws it. Showing it raw was not an option: a topic in colour
                // arrives with the colour codes' digits loose in the text, so
                // #news read as "13#4N7E8W3S 2- 13|" in the header.
                topic?.takeIf { it.isNotBlank() }?.let { formatted(it) }
                    ?: buildAnnotatedString {
                        append(
                            serverId?.let { store.servers[it]?.name } ?: engine.modeDetail
                        )
                    },
                color = Overlay,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        IconAction(Icons.Filled.Search, "Search messages", onOpenSearch)

        // Bans and what the channel is set to. Only in a channel, and only
        // where the network states any modes at all — a shield that opens an
        // empty box is worse than no shield.
        if (serverId != null && channel != null && isChannel(channel)) {
            val tokens = store.isupport[serverId].orEmpty()
            val hasAny = ChanModes.settingsFor(tokens["CHANMODES"], tokens["PREFIX"]).isNotEmpty() ||
                MaskLists.listsFor(tokens["CHANMODES"], tokens["PREFIX"]).isNotEmpty()

            if (hasAny) {
                // A padlock rather than the desktop's shield: the extended
                // icon set is a megabyte this app does not ship, and
                // "restricted" is the same idea.
                IconAction(Icons.Filled.Lock, "Bans and channel settings", onOpenChannelSettings)
            }
        }

        // Everything said is in the store and nothing could get it out. The
        // desktop writes a file; a phone shares, which is the same thing in the
        // shape this platform has. Only where there is a conversation to share.
        val context = LocalContext.current
        if (serverId != null && channel != null) {
            IconAction(
                Icons.Filled.Share,
                "Share this conversation",
                { shareTranscript(context, store, serverId, channel) }
            )
        }

        IconAction(Icons.Filled.Person, "Members", onOpenMembers)
        if (members > 0) {
            Text(
                members.toString(),
                color = Subtext,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(end = 8.dp)
            )
        }
    }
}

@Composable
private fun Banner(
    text: String,
    color: Color,
    action: String? = null,
    onClick: (() -> Unit)? = null,
    /** A line under the text in a typeface it can be read from — a fingerprint, a code */
    detail: String? = null,
    /**
     * Put it away without doing the thing it suggests.
     *
     * A banner that only offers the thing you were avoiding is not an offer.
     * Given here, an × appears on the right; without it the banner stays until
     * whatever it is about is resolved, which is right for the ones about state
     * rather than about a suggestion.
     */
    onDismiss: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(color.copy(alpha = 0.12f))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(start = 16.dp, end = if (onDismiss != null) 4.dp else 16.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(7.dp).background(color, CircleShape))
        Spacer(Modifier.width(9.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text,
                color = color,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            )
            if (detail != null) {
                Text(
                    detail,
                    color = color,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    lineHeight = 15.sp,
                    modifier = Modifier
                        .padding(top = 4.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Crust.copy(alpha = 0.5f))
                        .padding(horizontal = 6.dp, vertical = 3.dp)
                )
            }
        }
        if (action != null && onClick != null) {
            Text(action, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        if (onDismiss != null) {
            Text(
                "×",
                color = color,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .clickable(onClick = onDismiss)
                    .padding(horizontal = 10.dp, vertical = 2.dp)
            )
        }
    }
}

/**
 * What has been sent where, kept outside the composable.
 *
 * The composer is remade on every channel change, so state inside it would be
 * history that lasted until you looked away. In memory only and per
 * conversation — see `org.switchboard.android.irc.History` for why both.
 */
private val histories = mutableMapOf<String, History.State>()

/**
 * The composer.
 *
 * One line until it needs more, exactly as on the desktop — a phone keyboard
 * already takes half the screen, and a box that is permanently three lines tall
 * takes some of what is left for nothing.
 */
@Composable
private fun Composer(
    channel: String?,
    enabled: Boolean,
    seedKey: String? = null,
    seedText: String? = null,
    /** Who is in this conversation, for completing a half-typed name */
    people: List<String> = emptyList(),
    /** Null where the network has no filehost, so no button is offered */
    onAttach: (() -> Unit)? = null,
    attaching: Boolean = false,
    onTyping: (Boolean) -> Unit,
    onSend: (String) -> Unit
) {
    // Editing puts the old text in the box to be changed. Keyed on the message
    // id rather than the text, so editing two messages that happen to say the
    // same thing still refills the box the second time.
    //
    // A TextFieldValue rather than a String, because the cursor has to be moved
    // as well as the text: replacing the string alone leaves the caret where it
    // was, so completing "rob" to "robin: " and typing on produced
    // "robhow did the migration goin: ".
    var field by remember(seedKey) {
        val text = seedText.orEmpty()
        mutableStateOf(TextFieldValue(text, TextRange(text.length)))
    }
    val draft = field.text

    // Only once an `@` is typed — see [mentionsFor]
    val suggestions = remember(draft, people) { mentionsFor(draft, people) }

    // `:smi` offers smile — see [Emoji]. The keyboard has a picker of its
    // own; this is for the name you know.
    val emojiSuggestions = remember(draft) {
        Emoji.query(draft)?.let { Emoji.candidates(it) } ?: emptyList()
    }

    fun complete(nick: String) {
        val next = mentionedDraft(draft, nick)
        field = TextFieldValue(next, TextRange(next.length))
    }

    // The GIF picker, the desktop's on a phone — see [GifPickerSheet]. What
    // it picks goes straight out as a message, as it does there.
    var showGifs by remember { mutableStateOf(false) }

    // Say we are typing on a keystroke, and take it back when the message goes
    // or the box is emptied. Not on a timer: a half-written message left on
    // screen is not somebody typing, and a receiver stops showing the notice
    // after six seconds of silence anyway. [Typing] decides; this only holds
    // the one number it needs.
    var lastTypingAt by remember { mutableStateOf(0L) }

    // Up and Down are a desktop keyboard's. A phone has neither, so the same
    // thing is a button — beside the formatting marks, where the other things
    // that act on the box already are.
    val historyKey = channel ?: ""
    var history by remember(historyKey) {
        mutableStateOf(histories[historyKey] ?: History.State())
    }

    fun step(back: Boolean) {
        val moved = if (back) History.older(history, draft) else History.newer(history)
        if (!History.browsing(moved) && !History.browsing(history)) return
        history = moved
        histories[historyKey] = moved
        val wanted = History.textOf(moved)
        field = TextFieldValue(wanted, TextRange(wanted.length))
    }

    fun note(event: Typing.Event) {
        val decision = Typing.toSend(event, lastTypingAt, System.currentTimeMillis())
        lastTypingAt = decision.lastActiveAt
        when (decision.send) {
            "active" -> onTyping(true)
            "done" -> onTyping(false)
        }
    }

    LaunchedEffect(draft) {
        note(if (draft.isEmpty()) Typing.Event.CLEARED else Typing.Event.TYPED)
    }

    fun send() {
        val text = draft.trim()
        if (text.isEmpty()) return
        // `:tada:` goes out as the party popper — see [Emoji]. Not in a
        // command, whose arguments mean what they say.
        onSend(if (text.startsWith("/")) text else Emoji.replaceShortcodes(text))
        history = History.remember(history, text)
        histories[historyKey] = history
        field = TextFieldValue("")
        note(Typing.Event.SENT)
    }

    /**
     * Put a formatting code around the selection.
     *
     * The desktop has Ctrl+B; a phone keyboard has no Ctrl, so these are
     * buttons or they are nothing. The selection is restored afterwards so the
     * next keystroke carries on inside the pair.
     */
    fun format(which: String) {
        val out = Formatter.mark(
            field.text,
            field.selection.start,
            field.selection.end,
            which
        )
        field = TextFieldValue(out.text, TextRange(out.selectionStart, out.selectionEnd))
    }

    var showColours by remember { mutableStateOf(false) }

    fun colour(index: Int?) {
        val out = Formatter.colourise(
            field.text,
            field.selection.start,
            field.selection.end,
            index
        )
        field = TextFieldValue(out.text, TextRange(out.selectionStart, out.selectionEnd))
        showColours = false
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Base)
            .navigationBarsPadding()
            .imePadding()
    ) {

    // The sixteen colours every client agrees on. The extended palette exists
    // but nothing renders it consistently, and a colour nobody else can see is
    // a message nobody else can read.
    if (showColours) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(start = 12.dp, end = 12.dp, top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            for (index in 0 until 16) {
                Box(
                    modifier = Modifier
                        .size(26.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(android.graphics.Color.parseColor(Formatting.PALETTE[index])))
                        .clickable { colour(index) }
                )
            }
            Text(
                "None",
                color = Subtext,
                fontSize = 13.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { colour(null) }
                    .padding(horizontal = 10.dp, vertical = 5.dp)
            )
        }
    }

    // Bold, italic, underline and colour. The desktop reaches these with
    // Ctrl+B and friends; a phone keyboard has no Ctrl.
    if (enabled) {
        Row(
            modifier = Modifier.padding(start = 12.dp, top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            FormatButton("B", FontWeight.Bold) { format("bold") }
            FormatButton("I", FontWeight.Normal, italic = true) { format("italic") }
            FormatButton("U", FontWeight.Normal, underline = true) { format("underline") }
            FormatButton("A", FontWeight.Normal, tint = Blue) { showColours = !showColours }
            FormatButton("GIF", FontWeight.Bold) { showGifs = true }

            // Only when there is something to go back to, so the row stays
            // quiet in a conversation you have not spoken in.
            if (history.lines.isNotEmpty()) {
                FormatButton("↑", FontWeight.Normal) { step(back = true) }
                if (History.browsing(history)) {
                    FormatButton("↓", FontWeight.Normal) { step(back = false) }
                }
            }
        }
    }

    if (showGifs) {
        GifPickerSheet(
            onPick = { url ->
                onSend(url)
                note(Typing.Event.SENT)
                showGifs = false
            },
            onDismiss = { showGifs = false }
        )
    }

    if (emojiSuggestions.isNotEmpty()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(start = 12.dp, end = 12.dp, top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            for (entry in emojiSuggestions) {
                Text(
                    "${entry.emoji} ${entry.name}",
                    color = Text0,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(Surface0)
                        .clickable {
                            val next = Emoji.complete(draft, entry.emoji)
                            field = TextFieldValue(next, TextRange(next.length))
                        }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                )
            }
        }
    }

    if (suggestions.isNotEmpty()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(start = 12.dp, end = 12.dp, top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            for (nick in suggestions) {
                Text(
                    nick,
                    color = Crust,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(nickColor(nick))
                        .clickable { complete(nick) }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Only where the network takes uploads. A button that cannot work is
        // worse than no button, and most networks have no filehost at all.
        if (onAttach != null) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .background(Surface0, RoundedCornerShape(COMPOSER_RADIUS))
                    .clickable(enabled = enabled && !attaching) { onAttach() },
                contentAlignment = Alignment.Center
            ) {
                if (attaching) {
                    CircularProgressIndicator(
                        color = Blue,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(Sizes.spinner)
                    )
                } else {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = "Attach a file",
                        tint = Subtext,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
        }

        Box(
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 44.dp, max = 140.dp)
                // A rounded rectangle, not a pill: the box grows to several
                // lines as you type, and a capsule that tall looks like a
                // mistake. The desktop's composer has the same corner.
                .background(Surface0, RoundedCornerShape(COMPOSER_RADIUS))
                .padding(horizontal = 14.dp, vertical = 12.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            if (draft.isEmpty()) {
                Text(
                    conversationHint(channel),
                    color = Overlay,
                    fontSize = 15.sp
                )
            }
            BasicTextField(
                value = field,
                onValueChange = { field = it },
                enabled = enabled,
                textStyle = TextStyle(color = Text0, fontSize = 15.sp, lineHeight = 20.sp),
                cursorBrush = SolidColor(Blue),
                // Return makes a new line and the button sends, as on every
                // other phone chat app — a keyboard whose Send key inserts a
                // newline is worse than no Send key at all.
                keyboardOptions = KeyboardOptions(
                    imeAction = ImeAction.Default,
                    capitalization = KeyboardCapitalization.Sentences
                ),
                modifier = Modifier.fillMaxWidth()
            )
        }

        val ready = draft.isNotBlank() && enabled
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(
                    if (ready) Blue else Surface0,
                    RoundedCornerShape(COMPOSER_RADIUS)
                )
                .clickable(enabled = ready) { send() },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Send,
                contentDescription = "Send",
                tint = if (ready) Crust else Overlay,
                modifier = Modifier.size(20.dp)
            )
        }
    }

    }
}

/**
 * Whoever an `@` could mean.
 *
 * The row used to offer names for any two letters typed, which put a box over
 * the keyboard while somebody typed "bu" on the way to "but". Now the `@` is
 * the intent — the way Discord and Slack mention — and `@b` narrows to the
 * b's. Nothing without one; everyone here with one alone. The same rule as
 * the desktop's popup, from the same corpus.
 */
internal fun mentionsFor(draft: String, people: List<String>): List<String> {
    val query = Completion.mentionQuery(draft) ?: return emptyList()
    return Completion.mentionCandidates(query, people)
}

/** The draft with the mention finished — `@robin ` — ready to go on typing */
internal fun mentionedDraft(draft: String, nick: String): String =
    Completion.mentioned(draft, nick)

/** One letter that turns a formatting code on or off */
@Composable
private fun FormatButton(
    glyph: String,
    weight: FontWeight,
    italic: Boolean = false,
    underline: Boolean = false,
    tint: Color = Subtext,
    onClick: () -> Unit
) {
    Text(
        glyph,
        color = tint,
        fontSize = 15.sp,
        fontWeight = weight,
        fontStyle = if (italic) androidx.compose.ui.text.font.FontStyle.Italic else null,
        textDecoration = if (underline) androidx.compose.ui.text.style.TextDecoration.Underline else null,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp)
    )
}


/**
 * Hand a conversation to whatever the person picks.
 *
 * A share sheet rather than a file, because that is what this platform has —
 * and it reaches mail, notes, a text editor and the file manager without this
 * app asking for storage permission it does not otherwise need. The text is
 * the same the desktop writes; see [Transcript].
 */
private fun shareTranscript(
    context: android.content.Context,
    store: SwitchboardStore,
    serverId: String,
    channel: String
) {
    val network = store.servers[serverId]?.name ?: serverId
    val text = Transcript.of(
        network,
        channel,
        store.messagesFor(serverId, channel).map {
            Transcript.Line(it.nick, it.content, it.timestamp, it.type)
        }
    )

    val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_TITLE, Transcript.filename(network, channel))
        putExtra(android.content.Intent.EXTRA_TEXT, text)
    }
    runCatching {
        context.startActivity(
            android.content.Intent.createChooser(intent, "Share $channel")
        )
    }
}


/**
 * Files somebody is sending you.
 *
 * A strip above the composer rather than a screen of its own: an offer is
 * something happening right now in this conversation, and a transfer nobody
 * notices is one nobody accepts.
 *
 * Nothing starts on its own. An offer sits here until somebody presses a
 * button, which is the whole reason DCC has the reputation it does.
 */
@Composable
private fun TransfersStrip(engine: SwitchboardEngine, serverId: String, peer: String) {
    // Read so Compose redraws when a transfer moves; the list itself is not
    // snapshot state all the way down.
    @Suppress("UNUSED_VARIABLE")
    val revision = engine.dcc.revision

    val mine = engine.dcc.transfers.filter {
        it.serverId == serverId && it.peer.equals(peer, ignoreCase = true)
    }
    if (mine.isEmpty()) return

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        for (transfer in mine) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        transfer.filename,
                        color = Text0,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        when (transfer.state) {
                            "offered" -> "${transfer.peer} is offering it — ${sizeOf(transfer.size)}"
                            "active" ->
                                if (transfer.size > 0)
                                    "${transfer.transferred * 100 / transfer.size}%"
                                else sizeOf(transfer.transferred)
                            "done" -> "Saved to ${transfer.savedTo}"
                            else -> transfer.error ?: "It did not work"
                        },
                        color = when (transfer.state) {
                            "done" -> Green
                            "failed" -> Red
                            else -> Subtext
                        },
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // The person who sent it does not get to decide that this
                // phone connects to theirs.
                if (transfer.state == "offered") {
                    Text(
                        "Accept",
                        color = Blue,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { engine.dcc.accept(transfer.id) }
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                    Text(
                        "Decline",
                        color = Subtext,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { engine.dcc.decline(transfer.id) }
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }
}

/** Bytes, in the units a person reads */
private fun sizeOf(bytes: Long): String {
    if (bytes <= 0) return "unknown size"
    val units = listOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.size - 1) {
        value /= 1024
        unit++
    }
    return if (value < 10 && unit > 0) "%.1f %s".format(value, units[unit])
    else "${value.toInt()} ${units[unit]}"
}
