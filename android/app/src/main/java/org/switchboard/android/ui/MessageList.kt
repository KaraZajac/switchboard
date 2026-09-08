@file:OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class
)

package org.switchboard.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.filter
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.Message
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.UserMetadata
import org.switchboard.android.isChannel

/**
 * The conversation.
 *
 * Grouped the way every chat app groups — one avatar and one name per run from
 * the same person — because IRC's raw shape (a nick on every single line) wastes
 * most of a phone screen on repeating what the reader already knows.
 */
@Composable
fun MessageList(
    store: SwitchboardStore,
    modifier: Modifier = Modifier,
    onAction: (Message, MessageAction) -> Unit = { _, _ -> },
    /** An existing reaction was tapped: add it, or take it back if it is ours */
    onReaction: (Message, String, Boolean) -> Unit = { _, _, _ -> },
    onLoadOlder: suspend () -> Int = { 0 }
) {
    val serverId = store.activeServerId
    val channel = store.activeChannel
    val messages = if (serverId != null && channel != null) {
        store.messagesFor(serverId, channel)
    } else {
        emptyList()
    }

    val listState = rememberLazyListState()
    val myNick = serverId?.let { store.servers[it]?.nick }.orEmpty()

    // Follow the conversation on a new message, but not when older ones are
    // prepended — keying on the newest id rather than the count is what tells
    // those two apart, and jumping to the bottom mid-scrollback is maddening.
    var settled by remember(channel) { mutableStateOf(false) }
    val newest = messages.lastOrNull()?.id
    LaunchedEffect(newest, channel) {
        if (messages.isEmpty()) return@LaunchedEffect
        listState.animateScrollToItem(messages.lastIndex)
        settled = true
    }

    // Stay at the bottom when the keyboard arrives.
    //
    // A lazy list anchors to the top, so the keyboard taking half the screen
    // leaves the newest messages behind it — you tap the box to reply and the
    // thing you are replying to disappears.
    //
    // Whether to follow is decided by where the reader left the list, recorded
    // when a scroll settles. Reading it off the list at the moment the keyboard
    // opens does not work: the viewport shrinks before the IME reports itself
    // visible, so by then the list is no longer at the bottom and the answer is
    // always "no".
    var pinnedToBottom by remember(channel) { mutableStateOf(true) }
    var tallestSeen by remember(channel) { mutableStateOf(0) }
    LaunchedEffect(channel) {
        snapshotFlow { listState.isScrollInProgress }
            .filter { moving -> !moving }
            .collect { pinnedToBottom = !listState.canScrollForward }
    }

    // The list's own height, not the IME insets. The window is set to resize for
    // the keyboard, which means the system shrinks the window and reports no
    // inset at all — `WindowInsets.ime` is flatly zero here, and anything built
    // on it never fires.
    LaunchedEffect(channel) {
        snapshotFlow { listState.layoutInfo.viewportSize.height }
            .filter { height -> height > 0 }
            .collect { height ->
                // The count is read here rather than captured: this effect
                // outlives the composition that started it, and when a channel
                // is opened its history has not arrived yet — a captured list
                // is empty for the whole life of the conversation.
                val last = listState.layoutInfo.totalItemsCount - 1
                if (height < tallestSeen && pinnedToBottom && last >= 0) {
                    listState.scrollToItem(last)
                }
                tallestSeen = maxOf(tallestSeen, height)
            }
    }

    // Reaching the top asks for more.
    //
    // One long-lived effect per conversation, watching the scroll position
    // through a flow. Keying it on the message count instead — the obvious
    // thing — cancels the fetch every time somebody speaks, and a cancelled
    // fetch looks exactly like "there is nothing older", which silently ends
    // scrollback for the rest of the session.
    var loading by remember(channel) { mutableStateOf(false) }
    var reachedStart by remember(channel) { mutableStateOf(false) }

    LaunchedEffect(channel, serverId) {
        // Opening a conversation puts us at the top for a frame before the
        // scroll to the newest message lands. Asking for history there fetches
        // a page nobody wanted and, worse, does it before there is anything to
        // page back from.
        snapshotFlow { listState.firstVisibleItemIndex }
            .filter { first -> first <= 2 && settled }
            .collect {
                if (loading || reachedStart) return@collect
                loading = true
                try {
                    // A negative answer means "could not ask yet", which is not
                    // the same as "there is no more" and must not end paging.
                    val added = onLoadOlder()
                    if (added == 0) reachedStart = true
                } finally {
                    loading = false
                }
            }
    }

    if (messages.isEmpty()) {
        EmptyConversation(channel, modifier)
        return
    }

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize().background(Base),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 8.dp),
        // A conversation grows from the bottom. Filling from the top leaves the
        // newest message stranded at the far end of an empty screen, which is
        // both odd to look at and further from your thumb.
        verticalArrangement = Arrangement.Bottom
    ) {
        if (loading) item { LoadingOlder() }

        indexed(messages) { index, message ->
            val previous = messages.getOrNull(index - 1)
            val newDay = previous == null || !sameDay(previous.timestamp, message.timestamp)
            val grouped = !newDay &&
                previous?.nick == message.nick &&
                previous.type == message.type &&
                withinFiveMinutes(previous.timestamp, message.timestamp)

            if (newDay) DayDivider(message.timestamp)
            MessageRow(store, serverId, message, grouped, messages, myNick, onAction, onReaction)
        }
    }
}

/** `itemsIndexed` for a plain List, so the call site above stays readable */
private inline fun <T> LazyListScope.indexed(
    items: List<T>,
    crossinline content: @Composable (Int, T) -> Unit
) = items(items.size) { index -> content(index, items[index]) }

/** Something is happening above the fold, so the list does not just sit still */
@Composable
private fun LoadingOlder() {
    Text(
        "Loading older messages…",
        color = Overlay,
        fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center
    )
}

@Composable
private fun EmptyConversation(channel: String?, modifier: Modifier) {
    Box(
        modifier = modifier.fillMaxSize().background(Base).padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                channel ?: "Switchboard",
                color = Text0,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(6.dp))
            Text(
                when {
                    channel == null -> "Pick a channel to start reading."
                    isChannel(channel) -> "This is the beginning of $channel."
                    else -> "Say something to $channel."
                },
                color = Overlay,
                fontSize = 14.sp
            )
        }
    }
}

@Composable
private fun DayDivider(timestamp: String) {
    val instant = parseTime(timestamp) ?: return
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(Modifier.weight(1f).height(1.dp).background(Surface0))
        Text(
            DAY_FORMAT.format(instant),
            color = Subtext,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
        Box(Modifier.weight(1f).height(1.dp).background(Surface0))
    }
}

private const val GUTTER = 56 // avatar width plus its gap, so grouped lines line up

/** What a long press on a message offers */
enum class MessageAction { Reply, React, Copy, Edit, Redact }

@Composable
private fun MessageRow(
    store: SwitchboardStore,
    serverId: String?,
    message: Message,
    grouped: Boolean,
    all: List<Message>,
    myNick: String,
    onAction: (Message, MessageAction) -> Unit,
    onReaction: (Message, String, Boolean) -> Unit
) {
    var showActions by remember(message.id) { mutableStateOf(false) }
    val profile = if (serverId != null) {
        store.metadataFor(serverId, message.nick)
    } else {
        UserMetadata()
    }
    val name = profile.displayName?.takeIf { it.isNotBlank() } ?: message.nick
    val color = metadataColor(profile.color) ?: nickColor(message.nick)

    // A /me reads as a sentence about the person, not a line from them
    val ctcp = message.content.trim(CTCP)
    val action = ctcp.startsWith("ACTION ")
    val body = if (action) ctcp.removePrefix("ACTION ") else message.content

    Column(modifier = Modifier.fillMaxWidth()) {

    // The line being answered, quoted above so the reply makes sense on its own
    message.replyTo?.let { parentId ->
        all.firstOrNull { it.id == parentId }?.let { parent ->
            ReplyPreview(store, serverId, parent)
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = {},
                onLongClick = { showActions = true }
            )
            .padding(start = 16.dp, end = 16.dp, top = if (grouped) 1.dp else 10.dp)
    ) {
        if (grouped) {
            Spacer(Modifier.width(GUTTER.dp))
        } else {
            Avatar(message.nick, 40.dp, color)
            Spacer(Modifier.width(16.dp))
        }

        Column(modifier = Modifier.weight(1f)) {
            if (!grouped) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(name, color = color, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    profile.pronouns?.takeIf { it.isNotBlank() }?.let {
                        Pill(it, Overlay)
                    }
                    parseTime(message.timestamp)?.let {
                        Text(TIME_FORMAT.format(it), color = Overlay, fontSize = 11.sp)
                    }
                }
                Spacer(Modifier.height(2.dp))
            }

            when {
                action -> Text(
                    "$name $body",
                    color = Mauve,
                    fontSize = 15.sp,
                    fontStyle = FontStyle.Italic,
                    lineHeight = 21.sp
                )

                message.type == "notice" -> NoticeBody(body)

                message.redactedBy != null -> Text(
                    "Message removed by ${message.redactedBy}",
                    color = Overlay,
                    fontSize = 14.sp,
                    fontStyle = FontStyle.Italic
                )

                else -> Linkified(body, message.editedAt != null) { showActions = true }
            }

            if (message.reactions.isNotEmpty()) {
                Spacer(Modifier.height(5.dp))
                Reactions(message, myNick) { emoji, mine -> onReaction(message, emoji, mine) }
            }
        }
    }

    if (showActions) {
        MessageActions(
            mine = myNick.isNotEmpty() && message.nick.equals(myNick, true),
            onDismiss = { showActions = false },
            onPick = { action ->
                showActions = false
                onAction(message, action)
            }
        )
    }
    }
}

/** The message being answered, one line, above the reply */
@Composable
private fun ReplyPreview(store: SwitchboardStore, serverId: String?, parent: Message) {
    val profile = serverId?.let { store.metadataFor(it, parent.nick) }
    val name = profile?.displayName?.takeIf { it.isNotBlank() } ?: parent.nick

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (GUTTER + 16).dp, end = 16.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.width(2.dp).height(14.dp).background(Surface1, RoundedCornerShape(1.dp)))
        Spacer(Modifier.width(8.dp))
        Text(
            name,
            color = metadataColor(profile?.color) ?: nickColor(parent.nick),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.width(6.dp))
        Text(
            parent.content.replace('\n', ' '),
            color = Overlay,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** Emoji people have added, with a count once more than one person agrees */
@Composable
private fun Reactions(message: Message, myNick: String, onTap: (String, Boolean) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((emoji, people) in message.reactions) {
            // Yours is marked, and tapping it takes it back — the same chip the
            // desktop draws, down to always showing the count.
            val mine = myNick.isNotEmpty() && people.any { it.equals(myNick, true) }
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (mine) Blue.copy(alpha = 0.22f) else Surface0)
                    .clickable { onTap(emoji, mine) }
                    .padding(horizontal = 8.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(emoji, fontSize = 13.sp)
                Spacer(Modifier.width(5.dp))
                Text(
                    people.size.toString(),
                    color = if (mine) Blue else Subtext,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
private fun MessageActions(
    mine: Boolean,
    onDismiss: () -> Unit,
    onPick: (MessageAction) -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Mantle) {
        Column(modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            // Editing and deleting are only offered on your own messages —
            // the server would refuse anything else, and an option that always
            // fails is worse than no option.
            val actions = buildList {
                add(MessageAction.Reply to "Reply")
                add(MessageAction.React to "Add a reaction")
                add(MessageAction.Copy to "Copy text")
                if (mine) {
                    add(MessageAction.Edit to "Edit")
                    add(MessageAction.Redact to "Delete")
                }
            }
            for ((action, label) in actions) {
                Text(
                    label,
                    color = if (action == MessageAction.Redact) Red else Text0,
                    fontSize = 16.sp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(action) }
                        .padding(horizontal = 24.dp, vertical = 16.dp)
                )
            }
        }
    }
}

/** A notice is the server talking, and it should not look like a person talking */
@Composable
private fun NoticeBody(text: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .width(3.dp)
                .height(20.dp)
                .background(Yellow, RoundedCornerShape(2.dp))
        )
        Spacer(Modifier.width(8.dp))
        Text(text, color = Subtext, fontSize = 14.sp, lineHeight = 20.sp)
    }
}

/**
 * IRC formatting codes, rendered rather than shown.
 *
 * Bold, italic, underline and monospace are the four that people actually use
 * in conversation; colour codes are stripped rather than drawn, since a palette
 * chosen against a white mIRC background is unreadable here.
 */
private const val CTCP = '\u0001'
private const val BOLD = '\u0002'
private const val ITALIC = '\u001D'
private const val UNDERLINE = '\u001F'
private const val MONOSPACE = '\u0011'
private const val RESET = '\u000F'
private const val COLOUR = '\u0003'

private fun formatted(text: String) = buildAnnotatedString {
    var bold = false
    var italic = false
    var underline = false
    var mono = false
    var index = 0

    fun style() = SpanStyle(
        fontWeight = if (bold) FontWeight.Bold else null,
        fontStyle = if (italic) FontStyle.Italic else null,
        textDecoration = if (underline) {
            androidx.compose.ui.text.style.TextDecoration.Underline
        } else {
            null
        },
        fontFamily = if (mono) FontFamily.Monospace else null
    )

    val run = StringBuilder()
    fun flush() {
        if (run.isEmpty()) return
        withStyle(style()) { append(run.toString()) }
        run.clear()
    }

    while (index < text.length) {
        when (text[index]) {
            BOLD -> { flush(); bold = !bold; index++ }
            ITALIC -> { flush(); italic = !italic; index++ }
            UNDERLINE -> { flush(); underline = !underline; index++ }
            MONOSPACE -> { flush(); mono = !mono; index++ }
            RESET -> {
                flush()
                bold = false; italic = false; underline = false; mono = false
                index++
            }
            COLOUR -> {
                // Colour: skip "NN" or "NN,NN" rather than printing digits
                flush()
                index++
                var digits = 0
                while (index < text.length && text[index].isDigit() && digits < 2) {
                    index++; digits++
                }
                if (index < text.length && text[index] == ',' &&
                    index + 1 < text.length && text[index + 1].isDigit()
                ) {
                    index++
                    digits = 0
                    while (index < text.length && text[index].isDigit() && digits < 2) {
                        index++; digits++
                    }
                }
            }
            else -> { run.append(text[index]); index++ }
        }
    }
    flush()
}

/**
 * Message text with its links made real.
 *
 * A URL you cannot tap is a URL you have to retype, which on a phone is the
 * difference between following a link and not bothering.
 */
@Composable
private fun Linkified(text: String, edited: Boolean, onLongPress: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    val styled = formatted(text)

    val annotated = buildAnnotatedString {
        append(styled)
        for (match in LINK.findAll(text)) {
            addStyle(
                SpanStyle(color = Blue, textDecoration = TextDecoration.Underline),
                match.range.first,
                match.range.last + 1
            )
            addStringAnnotation("url", match.value, match.range.first, match.range.last + 1)
        }
        // Quiet, and attached to the text rather than floating beside it, so a
        // corrected message still reads as one thing
        if (edited) {
            withStyle(SpanStyle(color = Overlay, fontSize = 11.sp)) { append("  (edited)") }
        }
    }

    // Both gestures live here, and they have to. A tap handler on the text
    // consumes the touch before the row's long-press detector ever sees it —
    // which is how making links tappable silently removed the message menu.
    var layout by remember(annotated) { mutableStateOf<TextLayoutResult?>(null) }

    Text(
        text = annotated,
        style = TextStyle(color = Text0, fontSize = 15.sp, lineHeight = 21.sp),
        onTextLayout = { layout = it },
        modifier = Modifier.pointerInput(annotated) {
            detectTapGestures(
                onLongPress = { onLongPress() },
                onTap = { position ->
                    val offset = layout?.getOffsetForPosition(position) ?: return@detectTapGestures
                    annotated.getStringAnnotations("url", offset, offset).firstOrNull()?.let {
                        runCatching { uriHandler.openUri(it.item) }
                    }
                }
            )
        }
    )
}

/**
 * What counts as a link.
 *
 * Deliberately conservative: a scheme and a host, stopping before trailing
 * punctuation, because a URL at the end of a sentence should not swallow the
 * full stop.
 */
private val LINK = Regex("""https?://[^\s<>\"]+[^\s<>\".,!?;:)\]}]""")
