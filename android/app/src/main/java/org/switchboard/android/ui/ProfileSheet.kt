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
import org.switchboard.android.kick
import org.switchboard.android.unwatchNicks
import org.switchboard.android.watchNicks
import org.switchboard.android.setProfile
import org.switchboard.android.storedProfile
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
                Avatar(nick, 64.dp, colour)
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

            // Only where it could work: a channel we are in, and someone who is
            // not us. Whether we hold ops is the server's call, and it says so
            // by refusing — offering the option is not the same as promising it.
            val channel = store.activeChannel
            val me = serverId?.let { store.servers[it]?.nick }
            if (serverId != null && channel != null && channel.startsWith("#") &&
                !nick.equals(me, true)
            ) {
                var confirming by remember(nick) { mutableStateOf(false) }
                Spacer(Modifier.height(2.dp))
                SecondaryAction(
                    if (confirming) "Tap again to kick $nick from $channel" else "Kick from $channel",
                    Red
                ) {
                    if (confirming) {
                        engine.kick(serverId, channel, nick, null)
                        onDismiss()
                    } else {
                        confirming = true
                    }
                }
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
 * The six keys the IRCv3 registry defines for describing a person. They travel
 * per network rather than per account, which is why this is edited against the
 * server you are looking at rather than in one global place.
 */
@Composable
fun EditProfileSheet(engine: SwitchboardEngine, onDismiss: () -> Unit) {
    val store = engine.store
    val serverId = store.activeServerId
    val nick = serverId?.let { store.servers[it]?.nick }.orEmpty()
    val current = serverId?.let { store.metadataFor(it, nick) } ?: UserMetadata()

    val fields = remember(nick) {
        mutableStateMapOf(
            "display-name" to current.displayName.orEmpty(),
            "pronouns" to current.pronouns.orEmpty(),
            "status" to current.status.orEmpty(),
            "avatar" to current.avatar.orEmpty(),
            "homepage" to current.homepage.orEmpty(),
            "color" to current.color.orEmpty()
        )
    }

    // What you set beats what the server echoed back.
    //
    // For your own profile the stored copy is the honest one: a network without
    // `draft/metadata-2` echoes nothing at all, and at least one echoes a
    // cleared key back as its own name. Received metadata is still worth
    // having — it is all we have for everyone else — so it fills the blanks.
    LaunchedEffect(serverId) {
        val stored = serverId?.let { engine.storedProfile(it) } ?: return@LaunchedEffect
        for ((key, value) in stored) {
            if (value.isNotBlank()) fields[key] = value
        }
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
                Spacer(Modifier.height(4.dp))
                Text(
                    "Shown to everyone on this network. Each of these is a separate " +
                        "thing the server stores, so you can leave any of them blank.",
                    color = Overlay,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )
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
                    if (serverId == null) return@Button
                    saving = true
                    problem = null
                    note = null
                    scope.launch {
                        val results = fields.map { (key, value) ->
                            engine.setProfile(serverId, key, value.trim())
                        }
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
                enabled = serverId != null && !saving,
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
