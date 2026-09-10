package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.switchboard.android.DozeWatch
import org.switchboard.android.EngineMode
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.unwatchNicks

/**
 * Settings: the shared config, and what this phone is currently doing.
 *
 * There is exactly one thing here the user must understand, so it is the only
 * thing given room: the passphrase that unlocks the config both devices share,
 * and what the phone can and cannot do without it.
 */
@Composable
fun SettingsScreen(
    engine: SwitchboardEngine,
    onBack: () -> Unit,
    onManageServers: () -> Unit,
    onUnpair: () -> Unit,
    onPairDesktop: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Base)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = Subtext,
                modifier = Modifier.size(44.dp).clickable(onClick = onBack).padding(11.dp)
            )
            Text("Settings", color = Text0, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }

        SessionCard(engine)
        AppearanceCard(engine)
        BatteryCard(engine)
        VaultCard(engine)

        Spacer(Modifier.height(8.dp))
        Text(
            "Networks",
            color = Overlay,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 20.dp, bottom = 6.dp)
        )
        Card {
            Text(
                if (engine.identity.ticket() != null)
                    "The servers this phone and your desktop share. Anything changed here is changed on both."
                else
                    "The networks this phone connects to.",
                color = Subtext,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onManageServers,
                colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Blue),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text("Manage networks", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }

        FriendsCard(engine)

        Spacer(Modifier.height(8.dp))
        Text(
            "Pairing",
            color = Overlay,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 20.dp, bottom = 6.dp)
        )
        Card {
            val paired = engine.identity.ticket() != null
            Text(
                if (paired)
                    "Forget this desktop and pair again from scratch. Your config stays on " +
                        "this phone, so it goes on working on its own."
                else
                    "Pair a desktop and the two share one set of networks and settings, and " +
                        "either can be the one that is actually connected. This phone does " +
                        "not need one — pairing is only for using both.",
                color = Subtext,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )
            Spacer(Modifier.height(10.dp))
            // What this phone proves itself with. Worth saying plainly, because
            // a copy of it is a working second phone.
            // Only once there is an identity to describe. A phone that has
            // never paired has not made one yet, and saying the keystore is
            // unusable because nothing has been sealed is simply untrue.
            if (paired) {
                Text(
                    if (engine.identity.isSealed())
                        "This phone's identity is sealed by the Android keystore, so a copy " +
                            "of it taken off the device or out of a backup is useless."
                    else
                        "This device has no usable keystore, so its identity is stored as-is. " +
                            "Anything that can read the app's files could pair as this phone.",
                    color = Subtext,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )
            }
            Spacer(Modifier.height(12.dp))
            if (paired) {
                Button(
                    onClick = onUnpair,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Surface0,
                        contentColor = Red
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Unpair", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            } else {
                Button(
                    onClick = onPairDesktop,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Surface0,
                        contentColor = Blue
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Pair a desktop", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }

        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun SessionCard(engine: SwitchboardEngine) {
    Text(
        "This device",
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 6.dp)
    )
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(8.dp).background(
                    when {
                        engine.mode == EngineMode.HOLDING -> Green
                        engine.mode == EngineMode.FOLLOWING -> Blue
                        engine.isTakingOver -> Yellow
                        else -> Overlay
                    },
                    CircleShape
                )
            )
            Spacer(Modifier.width(9.dp))
            Text(
                headingFor(engine),
                color = Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
        val detail = engine.modeDetail
        val heading = headingFor(engine)
        if (detail != heading) {
            Spacer(Modifier.height(6.dp))
            Text(detail, color = Subtext, fontSize = 13.sp, lineHeight = 18.sp)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            // Two devices or one. The sentence about handing back describes
            // something a phone that has never been paired does not do, and
            // read as an explanation of why it was not working.
            if (engine.pairedWithDesktop) {
                "The desktop takes the connections back whenever it is running. This phone " +
                    "stands in for it the rest of the time, so you are only ever logged in once."
            } else {
                "This phone connects to IRC itself. Pair a desktop and the two share one " +
                    "config and take turns; until then, everything happens here."
            },
            color = Overlay,
            fontSize = 12.sp,
            lineHeight = 17.sp
        )
    }
}

/**
 * Doze, and the one thing that actually fixes it.
 *
 * Shown only while it is a problem: a card telling someone everything is fine
 * is a card they learn to skip past, and then miss when it stops being true.
 */
/** One sentence for what this phone is doing, matching the badge in the header */
private fun headingFor(engine: SwitchboardEngine): String = when {
    engine.mode == EngineMode.HOLDING && engine.pairedWithDesktop -> "Holding the IRC connections"
    engine.mode == EngineMode.HOLDING -> "Connected"
    engine.mode == EngineMode.FOLLOWING -> "Following the desktop"
    // "Taking over" is a sentence about two devices. On a phone that has never
    // been paired it names something the reader knows nothing about, in place
    // of the perfectly ordinary thing that is happening.
    engine.isTakingOver && engine.pairedWithDesktop -> "Taking over from the desktop"
    engine.isTakingOver -> "Connecting"
    else -> "Not connected"
}

@Composable
private fun BatteryCard(engine: SwitchboardEngine) {
    val context = LocalContext.current
    if (!engine.isDozeRestricted) return

    Text(
        "Background",
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 6.dp)
    )

    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(8.dp).background(Yellow, CircleShape))
            Spacer(Modifier.width(9.dp))
            Text(
                "Android may pause this app",
                color = Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "With the screen off, Android suspends background apps to save power. " +
                "This phone still checks every few minutes, but it may not notice your " +
                "desktop has gone offline straight away.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = {
                runCatching { context.startActivity(DozeWatch.batteryExemptionIntent(context)) }
            },
            colors = ButtonDefaults.buttonColors(containerColor = Blue, contentColor = Crust),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Allow running in the background", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Switchboard holds one connection and sends no data of its own; the cost is " +
                "roughly that of any messaging app left signed in.",
            color = Overlay,
            fontSize = 12.sp,
            lineHeight = 17.sp
        )
    }
}

@Composable
private fun VaultCard(engine: SwitchboardEngine) {
    var passphrase by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }
    // On by default: a standby phone that has to be asked for a passphrase
    // after every restart cannot stand in for anything.
    var keepOpen by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    fun unlock() {
        if (working) return
        working = true
        error = null
        scope.launch {
            val opened = engine.unlockVault(passphrase, keepOpen)
            error = if (opened) null else "That is not the passphrase"
            if (opened) passphrase = ""
            working = false
        }
    }

    fun setPassphrase() {
        if (working) return
        if (passphrase.length < 8) {
            error = "Use at least eight characters — a desktop will need this to open it"
            return
        }
        working = true
        error = null
        scope.launch {
            val set = engine.setConfigPassphrase(passphrase, keepOpen)
            error = if (set) null else "Could not set that"
            if (set) passphrase = ""
            working = false
        }
    }

    Text(
        "Shared config",
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 6.dp)
    )

    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(8.dp).background(
                    if (engine.isVaultUnlocked) Green else Yellow,
                    CircleShape
                )
            )
            Spacer(Modifier.width(9.dp))
            Text(
                if (!engine.configHasPassphrase) "On this phone only"
                else if (engine.isVaultUnlocked) "Unlocked" else "Locked",
                color = Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.width(8.dp))
            if (engine.vaultVersion > 0) Pill("v${engine.vaultVersion}", Overlay)
        }

        Spacer(Modifier.height(8.dp))

        when {
            engine.configHasPassphrase && engine.isVaultUnlocked -> {
                Text(
                    if (engine.isVaultKeptOpen) {
                        "This phone can take over from the desktop on its own, including " +
                            "after a restart."
                    } else {
                        "This phone can take over from the desktop — until it restarts, " +
                            "after which it will ask for the passphrase again."
                    },
                    color = Subtext,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Fingerprint", color = Overlay, fontSize = 12.sp)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        engine.vaultFingerprint ?: "",
                        color = Text0,
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "Check this matches the desktop — if it does, both devices are using the " +
                        "same passphrase.",
                    color = Overlay,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { engine.lockVault() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Surface0,
                        contentColor = Subtext
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Lock", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }

            // The consequence first, then both ways out of it. Telling someone
            // to go and do it on a desktop is no help to someone who does not
            // have one, and this phone does not need one.
            !engine.configHasPassphrase -> {
                Text(
                    "Your servers and logins live on this phone, encrypted with a key its " +
                        "hardware keystore holds. Nothing is needed to use them.\n\n" +
                        "Choose a passphrase to share this config with a desktop. It is what " +
                        "the two devices use to open the same config; the passphrase itself " +
                        "never travels between them. Nothing here is lost by adding one.",
                    color = Subtext,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it; error = null },
                    placeholder = { Text("Choose a passphrase", color = Overlay, fontSize = 14.sp) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { setPassphrase() }),
                    enabled = !working,
                    shape = RoundedCornerShape(8.dp),
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

                error?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = Red, fontSize = 12.sp)
                }

                Spacer(Modifier.height(14.dp))

                Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.clickable { keepOpen = !keepOpen }
                ) {
                    Checkbox(
                        checked = keepOpen,
                        onCheckedChange = { keepOpen = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = Blue,
                            uncheckedColor = Overlay,
                            checkmarkColor = Crust
                        )
                    )
                    Column(modifier = Modifier.padding(top = 12.dp)) {
                        Text(
                            "Stay unlocked on this phone",
                            color = Text0,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            "Keeps you from typing this every time the app restarts. The key " +
                                "is held in the phone's hardware keystore.",
                            color = Overlay,
                            fontSize = 12.sp,
                            lineHeight = 16.sp
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { setPassphrase() },
                    enabled = !working && passphrase.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Surface0,
                        contentColor = Green
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        if (working) "Setting…" else "Set a passphrase for sharing",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp
                    )
                }
            }

            else -> {
                Text(
                    "Enter the passphrase you set on the desktop. Without it this phone can " +
                        "still watch, but it cannot take over when the desktop goes offline.",
                    color = Subtext,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it; error = null },
                    placeholder = { Text("Passphrase", color = Overlay, fontSize = 14.sp) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { unlock() }),
                    enabled = !working,
                    shape = RoundedCornerShape(8.dp),
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

                error?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = Red, fontSize = 12.sp)
                }

                Spacer(Modifier.height(14.dp))

                Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.clickable { keepOpen = !keepOpen }
                ) {
                    Checkbox(
                        checked = keepOpen,
                        onCheckedChange = { keepOpen = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = Blue,
                            uncheckedColor = Overlay,
                            checkmarkColor = Crust
                        )
                    )
                    Column(modifier = Modifier.padding(top = 12.dp)) {
                        Text(
                            "Stay unlocked on this phone",
                            color = Text0,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            "Needed for this phone to take over on its own — Android restarts " +
                                "apps in the background, and a locked config cannot connect. " +
                                "The key is stored in this phone's hardware keystore, so copying " +
                                "the app's files gets nothing; anyone holding the unlocked phone " +
                                "can use it as you can.",
                            color = Overlay,
                            fontSize = 12.sp,
                            lineHeight = 17.sp
                        )
                    }
                }

                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = { unlock() },
                        enabled = passphrase.isNotBlank() && !working,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Blue,
                            contentColor = Crust
                        ),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            if (working) "Unlocking…" else "Unlock",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp
                        )
                    }
                    if (working) {
                        Spacer(Modifier.width(12.dp))
                        CircularProgressIndicator(
                            color = Blue,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Who you are waiting for.
 *
 * MONITOR is the one IRC feature that answers "tell me when they turn up", and
 * the phone could ask for it — from a person's profile — but never show what it
 * had asked for. So a watch was something you could turn on and never off, and
 * a list you could add to and never read. This is the other half.
 *
 * Per network, because MONITOR is: the same nick on two networks is two people
 * until proven otherwise, and the server only knows about its own.
 */
@Composable
private fun FriendsCard(engine: SwitchboardEngine) {
    val store = engine.store
    val servers = store.servers.values.sortedBy { it.name.lowercase() }
    val scope = rememberCoroutineScope()

    Spacer(Modifier.height(8.dp))
    Text(
        "Friends",
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 20.dp, bottom = 6.dp)
    )
    Card {
        val anyone = servers.any { store.watchedFor(it.id).isNotEmpty() }
        if (!anyone) {
            Text(
                "Nobody yet. Open somebody's name in a channel and choose " +
                    "\"Tell me when they are online\".",
                color = Subtext,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )
            return@Card
        }

        for (server in servers) {
            val nicks = store.watchedFor(server.id).sortedBy { it.lowercase() }
            if (nicks.isEmpty()) continue

            if (servers.count { store.watchedFor(it.id).isNotEmpty() } > 1) {
                Text(
                    server.name.ifBlank { server.host },
                    color = Overlay,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
            }

            for (nick in nicks) {
                val online = store.isOnline(server.id, nick)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(9.dp)
                            .background(if (online) Green else Overlay, CircleShape)
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(nick, color = Text0, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            if (online) "Online now" else "Not on this network",
                            color = if (online) Green else Overlay,
                            fontSize = 11.sp
                        )
                    }
                    Text(
                        "Stop watching",
                        color = Red,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { engine.unwatchNicks(server.id, listOf(nick)) }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun Card(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .background(Mantle, RoundedCornerShape(12.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.Top,
        content = content
    )
}

/**
 * Choosing a theme.
 *
 * The same thirteen the desktop offers, from the same palettes — see
 * `scripts/themes.py`. Each is shown as the colours it actually is, because the
 * name of a theme tells you nothing and a row of swatches tells you everything.
 *
 * The choice is a shared setting rather than a per-device one: these two clients
 * are meant to look like one product, and picking Nord on the desktop only to
 * find Mocha in your pocket is exactly the seam this app exists to hide.
 */
@Composable
private fun AppearanceCard(engine: SwitchboardEngine) {
    Spacer(Modifier.height(8.dp))
    Text(
        "Appearance",
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 20.dp, bottom = 6.dp)
    )
    Card {
        Text(
            "Shared with your desktop, so both look the same.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )
        Spacer(Modifier.height(14.dp))

        for (palette in PALETTES) {
            val chosen = palette.id == engine.themeId
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (chosen) Surface0 else Color.Transparent)
                    .clickable { engine.setTheme(palette.id) }
                    .padding(horizontal = 10.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Swatch(palette)
                Spacer(Modifier.width(12.dp))
                Text(
                    palette.label,
                    color = if (chosen) Text0 else Subtext,
                    fontSize = 14.sp,
                    fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (chosen) {
                    Text("✓", color = Blue, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/** A theme in miniature: its background, its two accents, its text */
@Composable
private fun Swatch(palette: Palette) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(palette.base)
            .padding(5.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        for (colour in listOf(palette.accent, palette.accentSoft, palette.good, palette.text)) {
            Box(Modifier.size(9.dp).clip(CircleShape).background(colour))
        }
    }
}
