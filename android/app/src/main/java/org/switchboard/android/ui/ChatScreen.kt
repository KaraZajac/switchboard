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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
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
import org.switchboard.android.irc.Typing
import org.switchboard.android.EngineMode
import org.switchboard.android.Message
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.isChannel
import org.switchboard.android.isConsole
import org.switchboard.android.SwitchboardEngine
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
import androidx.compose.material.icons.filled.Share
import org.switchboard.android.irc.Transcript

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

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        ChannelHeader(engine, onOpenChannels, onOpenMembers, onOpenSearch)

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

            pairedWithDesktop && engine.mode == EngineMode.HOLDING -> Banner(
                text = "This phone is holding the connections",
                color = Green
            )
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
        Icon(
            Icons.Filled.Close,
            contentDescription = "Cancel",
            tint = Subtext,
            modifier = Modifier.size(36.dp).clickable(onClick = onCancel).padding(8.dp)
        )
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
    onOpenSearch: () -> Unit
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
            .padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.Filled.Menu,
            contentDescription = "Channels",
            tint = Subtext,
            modifier = Modifier.size(44.dp).clickable(onClick = onOpenChannels).padding(11.dp)
        )

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
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(6.dp))
                ModePill(engine.mode, engine.isTakingOver, engine.pairedWithDesktop)
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

        Icon(
            Icons.Filled.Search,
            contentDescription = "Search messages",
            tint = Subtext,
            modifier = Modifier.size(40.dp).clickable(onClick = onOpenSearch).padding(10.dp)
        )

        // Everything said is in the store and nothing could get it out. The
        // desktop writes a file; a phone shares, which is the same thing in the
        // shape this platform has. Only where there is a conversation to share.
        val context = LocalContext.current
        if (serverId != null && channel != null) {
            Icon(
                Icons.Filled.Share,
                contentDescription = "Share this conversation",
                tint = Subtext,
                modifier = Modifier
                    .size(40.dp)
                    .clickable { shareTranscript(context, store, serverId, channel) }
                    .padding(10.dp)
            )
        }

        Row(
            modifier = Modifier.clickable(onClick = onOpenMembers).padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Icon(
                Icons.Filled.Person,
                contentDescription = "Members",
                tint = Subtext,
                modifier = Modifier.size(20.dp)
            )
            if (members > 0) {
                Text(members.toString(), color = Subtext, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun Banner(
    text: String,
    color: Color,
    action: String? = null,
    onClick: (() -> Unit)? = null,
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
        Text(
            text,
            color = color,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
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

    val partial = draft.substringAfterLast(' ')
    val suggestions = remember(partial, people) { completionsFor(partial, people) }

    fun complete(nick: String) {
        val next = completedDraft(draft, nick)
        field = TextFieldValue(next, TextRange(next.length))
    }

    // Say we are typing on a keystroke, and take it back when the message goes
    // or the box is emptied. Not on a timer: a half-written message left on
    // screen is not somebody typing, and a receiver stops showing the notice
    // after six seconds of silence anyway. [Typing] decides; this only holds
    // the one number it needs.
    var lastTypingAt by remember { mutableStateOf(0L) }

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
        onSend(text)
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
                        modifier = Modifier.size(18.dp)
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
 * Whoever matches the word being typed.
 *
 * Tab completion is how people address each other on IRC, and a phone has no
 * tab — but it does have somewhere to put the answers, and typing a nick
 * exactly on a touchscreen is harder than on a keyboard, not easier. Two
 * characters before offering anything, so the row does not appear over the
 * whole roster the moment somebody types a letter.
 */
internal fun completionsFor(partial: String, people: List<String>): List<String> =
    Completion.matching(partial, people)

/**
 * The draft with the half-typed name finished.
 *
 * "robin: " when it is the first word and "robin " otherwise — the convention
 * every IRC client follows, and what makes the highlight land on the right
 * person rather than reading as a passing mention.
 */
internal fun completedDraft(draft: String, nick: String): String =
    Completion.complete(draft, nick)

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
