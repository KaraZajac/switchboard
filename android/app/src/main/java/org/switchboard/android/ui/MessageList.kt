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
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.draw.drawBehind
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
import org.switchboard.android.JumpTarget
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.irc.Editing
import org.switchboard.android.irc.Jump
import org.switchboard.android.LinkPreview
import org.switchboard.android.UserMetadata
import org.switchboard.android.isChannel
import org.switchboard.android.irc.Formatting
import org.switchboard.android.irc.Links
import org.switchboard.android.mentionsYou
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImagePainter
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import org.switchboard.android.irc.Attachment

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
    /** What a link points at, fetched through whichever client is connected */
    onPreview: suspend (String) -> LinkPreview? = { null },
    onLoadOlder: suspend () -> Int = { 0 },
    /** Fetch the conversation around a moment, for a jump that cannot scroll yet */
    onLoadAround: suspend (serverId: String, channel: String, at: String) -> Unit = { _, _, _ -> },
    /** Somebody's name or avatar was tapped: open their card */
    onProfile: (String) -> Unit = {}
) {
    val serverId = store.activeServerId
    val channel = store.activeChannel
    val messages = if (serverId != null && channel != null) {
        store.messagesFor(serverId, channel)
    } else {
        emptyList()
    }

    val listState = rememberLazyListState()
    // One fetch per jump: asking again on the answer is a loop
    var jumpFetched by remember(channel) { mutableStateOf(false) }
    val myNick = serverId?.let { store.servers[it]?.nick }.orEmpty()
    val entryPoint = if (serverId != null && channel != null) {
        store.entryPoint(serverId, channel)
    } else {
        null
    }

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

    /*
     * Going to one line, rather than to the room it was said in.
     *
     * Two steps because it can be two: [Jump.plan] says whether the loaded
     * conversation can simply be scrolled — present is not enough, a line at
     * the very top has nothing above it to explain it — and when it cannot,
     * the conversation around it is fetched and the scroll happens on the next
     * pass. Whatever comes back is what there is: a channel with genuinely
     * nothing older must not be fetched for ever.
     *
     * Cleared as soon as it is acted on, or it would fight every later scroll.
     */
    var flashing by remember(channel) { mutableStateOf<String?>(null) }
    val jump = store.jumpTo

    LaunchedEffect(jump, messages.size) {
        val target = jump ?: return@LaunchedEffect
        if (target.serverId != serverId || !target.channel.equals(channel, true)) return@LaunchedEffect

        val placed = messages.map { Jump.Placed(it.id, it.timestamp) }
        val plan = Jump.plan(placed, Jump.Target(target.msgid, target.timestamp))

        if (plan == Jump.Plan.LOAD && !jumpFetched) {
            jumpFetched = true
            if (serverId != null) onLoadAround(serverId, target.channel, target.timestamp)
            return@LaunchedEffect
        }

        val at = messages.indexOfFirst {
            if (target.msgid != null) it.id == target.msgid else it.timestamp == target.timestamp
        }
        if (at >= 0) {
            listState.animateScrollToItem(at)
            // Marked for a moment. Arriving in the middle of a conversation
            // with nothing to say which line you came for is arriving nowhere.
            flashing = messages[at].id
        }
        store.jumpTo = null
        jumpFetched = false
        kotlinx.coroutines.delay(2500)
        flashing = null
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

            // The first message you had not seen when you opened this. A day
            // divider says when; this says where you left off, which after a
            // night away is the more useful of the two.
            if (!newDay && previous != null && entryPoint != null &&
                previous.timestamp <= entryPoint && message.timestamp > entryPoint
            ) {
                UnreadDivider()
            }

            if (newDay) DayDivider(message.timestamp)
            MessageRow(
                store, serverId, message, grouped, messages, myNick,
                onAction, onReaction, onPreview, onProfile,
                marked = flashing == message.id
            )
        }
    }
}

/** `itemsIndexed` for a plain List, so the call site above stays readable */
private inline fun <T> LazyListScope.indexed(
    items: List<T>,
    crossinline content: @Composable (Int, T) -> Unit
) = items(items.size) { index -> content(index, items[index]) }

/**
 * What a link points at.
 *
 * Fetched through the desktop, which does the request and the caching — the
 * phone asking sites directly would leak where its owner is and what they are
 * reading to every host anyone links.
 */
@Composable
private fun LinkCard(url: String, fetch: suspend (String) -> LinkPreview?) {
    var preview by remember(url) { mutableStateOf<LinkPreview?>(null) }

    LaunchedEffect(url) { preview = fetch(url) }

    val shown = preview ?: return
    val opener = LocalUriHandler.current

    // Not a page, so there is nothing to describe and everything to offer. A
    // link to an APK, a PDF or a log used to render as a bare blue address,
    // which says neither what it is nor how big — the two things somebody
    // decides on before tapping a forty-megabyte download on mobile data.
    if (Attachment.kind(url, shown.contentType) != Attachment.Kind.PAGE) {
        FileCard(url, shown.contentLength, opener)
        return
    }

    val title = shown.title?.takeIf { it.isNotBlank() } ?: return

    Spacer(Modifier.height(6.dp))
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(Mantle)
            // Only a link we are willing to hand to Android — see
            // [Links.safeExternal]. An ACTION_VIEW intent is attempted by
            // whatever app claims the scheme, and the string came off the wire.
            .clickable { Links.safeExternal(url)?.let { safe -> runCatching { opener.openUri(safe) } } }
            .height(IntrinsicSize.Min)
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(Blue))
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            shown.siteName?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = Overlay, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(2.dp))
            }
            Text(
                title,
                color = Blue,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            shown.description?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(3.dp))
                Text(
                    it,
                    color = Subtext,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/**
 * A file, offered rather than described.
 *
 * What Discord draws for an attachment and what a bare link cannot say: what
 * it is called, how big it is, and something to tap that means "get this".
 * Both come off the URL and the server's own headers — see [Attachment] — so
 * nothing is downloaded to draw it.
 */
@Composable
private fun FileCard(url: String, bytes: Long?, opener: androidx.compose.ui.platform.UriHandler) {
    val name = remember(url) { Attachment.name(url) }
    val size = remember(bytes) { Attachment.humanSize(bytes) }

    Spacer(Modifier.height(6.dp))
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Mantle)
            // Only a link we are willing to hand to Android — see
            // [Links.safeExternal]. A download is opened by whatever app
            // claims the scheme, and the string came off the wire.
            .clickable { Links.safeExternal(url)?.let { safe -> runCatching { opener.openUri(safe) } } }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(Surface0),
            contentAlignment = Alignment.Center
        ) {
            Text("\uD83D\uDCCE", fontSize = 18.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                name,
                color = Blue,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            // Left out rather than printed as a confident zero where the
            // server did not say how big it is
            size?.let {
                Spacer(Modifier.height(2.dp))
                Text(it, color = Overlay, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.width(8.dp))
        Text("\u2B07", color = Subtext, fontSize = 16.sp)
    }
}

/**
 * A picture somebody linked, drawn where the link is.
 *
 * The desktop has done this since the start; the phone showed the address
 * and, if the site offered one, a card with its title — and a picture has no
 * title, so nothing. Kept to a size that leaves the conversation readable
 * and opened in full by a tap. A Klipy clip is a short video: it is drawn as
 * its first frame with a play mark, because an mp4 in a scrolling list is
 * not something to start playing on its own.
 *
 * A grey block holds the place while the bytes arrive, so the list does not
 * jump when they do; if they never do, the address is shown instead, which
 * matters for a Klipy line where the address is all the message was.
 */
@Composable
private fun InlinePicture(url: String, video: Boolean) {
    val opener = LocalUriHandler.current
    var loaded by remember(url) { mutableStateOf(false) }

    Spacer(Modifier.height(6.dp))
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable { Links.safeExternal(url)?.let { safe -> runCatching { opener.openUri(safe) } } }
    ) {
        SubcomposeAsyncImage(
            model = url,
            contentDescription = if (video) "A clip" else "A picture",
            contentScale = ContentScale.Fit,
            onState = { state -> if (state is AsyncImagePainter.State.Success) loaded = true },
            modifier = Modifier.sizeIn(maxWidth = 320.dp, maxHeight = 240.dp)
        ) {
            when (painter.state) {
                is AsyncImagePainter.State.Loading, AsyncImagePainter.State.Empty -> Box(
                    Modifier.size(width = 200.dp, height = 120.dp).background(Surface0)
                )

                is AsyncImagePainter.State.Error -> Text(
                    url,
                    color = Blue,
                    fontSize = 15.sp,
                    textDecoration = TextDecoration.Underline
                )

                else -> SubcomposeAsyncImageContent()
            }
        }
        if (video && loaded) {
            Text(
                "▶",
                color = Text0,
                fontSize = 20.sp,
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(Crust.copy(alpha = 0.6f), RoundedCornerShape(50))
                    .padding(horizontal = 14.dp, vertical = 6.dp)
            )
        }
    }
}

/** A join, a part, a kick, a rename or a topic change — see [org.switchboard.android.irc.Events] */
@Composable
private fun SystemLine(message: Message) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = GUTTER + Sizes.gutter, end = 16.dp, top = 3.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            message.content,
            color = Overlay,
            fontSize = 13.sp,
            fontStyle = FontStyle.Italic,
            lineHeight = 18.sp,
            modifier = Modifier.weight(1f)
        )
        parseTime(message.timestamp)?.let {
            Text(TIME_FORMAT.format(it), color = Overlay, fontSize = 11.sp, modifier = Modifier.padding(start = 8.dp))
        }
    }
}

/** Where you left off, in the colour of something that wants noticing */
@Composable
private fun UnreadDivider() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.weight(1f).height(1.dp).background(Red.copy(alpha = 0.55f)))
        Text(
            "New messages",
            color = Red,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 10.dp)
        )
        Box(Modifier.weight(1f).height(1.dp).background(Red.copy(alpha = 0.55f)))
    }
}

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

/**
 * How far a message's text sits from the edge.
 *
 * A `Dp` now rather than a bare Int: it is the closest thing this file has to
 * a shared measurement and everything that lines up with the conversation has
 * to use it — see [Sizes.messageGutter], which is where it lives.
 */
private val GUTTER = Sizes.messageGutter // avatar width plus its gap, so grouped lines line up

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
    onReaction: (Message, String, Boolean) -> Unit,
    onPreview: suspend (String) -> LinkPreview?,
    /** Somebody's name or avatar was tapped: open their card */
    onProfile: (String) -> Unit = {},
    /** Whether this is the line somebody jumped to, for as long as that lasts */
    marked: Boolean = false
) {
    var showActions by remember(message.id) { mutableStateOf(false) }

    // A line about the room rather than from anyone in it: no avatar, no
    // name, and the desktop's grey italic
    if (message.type == "system") {
        SystemLine(message)
        return
    }

    val profile = if (serverId != null) {
        store.metadataFor(serverId, message.nick)
    } else {
        UserMetadata()
    }
    val name = profile.displayName?.takeIf { it.isNotBlank() } ?: message.nick
    val color = metadataColor(profile.color) ?: nickColor(message.nick)

    // A /me reads as a sentence about the person, not a line from them.
    //
    // Both sides strip the CTCP wrapper and say so with the type, which is what
    // this looks at — checking the wrapper alone meant every action arrived as
    // an ordinary message, because by then there was no wrapper left to find.
    // The wrapper check stays as a fallback for anything that slips through
    // with one still on.
    val ctcp = message.content.trim(CTCP)
    val wrapped = ctcp.startsWith("ACTION ")
    val action = message.type == "action" || wrapped
    val body = if (wrapped) ctcp.removePrefix("ACTION ") else message.content

    // Somebody said your name. Not our own messages, which contain it often
    // enough, and not a notice from the server, which is addressed to you by
    // definition and would light up the whole conversation.
    val mentioned = message.type != "notice" &&
        myNick.isNotEmpty() &&
        !message.nick.equals(myNick, ignoreCase = true) &&
        mentionsYou(body, myNick, store.highlightWords)
    val mentionWash = Yellow.copy(alpha = 0.07f)

    // The line somebody came for, said so for a couple of seconds
    val markWash = Blue.copy(alpha = 0.16f)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (marked) Modifier.background(markWash) else Modifier)
    ) {

    // The line being answered, quoted above so the reply makes sense on its own
    message.replyTo?.let { parentId ->
        all.firstOrNull { it.id == parentId }?.let { parent ->
            ReplyPreview(store, serverId, parent)
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            // Your name being said is the single most important thing that
            // happens in a channel, and it looked exactly like every other
            // line. The bar down the left is what every IRC client has done
            // about this since the 90s, and it reads at a glance in a way a
            // colour change does not.
            .then(
                if (mentioned) {
                    Modifier.drawBehind {
                        drawRect(mentionWash, size = size)
                        drawRect(Yellow, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height))
                    }
                } else Modifier
            )
            .combinedClickable(
                onClick = {},
                onLongClick = { showActions = true }
            )
            .padding(start = 16.dp, end = 16.dp, top = if (grouped) 1.dp else 10.dp)
    ) {
        if (grouped) {
            Spacer(Modifier.width(GUTTER))
        } else {
            Avatar(
                message.nick,
                40.dp,
                color,
                modifier = Modifier.clickable { onProfile(message.nick) },
                avatar = profile.avatar
            )
            Spacer(Modifier.width(16.dp))
        }

        Column(modifier = Modifier.weight(1f)) {
            if (!grouped) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // Tapping somebody's name opens their card, the way the
                    // member list has always done and the desktop now does.
                    // It was reachable from the member list alone, which is
                    // the one place you are not when somebody says something.
                    Text(
                        name,
                        color = color,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                        modifier = Modifier.clickable { onProfile(message.nick) }
                    )
                    // draft/oper-tag — the server naming the sender as one of
                    // its operators, which is not something a nick can claim.
                    message.oper?.let { Pill("OPERATOR", Yellow) }
                    // draft/relaymsg — carried in from somewhere else by a
                    // bridge, under the name of whoever actually wrote it
                    message.relayedBy?.let { Pill("BRIDGED", Blue) }
                    profile.pronouns?.takeIf { it.isNotBlank() }?.let {
                        Pill(it, Overlay)
                    }
                    parseTime(message.timestamp)?.let {
                        Text(TIME_FORMAT.format(it), color = Overlay, fontSize = 11.sp)
                    }
                }
                Spacer(Modifier.height(2.dp))
            }

            // Pictures are drawn, not just linked — see [InlinePicture]. A
            // Klipy address on its own is the GIF and nothing else, the way
            // Discord shows the ones its own picker sends.
            val links = remember(body) { Links.find(body) }
            val pictures = remember(body) {
                links.map { it.url }
                    .filter { Links.isImage(it) || (Links.isKlipyMedia(it) && Links.isVideo(it)) }
                    .distinct()
                    .take(4)
            }
            val onlyAPicture = links.size == 1 &&
                Links.isKlipyMedia(links[0].url) &&
                body.substring(links[0].start, links[0].end) == body.trim()

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

                onlyAPicture -> Unit

                else -> Linkified(body, message.editedAt != null) { showActions = true }
            }

            if (message.redactedBy == null) {
                for (url in pictures) InlinePicture(url, video = Links.isVideo(url))
            }

            // What a link points at, on the same accent bar the desktop uses.
            // Only the first that is not a picture — a picture is its own
            // preview — and only one: a message full of URLs should not
            // become a wall of cards on a phone screen.
            links.firstOrNull { !Links.isImage(it.url) && !Links.isVideo(it.url) }
                ?.url?.let { url -> LinkCard(url, onPreview) }

            if (message.reactions.isNotEmpty()) {
                Spacer(Modifier.height(5.dp))
                Reactions(message, myNick) { emoji, mine -> onReaction(message, emoji, mine) }
            }
        }
    }

    if (showActions) {
        MessageActions(
            mine = myNick.isNotEmpty() && message.nick.equals(myNick, true),
            // Whether it can be amended is a narrower question than whether it
            // is yours — see [Editing] and `src/shared/editing.ts`
            editable = Editing.canEdit(
                type = message.type,
                nick = message.nick,
                deleted = message.redactedBy != null,
                myNick = myNick,
                capabilities = serverId?.let { store.capabilities[it] }.orEmpty()
            ),
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
            // Tapping the quote goes to the line it quotes — see [Jump]. The
            // quote is here so the reply makes sense on its own; going there is
            // for when it does not.
            .clickable {
                if (serverId != null) {
                    store.jumpTo = JumpTarget(serverId, store.activeChannel.orEmpty(), parent.id, parent.timestamp)
                }
            }
            .padding(start = (GUTTER + Sizes.gutter), end = 16.dp, top = 8.dp),
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
    editable: Boolean,
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
                // Editing is narrower still: not on an action, whose CTCP
                // wrapper the edit does not carry, and not on a network that
                // does not carry edits at all, where the new text arrives as a
                // second message and the first stays put.
                if (editable) add(MessageAction.Edit to "Edit")
                if (mine) add(MessageAction.Redact to "Delete")
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
 * All nine of them now, through the same parser the desktop uses, so a line
 * from a channel reads the same on both devices. Colours used to be thrown
 * away here on the grounds that a palette chosen against mIRC's white
 * background is unreadable on a dark one — true, but the answer is to lift the
 * few colours that need it rather than to discard what the sender meant.
 */
private const val CTCP = '\u0001'

/** A `#rrggbb` from the palette as a Compose colour */
private fun ink(hex: String) = Color(("ff" + hex.removePrefix("#")).toLong(16))

private fun decorations(span: Formatting.Span): TextDecoration? = when {
    span.underline && span.strikethrough ->
        TextDecoration.combine(listOf(TextDecoration.Underline, TextDecoration.LineThrough))
    span.underline -> TextDecoration.Underline
    span.strikethrough -> TextDecoration.LineThrough
    else -> null
}

internal fun formatted(text: String) = buildAnnotatedString {
    for (span in Formatting.parse(text)) {
        // Reverse video swaps the two, and has to mean something even when the
        // sender never named a colour — that is the whole point of it. Standing
        // in for the unset side with the window's own colours is what makes a
        // bare reverse byte visible instead of a no-op.
        val fg = if (span.reverse) span.bg ?: "#1e1e2e" else Formatting.readableOnDark(span.fg, span.bg)
        val bg = if (span.reverse) span.fg ?: "#cdd6f4" else span.bg

        withStyle(
            SpanStyle(
                fontWeight = if (span.bold) FontWeight.Bold else null,
                fontStyle = if (span.italic) FontStyle.Italic else null,
                textDecoration = decorations(span),
                fontFamily = if (span.monospace) FontFamily.Monospace else null,
                color = fg?.let(::ink) ?: Color.Unspecified,
                background = bg?.let(::ink) ?: Color.Unspecified
            )
        ) {
            append(span.text)
        }
    }
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
        for (link in Links.find(styled.text)) {
            addStyle(
                SpanStyle(color = Blue, textDecoration = TextDecoration.Underline),
                link.start,
                link.end
            )
            addStringAnnotation("url", link.url, link.start, link.end)
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
                        Links.safeExternal(it.item)?.let { safe ->
                            runCatching { uriHandler.openUri(safe) }
                        }
                    }
                }
            )
        }
    )
}



