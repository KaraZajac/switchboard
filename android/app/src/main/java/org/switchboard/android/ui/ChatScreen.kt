@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.switchboard.android.ui

import androidx.compose.foundation.background
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
import org.switchboard.android.EngineMode
import org.switchboard.android.Message
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.isChannel
import org.switchboard.android.SwitchboardEngine
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
import org.switchboard.android.setTyping

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
                                    store.channelsFor(serverId).firstOrNull()?.let {
                                        store.select(serverId, it.name)
                                        onLoadHistory(serverId, it.name)
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
                text = "Unlock the shared config so this phone can connect",
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
                }
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
            enabled = store.activeServerId != null && store.activeChannel != null,
            seedKey = editingMessage?.id,
            seedText = editingMessage?.content,
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
                    channel?.removePrefix("#") ?: "Switchboard",
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
                topic?.takeIf { it.isNotBlank() }
                    ?: serverId?.let { store.servers[it]?.name }
                    ?: engine.modeDetail,
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
    onClick: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(color.copy(alpha = 0.12f))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 7.dp),
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
    onTyping: (Boolean) -> Unit,
    onSend: (String) -> Unit
) {
    // Editing puts the old text in the box to be changed. Keyed on the message
    // id rather than the text, so editing two messages that happen to say the
    // same thing still refills the box the second time.
    var draft by remember(seedKey) { mutableStateOf(seedText.orEmpty()) }

    // Say we are typing when there is something to type, and stop when the box
    // empties or a few seconds pass without a keystroke.
    LaunchedEffect(draft.isNotEmpty()) {
        if (draft.isEmpty()) {
            onTyping(false)
            return@LaunchedEffect
        }
        while (draft.isNotEmpty()) {
            onTyping(true)
            kotlinx.coroutines.delay(3_000)
        }
    }

    fun send() {
        val text = draft.trim()
        if (text.isEmpty()) return
        onSend(text)
        draft = ""
        onTyping(false)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Base)
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
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
                value = draft,
                onValueChange = { draft = it },
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
