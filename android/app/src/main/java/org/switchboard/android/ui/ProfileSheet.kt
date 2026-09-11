@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.UserMetadata
import org.switchboard.android.irc.Powers
import org.switchboard.android.isChannel
import org.switchboard.android.setMemberMode
import org.switchboard.android.kick
import org.switchboard.android.unwatchNicks
import org.switchboard.android.watchNicks
import org.switchboard.android.savedProfile
import org.switchboard.android.setProfile
import org.switchboard.android.storedProfile
import org.switchboard.android.resetProfile
import org.switchboard.android.GLOBAL_SCOPE
import org.switchboard.android.irc.Profile
import org.switchboard.android.whois

/**
 * Someone's profile.
 *
 * Tapping a name in the member list used to do nothing at all. What IRC knows
 * about a person is thin — a nick, a host, maybe an account — and
 * `draft/metadata-2` is what fills that out, so this is mostly a window onto
 * the metadata the rest of the app already renders in miniature.
 */
@Composable
fun ProfileSheet(
    engine: SwitchboardEngine,
    nick: String,
    onDismiss: () -> Unit,
    onMessage: (String) -> Unit
) {
    val store = engine.store
    val serverId = store.activeServerId
    val profile = serverId?.let { store.metadataFor(it, nick) } ?: UserMetadata()
    val colour = metadataColor(profile.color) ?: nickColor(nick)

    // The server may know more than we do; ask while the sheet is open
    LaunchedEffect(nick) {
        serverId?.let { engine.whois(it, nick) }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Mantle) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(nick, 64.dp, colour, avatar = profile.avatar)
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(
                        profile.displayName?.takeIf { it.isNotBlank() } ?: nick,
                        color = Text0,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(nick, color = Overlay, fontSize = 14.sp)
                        profile.pronouns?.takeIf { it.isNotBlank() }?.let {
                            Spacer(Modifier.width(8.dp))
                            Pill(it, Mauve)
                        }
                    }
                }
            }

            profile.status?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = Subtext, fontSize = 15.sp, lineHeight = 21.sp)
            }

            profile.homepage?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = Blue, fontSize = 14.sp)
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { onMessage(nick) },
                colors = ButtonDefaults.buttonColors(containerColor = Blue, contentColor = Crust),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                Text("Message $nick", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }

            // What you may do to them here, if anything.
            //
            // Decided by [Powers] from what this network's ISUPPORT says its
            // roles are and what the two of you are wearing in this channel.
            // Nothing is offered to somebody with no rank: the desktop used to
            // show Kick to everybody and let the server answer 482, which
            // teaches people that half a menu is a lie.
            val channel = store.activeChannel
            if (serverId != null && channel != null && isChannel(channel)) {
                val tokens = store.isupport[serverId].orEmpty()
                val here = store.membersFor(serverId, channel)
                val them = here.firstOrNull { it.nick.equals(nick, true) }
                val me = here.firstOrNull { it.nick.equals(store.servers[serverId]?.nick, true) }
                val isSelf = nick.equals(store.servers[serverId]?.nick, true)

                val offered = Powers.actionsFor(
                    prefix = tokens["PREFIX"],
                    chanmodes = tokens["CHANMODES"],
                    mine = me?.prefixes?.joinToString("").orEmpty(),
                    theirs = them?.prefixes?.joinToString("").orEmpty(),
                    isSelf = isSelf
                ).filter { it != Powers.Action.WHOIS && it != Powers.Action.MESSAGE }

                if (offered.isNotEmpty()) {
                    Spacer(Modifier.height(18.dp))
                    Text(
                        "IN ${channel.uppercase()}",
                        color = Overlay,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(6.dp))

                    val mask = Powers.banMask(nick, them?.host)
                    val weak = Powers.maskIsWeak(them?.host)
                    val quiet = Powers.quietMode(
                        tokens["CHANMODES"],
                        Powers.parsePrefix(tokens["PREFIX"])
                    )

                    for (action in offered) {
                        val (label, colour) = when (action) {
                            Powers.Action.VOICE -> "Give voice" to Green
                            Powers.Action.DEVOICE -> "Take voice" to Subtext
                            Powers.Action.HALFOP -> "Make half-operator" to Green
                            Powers.Action.DEHALFOP -> "Remove half-operator" to Subtext
                            Powers.Action.OP -> "Make operator" to Green
                            Powers.Action.DEOP -> "Remove operator" to Subtext
                            Powers.Action.KICK -> "Kick from $channel" to Red
                            // Names the mask, because banning a nick is undone
                            // by changing it and that is worth knowing before
                            // pressing the button rather than after.
                            Powers.Action.BAN ->
                                (if (weak) "Ban $mask (nick only)" else "Ban $mask") to Red
                            Powers.Action.MUTE ->
                                (if (weak) "Mute $mask (nick only)" else "Mute $mask") to Yellow
                            else -> continue
                        }

                        val destructive =
                            action == Powers.Action.KICK || action == Powers.Action.BAN
                        var confirming by remember(nick, action) { mutableStateOf(false) }

                        // Kicking and banning are not undone by pressing again,
                        // so they ask twice. Giving somebody voice is.
                        SecondaryAction(
                            if (destructive && confirming) "Tap again to confirm" else label,
                            colour
                        ) {
                            if (destructive && !confirming) {
                                confirming = true
                                return@SecondaryAction
                            }
                            when (action) {
                                Powers.Action.VOICE ->
                                    engine.setMemberMode(serverId, channel, "+v", nick)
                                Powers.Action.DEVOICE ->
                                    engine.setMemberMode(serverId, channel, "-v", nick)
                                Powers.Action.HALFOP ->
                                    engine.setMemberMode(serverId, channel, "+h", nick)
                                Powers.Action.DEHALFOP ->
                                    engine.setMemberMode(serverId, channel, "-h", nick)
                                Powers.Action.OP ->
                                    engine.setMemberMode(serverId, channel, "+o", nick)
                                Powers.Action.DEOP ->
                                    engine.setMemberMode(serverId, channel, "-o", nick)
                                Powers.Action.KICK ->
                                    engine.kick(serverId, channel, nick, null)
                                Powers.Action.BAN ->
                                    engine.setMemberMode(serverId, channel, "+b", mask)
                                Powers.Action.MUTE ->
                                    engine.setMemberMode(serverId, channel, "+${quiet ?: 'q'}", mask)
                                else -> {}
                            }
                            onDismiss()
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }

            // MONITOR: the server tells us when they come and go, so this works
            // while the app is asleep in a way that polling never could.
            Spacer(Modifier.height(10.dp))
            val watching = serverId != null && store.watchedFor(serverId).any { it.equals(nick, true) }
            SecondaryAction(
                if (watching) "Stop watching for $nick" else "Tell me when $nick is online",
                Mauve
            ) {
                if (serverId == null) return@SecondaryAction
                if (watching) engine.unwatchNicks(serverId, listOf(nick))
                else engine.watchNicks(serverId, listOf(nick))
            }

        }
    }
}

/** A row of text that does something, under the primary button */
@Composable
private fun SecondaryAction(label: String, colour: Color, onClick: () -> Unit) {
    Text(
        label,
        color = colour,
        fontSize = 14.sp,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center
    )
}

/**
 * Your own profile, edited here.
 *
 * The six keys the IRCv3 registry defines for describing a person. IRC has no
 * global anything — every network is told separately — so "everywhere" is this
 * client's own idea, kept in the shared config and published to each network on
 * connect. A network with nothing of its own follows it; one that has been
 * given something of its own differs only in what it was given.
 */
@Composable
fun EditProfileSheet(engine: SwitchboardEngine, onDismiss: () -> Unit) {
    val store = engine.store
    val serverId = store.activeServerId
    val server = serverId?.let { store.servers[it] }
    val nick = server?.nick.orEmpty()
    val networkName = server?.name?.takeIf { it.isNotBlank() } ?: "this network"

    // What the network echoed back about us. Not the source of truth — a
    // server without `draft/metadata-2` echoes nothing at all — but it is the
    // only thing that knows about a profile set from some other client.
    val echoed = serverId?.let { store.metadataFor(it, nick) } ?: UserMetadata()

    var global by remember { mutableStateOf(emptyMap<String, String>()) }
    var override by remember { mutableStateOf(emptyMap<String, String>()) }
    var loaded by remember { mutableStateOf(false) }

    /**
     * Which profile the fields are showing.
     *
     * Starts on whichever one this network is actually using, so opening the
     * editor on a network you have given something different does not look
     * like your profile has changed.
     */
    var scopeIsServer by remember { mutableStateOf(false) }

    LaunchedEffect(serverId) {
        global = engine.savedProfile()
        override = serverId?.let { engine.storedProfile(it) }.orEmpty()
        scopeIsServer = Profile.hasOverride(override)
        loaded = true
    }

    val fields = remember { mutableStateMapOf<String, String>() }

    /**
     * What the scope being edited says right now, which is what Save is
     * measured against. Comparing against the server's echo instead meant
     * editing the global from a network that has its own profile compared two
     * different profiles — saving fields nobody touched, skipping ones they had.
     */
    val baseline = remember(loaded, scopeIsServer, global, override, echoed) {
        val values = if (!scopeIsServer) global else buildMap {
            putAll(Profile.resolve(global, override))
            // Only where neither profile says anything: a network's own echo
            // is better than a blank form that would wipe it on save, and
            // worse than anything you actually set.
            for ((key, value) in echoed.asFields()) {
                if (value.isNotBlank() && get(key).isNullOrBlank()) put(key, value)
            }
        }
        PROFILE_FIELDS.associate { (key, _, _) -> key to values[key].orEmpty() }
    }

    // Swapping between them shows what that one actually says
    LaunchedEffect(baseline) {
        fields.clear()
        fields.putAll(baseline)
    }

    var saving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // A form opens fully. Starting half-height puts the primary action below
    // the fold, and the swipe that would reach it drags the sheet shut.
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Mantle,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(horizontal = 24.dp)) {
                Text("Your profile", color = Text0, fontSize = 20.sp, fontWeight = FontWeight.Bold)

                if (serverId != null) {
                    Spacer(Modifier.height(12.dp))
                    ScopeSwitch(
                        networkName = networkName,
                        scopeIsServer = scopeIsServer,
                        onPick = {
                            problem = null
                            note = null
                            scopeIsServer = it
                        }
                    )
                }

                Spacer(Modifier.height(8.dp))
                Text(
                    when {
                        serverId == null || !scopeIsServer ->
                            "Who you are on every network that has not been given " +
                                "something different. Each of these is a separate thing, " +
                                "so you can leave any of them blank."
                        Profile.hasOverride(override) ->
                            "Only on $networkName. Anything left blank here is cleared on " +
                                "this network rather than falling back to your profile."
                        else ->
                            "This network follows your profile. Change something here and " +
                                "only this network changes."
                    },
                    color = Overlay,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )

                // The way out of having a profile of your own here. Without it
                // the only way back is typing your global values in field by
                // field until the difference disappears, which is not
                // something anyone would guess.
                if (serverId != null && scopeIsServer && Profile.hasOverride(override)) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Use my profile here instead",
                        color = Blue,
                        fontSize = 13.sp,
                        modifier = Modifier.clickable {
                            scope.launch {
                                engine.resetProfile(serverId)
                                override = emptyMap()
                                scopeIsServer = false
                            }
                        }
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            // The fields scroll; Save does not. A sheet tall enough to need
            // scrolling puts its primary action below the fold, and the swipe
            // that would reach it drags the sheet shut instead.
            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
            ) {
                for ((key, label, hint) in PROFILE_FIELDS) {
                    ProfileField(
                        label = label,
                        hint = hint,
                        value = fields[key].orEmpty(),
                        onChange = { fields[key] = it }
                    )
                    Spacer(Modifier.height(12.dp))
                }
            }

            // Whatever the save had to say. A form that closes on failure is
            // how six filled-in fields disappear without anyone noticing.
            problem?.let { Message(it, Red) }
            note?.let { Message(it, Yellow) }

            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    saving = true
                    problem = null
                    note = null
                    scope.launch {
                        // `global` is the one you carry; a serverId is this
                        // network only.
                        val target = if (scopeIsServer && serverId != null) serverId else GLOBAL_SCOPE

                        // Only what changed. Writing all six reseals the shared
                        // config six times and sends five METADATA lines saying
                        // what the server already knows.
                        val results = fields.mapNotNull { (key, value) ->
                            if (value.trim() == baseline[key].orEmpty().trim()) null
                            else engine.setProfile(target, key, value.trim())
                        }
                        if (target == GLOBAL_SCOPE) global = engine.savedProfile()
                        else if (serverId != null) override = engine.storedProfile(serverId)
                        saving = false

                        when {
                            results.any { !it.saved } -> {
                                problem = results.firstOrNull { !it.saved }?.reason
                                    ?: "Could not save your profile"
                            }
                            // Saved, but this network cannot show it to anyone.
                            // Worth saying once, and worth staying open to say.
                            results.any { !it.published } -> {
                                note = results.firstOrNull { !it.published }?.reason
                                    ?: "Saved, but not published here"
                            }
                            else -> onDismiss()
                        }
                    }
                },
                // Always. Saving your own profile does not need a network,
                // and a form that will not take what you typed is worse than
                // one that says it cannot send it yet.
                enabled = !saving,
                colors = ButtonDefaults.buttonColors(containerColor = Blue, contentColor = Crust),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .height(48.dp)
            ) {
                Text(
                    when {
                        saving -> "Saving…"
                        note != null -> "Done"
                        else -> "Save"
                    },
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

/**
 * Everywhere, or here.
 *
 * The same two-button switch the desktop shows, in the same order and with the
 * same words, because the thing it chooses between is the same thing.
 */
@Composable
private fun ScopeSwitch(
    networkName: String,
    scopeIsServer: Boolean,
    onPick: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Surface0)
            .padding(2.dp)
    ) {
        for (server in listOf(false, true)) {
            val picked = scopeIsServer == server
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (picked) Surface1 else Color.Transparent)
                    .clickable { onPick(server) }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    if (server) "On $networkName" else "Everywhere",
                    color = if (picked) Text0 else Overlay,
                    fontSize = 13.sp,
                    fontWeight = if (picked) FontWeight.Bold else FontWeight.Normal,
                    maxLines = 1
                )
            }
        }
    }
}

/** The registry's keys, with words a person would use for them */
private val PROFILE_FIELDS = listOf(
    Triple("display-name", "Display name", "Shown instead of your nick"),
    Triple("pronouns", "Pronouns", "they/them"),
    Triple("status", "Status", "What you are up to"),
    Triple("avatar", "Avatar URL", "https://example.com/you.png"),
    Triple("homepage", "Homepage", "https://example.com"),
    Triple("color", "Colour", "#89b4fa")
)

@Composable
private fun ProfileField(
    label: String,
    hint: String,
    value: String,
    onChange: (String) -> Unit
) {
    Column {
        Text(label.uppercase(), color = Overlay, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(hint, color = Overlay, fontSize = 14.sp) },
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Surface0,
                unfocusedContainerColor = Surface0,
                focusedTextColor = Text0,
                unfocusedTextColor = Text0,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Blue
            ),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

/** A line of explanation under the form, in the colour of the news it carries */
@Composable
private fun Message(text: String, colour: Color) {
    Spacer(Modifier.height(12.dp))
    Text(
        text,
        color = colour,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp)
    )
}
