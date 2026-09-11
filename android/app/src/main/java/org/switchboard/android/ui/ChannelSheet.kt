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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.fetchChannelModes
import org.switchboard.android.fetchMaskList
import org.switchboard.android.irc.ChanModes
import org.switchboard.android.irc.MaskLists
import org.switchboard.android.irc.Powers
import org.switchboard.android.setChannelMode
import org.switchboard.android.setMaskListEntry
import java.text.DateFormat
import java.util.Date

/**
 * A channel's settings, and the lists it keeps.
 *
 * The same two tabs the desktop shows, for the same reason: we shipped the
 * ability to ban somebody with nowhere to see who is banned, and `CHANMODES`
 * has been parsed since the beginning with nowhere to see the answer.
 *
 * Which modes and which lists exist is the network's answer, read off
 * ISUPPORT — see [ChanModes] and [MaskLists], which the desktop shares.
 */
@Composable
fun ChannelSheet(
    engine: SwitchboardEngine,
    serverId: String,
    channel: String,
    onDismiss: () -> Unit
) {
    val store = engine.store
    val tokens = store.isupport[serverId].orEmpty()

    val lists = MaskLists.listsFor(tokens["CHANMODES"], tokens["PREFIX"])
    val settings = ChanModes.settingsFor(tokens["CHANMODES"], tokens["PREFIX"])

    var onLists by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf(lists.firstOrNull()?.mode ?: "b") }

    /**
     * Whether you could change any of this.
     *
     * Half-operator upwards, the same test the member menu applies before
     * offering a kick. Everyone can look: a channel's settings are not a
     * secret, and knowing it is moderated explains why a message went nowhere.
     */
    // Deliberately not remembered. The roster arrives after the sheet can open
    // — a NAMES reply is a round trip — and a cached "no" would leave an
    // operator looking at a read-only panel until they closed and reopened it.
    val canChange = run {
        val me = store.membersFor(serverId, channel)
            .firstOrNull { it.nick.equals(store.servers[serverId]?.nick, true) }
        Powers.canModerate(tokens["PREFIX"], me?.prefixes?.joinToString("").orEmpty())
    }

    LaunchedEffect(serverId, channel) { engine.fetchChannelModes(serverId, channel) }
    LaunchedEffect(serverId, channel, mode, onLists) {
        if (onLists) engine.fetchMaskList(serverId, channel, mode)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Mantle,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
            Text(channel, color = Text0, fontSize = 20.sp, fontWeight = FontWeight.Bold)

            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(Surface0)
                    .padding(2.dp)
            ) {
                for (tab in listOf(false to "Settings", true to "Lists")) {
                    val picked = onLists == tab.first
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (picked) Surface1 else Color.Transparent)
                            .clickable { onLists = tab.first }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            tab.second,
                            color = if (picked) Text0 else Overlay,
                            fontSize = 13.sp,
                            fontWeight = if (picked) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .heightIn(max = 460.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                if (onLists) {
                    MaskListTab(engine, serverId, channel, lists, mode, canChange) { mode = it }
                } else {
                    SettingsTab(engine, serverId, channel, settings, canChange)
                }
            }

            if (!canChange) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "You would need to be an operator here to change these.",
                    color = Overlay,
                    fontSize = 12.sp
                )
            }
            Spacer(Modifier.height(28.dp))
        }
    }
}

/** What this channel is set to */
@Composable
private fun SettingsTab(
    engine: SwitchboardEngine,
    serverId: String,
    channel: String,
    settings: List<ChanModes.Mode>,
    canChange: Boolean
) {
    val set = engine.store.modesFor(serverId, channel)
    // What is typed into a value box before it is applied, so a half-written
    // password is not sent a character at a time.
    val typed = remember { mutableStateMapOf<String, String>() }
    val scope = rememberCoroutineScope()

    if (settings.isEmpty()) {
        Text("This network states no channel modes.", color = Overlay, fontSize = 13.sp)
        return
    }

    fun apply(mode: ChanModes.Mode, on: Boolean) {
        val value = typed[mode.letter] ?: set[mode.letter].orEmpty()
        val args = ChanModes.change(mode, on, value) ?: return
        scope.launch { engine.setChannelMode(serverId, channel, args) }
    }

    for (mode in settings) {
        val on = set.containsKey(mode.letter)
        val value = typed[mode.letter] ?: set[mode.letter].orEmpty()

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 6.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Surface0)
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("${mode.label}  +${mode.letter}", color = Text0, fontSize = 14.sp)
                    Text(mode.hint, color = Overlay, fontSize = 11.sp, lineHeight = 15.sp)
                }
                Checkbox(
                    checked = on,
                    // A mode that takes a value cannot be turned *on* by a
                    // checkbox — there would be nothing to set it to — so the
                    // box only turns those off, and Set turns them on.
                    enabled = canChange && (mode.kind == ChanModes.Kind.FLAG || on),
                    onCheckedChange = { apply(mode, it) },
                    colors = CheckboxDefaults.colors(checkedColor = Blue)
                )
            }

            if (mode.kind != ChanModes.Kind.FLAG && canChange) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SheetField(
                        value = value,
                        onChange = { typed[mode.letter] = it },
                        hint = mode.placeholder ?: "Value",
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Set",
                        color = Blue,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { apply(mode, true) }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }
    }
}

/** Bans and the rest */
@Composable
private fun MaskListTab(
    engine: SwitchboardEngine,
    serverId: String,
    channel: String,
    lists: List<MaskLists.MaskList>,
    mode: String,
    canChange: Boolean,
    onPick: (String) -> Unit
) {
    var typed by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    if (lists.isEmpty()) {
        Text("This network does not keep any channel lists.", color = Overlay, fontSize = 13.sp)
        return
    }

    val list = lists.firstOrNull { it.mode == mode } ?: lists.first()
    val entries = engine.store.maskListFor(serverId, channel, list.mode)

    // Only the lists this network actually keeps
    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        for (one in lists) {
            val picked = one.mode == list.mode
            Box(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 4.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (picked) Surface1 else Surface0)
                    .clickable { onPick(one.mode) }
                    .padding(vertical = 6.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    one.label,
                    color = if (picked) Text0 else Overlay,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }

    Text(list.hint, color = Overlay, fontSize = 12.sp, lineHeight = 16.sp)
    Spacer(Modifier.height(8.dp))

    if (entries.isEmpty()) {
        Text("No ${list.entry} here.", color = Overlay, fontSize = 13.sp)
    } else {
        for (entry in entries) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 4.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Surface0)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        entry.mask,
                        color = Text0,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    val by = entry.setBy?.substringBefore('!')
                    val at = entry.setAt?.let { DateFormat.getDateInstance().format(Date(it * 1000)) }
                    if (by != null || at != null) {
                        Text(
                            listOfNotNull(by?.let { "by $it" }, at).joinToString(" · "),
                            color = Overlay,
                            fontSize = 11.sp
                        )
                    }
                }
                // Offered only where it would work — the same rule the member
                // menu uses before offering a kick.
                if (canChange) {
                    Text(
                        "Lift",
                        color = Red,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable {
                                scope.launch {
                                    engine.setMaskListEntry(
                                        serverId, channel, list.mode, entry.mask, false
                                    )
                                }
                            }
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }

    if (canChange) {
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SheetField(
                value = typed,
                onChange = { typed = it },
                hint = "A nick, or a mask",
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Add",
                color = Blue,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable {
                        if (typed.isNotBlank()) {
                            val mask = typed
                            typed = ""
                            scope.launch {
                                engine.setMaskListEntry(serverId, channel, list.mode, mask, true)
                            }
                        }
                    }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }

        // What a bare nick will actually become, before it is sent
        if (typed.isNotBlank() && MaskLists.maskToSet(typed) != typed.trim()) {
            Spacer(Modifier.height(4.dp))
            Text(
                "Will be sent as ${MaskLists.maskToSet(typed)}",
                color = Overlay,
                fontSize = 11.sp
            )
        }
    }
}


/** A small text field, in the sheet's colours */
@Composable
private fun SheetField(
    value: String,
    onChange: (String) -> Unit,
    hint: String,
    modifier: Modifier = Modifier
) {
    androidx.compose.material3.OutlinedTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        placeholder = { Text(hint, color = Overlay, fontSize = 13.sp) },
        textStyle = androidx.compose.ui.text.TextStyle(color = Text0, fontSize = 14.sp),
        shape = RoundedCornerShape(8.dp),
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Blue,
            unfocusedBorderColor = Surface1,
            cursorColor = Blue
        ),
        modifier = modifier
    )
}
