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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import org.switchboard.android.BuildConfig
import org.switchboard.android.irc.About
import org.switchboard.android.irc.Links
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import org.switchboard.android.irc.Socks
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.foundation.layout.FlowRow
import org.switchboard.android.irc.AutoAway
import org.switchboard.android.irc.Aliases
import org.switchboard.android.irc.Ignore
import org.switchboard.android.push.withdrawAllPushEndpoints
import org.switchboard.android.push.offerPushEverywhere
import org.switchboard.android.push.Push

/**
 * Settings: the shared config, and what this phone is currently doing.
 *
 * There is exactly one thing here the user must understand, so it is the only
 * thing given room: the passphrase that unlocks the config both devices share,
 * and what the phone can and cannot do without it.
 */
/** Where the source, the releases and the issue tracker live */
private const val REPOSITORY = "https://github.com/KaraZajac/switchboard"

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
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconAction(Icons.AutoMirrored.Filled.ArrowBack, "Back", onBack)
            Text("Settings", color = Text0, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }

        SessionCard(engine)

        // A locked config is the one thing on this page that stops the phone
        // working, and the banner that sends people here says "Unlock" — so it
        // goes first when it is locked rather than fourth, behind a list of
        // fourteen colour schemes somebody has to scroll past to reach it.
        val locked = !engine.isVaultUnlocked
        if (locked) VaultCard(engine)
        AppearanceCard(engine)
        PushCard(engine)
        BatteryCard(engine)
        if (!locked) VaultCard(engine)

        Spacer(Modifier.height(8.dp))
        SectionLabel("Networks")
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

        HighlightsCard(engine)
        AwayCard(engine)
        RejoinCard(engine)
        JoinsCard(engine)
        IgnoredCard(engine)
        AliasesCard(engine)
        ProxyCard(engine)

        Spacer(Modifier.height(8.dp))
        SectionLabel("Pairing")
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

        AboutCard()

        Spacer(Modifier.height(28.dp))
    }
}

/**
 * What this is, which version of it, and the terms it comes under.
 *
 * Last on the page on purpose: it is the one card nobody needs in a hurry, and
 * it is where people look when they have been told to say which version they
 * are on.
 *
 * The whole licence rather than a link to it. It is twenty-odd lines, it is
 * the thing a person is actually agreeing to, and a link is no use on a phone
 * with no signal — which, for an IRC client, is a state it is expected to be
 * useful in. It is read from the assets, where `app/build.gradle.kts` copies
 * the repository's one copy at build time, so this cannot drift from the
 * licence that actually ships.
 */
@Composable
private fun AboutCard() {
    val context = LocalContext.current
    val opener = LocalUriHandler.current

    // Read once, not on every recomposition — and forgiving of not being
    // there, because a missing asset is a build problem and not a reason for
    // the settings screen to crash in somebody's hand.
    val licence = remember {
        runCatching {
            context.assets.open("LICENSE").bufferedReader().use { it.readText() }.trim()
        }.getOrDefault("")
    }

    val built = remember { About.buildDate(BuildConfig.BUILD_DATE) }

    Spacer(Modifier.height(8.dp))
    SectionLabel("About")
    Card {
        Text("Switchboard", color = Text0, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text(
            "A modern IRC client with a Discord-like interface, fully implementing IRCv3.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )

        Spacer(Modifier.height(12.dp))
        Fact("Version", BuildConfig.VERSION_NAME)
        if (built.isNotEmpty()) Fact("Built", built)
        Fact("Platform", "Android")

        Spacer(Modifier.height(12.dp))
        Text(
            "Source and releases",
            color = Blue,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable {
                Links.safeExternal(REPOSITORY)?.let { runCatching { opener.openUri(it) } }
            }
        )

        if (licence.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text(
                "Licence",
                color = Subtext,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(6.dp))
            // The page already scrolls; a second scrolling box inside it is a
            // gesture fight. The whole thing is shown and the page carries it.
            Text(
                licence,
                color = Overlay,
                fontSize = 11.sp,
                lineHeight = 16.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Crust, RoundedCornerShape(8.dp))
                    .padding(10.dp)
            )
        }
    }
}

/** One name and one value, the way the rest of this screen lays them out */
@Composable
private fun Fact(name: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(name, color = Subtext, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Text(value, color = Text0, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun SessionCard(engine: SwitchboardEngine) {
    SectionLabel("This device")
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

    SectionLabel("Background", modifier = Modifier.padding(top = 20.dp))

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

/**
 * Being told about messages while the app is asleep.
 *
 * Android will not let an IRC client hold a socket open indefinitely, and the
 * usual answer is a push service that reads your messages on the way past.
 * This is the other answer: the server encrypts to keys only this device holds
 * and hands the ciphertext to a distributor that cannot read it.
 *
 * The distributor is a separate app the user chooses. That is the part worth
 * explaining here, because "install another app first" is a strange thing to
 * be told by a settings screen and makes no sense without the reason.
 */
@Composable
private fun PushCard(engine: SwitchboardEngine) {
    val context = LocalContext.current
    var wanted by remember { mutableStateOf(Push.wanted(context)) }
    val distributors = remember(wanted) { runCatching { Push.distributors(context) }.getOrDefault(emptyList()) }
    val chosen = remember(wanted, distributors) { runCatching { Push.distributor(context) }.getOrNull() }

    SectionLabel("Push", modifier = Modifier.padding(top = 20.dp))

    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Wake me for messages",
                color = Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f)
            )
            Switch(
                checked = wanted,
                onCheckedChange = { on ->
                    Push.setWanted(context, on)
                    wanted = on
                    if (!on) engine.withdrawAllPushEndpoints()
                    else engine.offerPushEverywhere()
                },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Crust,
                    checkedTrackColor = Green,
                    uncheckedThumbColor = Overlay,
                    uncheckedTrackColor = Surface0
                )
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "Your network sends a notification through a push service when somebody " +
                "messages you and this app is not connected. The message is encrypted to " +
                "this device — the service forwards it without being able to read it.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )

        if (wanted) {
            Spacer(Modifier.height(12.dp))
            if (distributors.isEmpty()) {
                Text(
                    "No push distributor installed. UnifiedPush needs one — ntfy is the " +
                        "usual choice, and one distributor serves every app that uses it. " +
                        "Without one there is nothing to deliver the wake-up.",
                    color = Yellow,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            } else {
                Text(
                    "Delivered by",
                    color = Overlay,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                for (candidate in distributors) {
                    val inUse = candidate == chosen
                    Text(
                        if (inUse) "$candidate — in use" else candidate,
                        color = if (inUse) Green else Blue,
                        fontSize = 14.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                Push.useDistributor(context, candidate)
                                engine.offerPushEverywhere()
                            }
                            .padding(vertical = 8.dp)
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "Only networks that offer it and that you have an account on can push: " +
                    "an endpoint outlives the connection that made it, so it belongs to a " +
                    "login rather than to whoever currently holds a nick.",
                color = Overlay,
                fontSize = 12.sp,
                lineHeight = 17.sp
            )
        }
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

    SectionLabel("Shared config", modifier = Modifier.padding(top = 20.dp))

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
                    // A password keyboard, not dots over an ordinary one.
                    // Hiding the characters does nothing about the keyboard's
                    // own helpfulness: autocorrect rewrote what was typed and
                    // the first letter came back capitalised, so a passphrase
                    // that was entered right was wrong by the time it arrived —
                    // and everything after it is dots, so there is no way to see
                    // that happen.
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        autoCorrect = false,
                        imeAction = ImeAction.Go
                    ),
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
                    // See above: dots are not a password keyboard
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        autoCorrect = false,
                        imeAction = ImeAction.Go
                    ),
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
                            modifier = Modifier.size(Sizes.spinner)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Words that ring the same bell your nick does.
 *
 * Being told only when somebody types your nick means missing the thread about
 * the thing you are actually in that channel for. Whole words, so `rust` does
 * not fire on `trusted`, and shared with the desktop — a word that rings here
 * and not there would be two clients.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun HighlightsCard(engine: SwitchboardEngine) {
    val words = engine.store.highlightWords
    var typed by remember { mutableStateOf("") }

    fun add() {
        val word = typed.trim()
        if (word.isEmpty()) return
        // Case-insensitively, because that is how they are matched — two
        // entries differing only in case would be one word listed twice.
        if (words.none { it.equals(word, ignoreCase = true) }) {
            engine.setHighlightWords(words + word)
        }
        typed = ""
    }

    Spacer(Modifier.height(8.dp))
    SectionLabel("Words to watch for")
    Card {
        Text(
            "These light up a message and notify you the way your nick does. " +
                "Whole words only, so \"rust\" does not fire on \"trusted\".",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )

        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            SettingField(
                value = typed,
                onChange = { typed = it },
                hint = "A word, or a phrase",
                modifier = Modifier.weight(1f).padding(end = 8.dp)
            )
            Button(
                onClick = { add() },
                enabled = typed.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Blue),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.align(Alignment.CenterVertically)
            ) {
                Text("Add", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }

        if (words.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (word in words) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .padding(bottom = 6.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Surface0)
                            .clickable { engine.setHighlightWords(words - word) }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        Text(word, color = Text0, fontSize = 13.sp)
                        Spacer(Modifier.width(6.dp))
                        Text("×", color = Overlay, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

/**
 * Saying you are not there, without having to remember to.
 *
 * The desktop asks the system how long since any input anywhere. A phone gives
 * an app no such clock, so this counts from the screen going dark — see
 * [org.switchboard.android.IdleWatch] for why that is the honest answer and why
 * the app being in the background deliberately is not.
 *
 * How long is long enough is shared with the desktop, because that is a fact
 * about you rather than about the thing measuring it.
 */
@Composable
private fun AwayCard(engine: SwitchboardEngine) {
    // Keyed on the engine so a change made at the desk shows up here rather
    // than sitting stale behind whatever was typed last.
    var minutes by remember(engine.awayAfterMinutes) {
        mutableStateOf(engine.awayAfterMinutes.takeIf { it > 0 }?.toString().orEmpty())
    }
    var message by remember(engine.awayMessage) { mutableStateOf(engine.awayMessage) }
    var note by remember { mutableStateOf<String?>(null) }

    val wanted = minutes.toIntOrNull() ?: 0

    Spacer(Modifier.height(8.dp))
    SectionLabel("Away when idle")
    Card {
        Text(
            "Mark yourself away after the screen has been off this long, and come " +
                "back when it lights up. Leave it empty to never do it.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )

        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            SettingField(
                value = minutes,
                onChange = { minutes = it.filter { c -> c.isDigit() }.take(4); note = null },
                hint = "Off",
                numeric = true,
                modifier = Modifier.weight(1f).padding(end = 8.dp)
            )
            Text(
                "minutes",
                color = Subtext,
                fontSize = 13.sp,
                modifier = Modifier.align(Alignment.CenterVertically).weight(2f)
            )
        }

        if (wanted > 0) {
            Spacer(Modifier.height(8.dp))
            SettingField(
                value = message,
                onChange = { message = it; note = null },
                hint = AutoAway.DEFAULT_MESSAGE,
                modifier = Modifier.fillMaxWidth()
            )
        }

        Spacer(Modifier.height(12.dp))
        Text(
            note ?: "Only the networks this phone is holding. While the desktop has " +
                "them it is its own idle clock that decides, which is the one next to " +
                "the person.",
            color = if (note != null) Green else Subtext,
            fontSize = 12.sp,
            lineHeight = 17.sp
        )

        Spacer(Modifier.height(12.dp))
        Button(
            onClick = {
                engine.setAutoAway(wanted, message.trim())
                note = if (wanted > 0) {
                    "Saved. Away after $wanted ${if (wanted == 1) "minute" else "minutes"}."
                } else {
                    "Saved. Nothing will mark you away but you."
                }
            },
            colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Blue),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Save", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
    }
}

/**
 * The noisy three.
 *
 * Off by default: the member list already says who is here, and in a busy
 * channel a line for every arrival and departure buries the talk. Renames,
 * kicks and topic changes are always shown — they are rarer, and they matter.
 * Shared with the desktop, so both devices read a channel the same way.
 */
@Composable
private fun JoinsCard(engine: SwitchboardEngine) {
    Spacer(Modifier.height(8.dp))
    SectionLabel("Joins, parts and quits")
    Card {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Text("Show them in the conversation", color = Text0, fontSize = 15.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "A line when somebody arrives or leaves. Off by default — the " +
                        "member list already says who is here. Shared with your desktop.",
                    color = Subtext,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )
            }
            Switch(
                checked = engine.showJoinsParts,
                onCheckedChange = { engine.setShowJoinsAndParts(it) },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Crust,
                    checkedTrackColor = Blue
                )
            )
        }
    }
}

/**
 * Going back to a channel you were kicked out of.
 *
 * The desktop has had this since 2.2.0 and this phone had not, so what
 * happened after a kick depended on which device was holding the connection —
 * the seam these two clients exist to hide.
 *
 * Off unless asked for, and it should be: rejoining the instant an operator
 * removes you is rude, and on some networks it is what turns a kick into a
 * ban.
 */
@Composable
private fun RejoinCard(engine: SwitchboardEngine) {
    Spacer(Modifier.height(8.dp))
    SectionLabel("After a kick")
    Card {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Text("Rejoin the channel", color = Text0, fontSize = 15.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Five seconds later, once. Off by default — going straight back " +
                        "in is rude, and on some networks it is what turns a kick into " +
                        "a ban. Shared with your desktop.",
                    color = Subtext,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )
            }
            Switch(
                checked = engine.rejoinOnKick,
                onCheckedChange = { engine.setRejoinAfterKick(it) },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Crust,
                    checkedTrackColor = Blue
                )
            )
        }
    }
}

/**
 * People you have decided not to hear from.
 *
 * The list has to be visible somewhere, or the only way to undo an ignore is
 * to find the person again and open their profile — which is exactly what you
 * cannot do once they are silent.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun IgnoredCard(engine: SwitchboardEngine) {
    val list = engine.ignores
    var typed by remember { mutableStateOf("") }

    fun nameOf(network: String): String = when (network) {
        Ignore.EVERYWHERE -> "Everywhere"
        else -> engine.store.servers[network]?.name ?: "a network you left"
    }

    Spacer(Modifier.height(8.dp))
    SectionLabel("Ignored")
    Card {
        Text(
            "Nothing from anybody matching one of these reaches this phone — not a " +
                "message, not a notification, not a badge. Shared with your desktop.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )

        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            SettingField(
                value = typed,
                onChange = { typed = it },
                hint = "A nick, or a mask",
                modifier = Modifier.weight(1f).padding(end = 8.dp)
            )
            Button(
                onClick = {
                    // Everywhere, from here. Ignoring somebody on one network
                    // is what the profile sheet does, where a network is in
                    // front of you; this list has no such context.
                    engine.addIgnore(typed, Ignore.EVERYWHERE)
                    typed = ""
                },
                enabled = typed.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Blue),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.align(Alignment.CenterVertically)
            ) {
                Text("Add", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }

        // What a bare nick will become, before it is added
        if (typed.isNotBlank() && Ignore.toMask(typed) != typed.trim()) {
            Spacer(Modifier.height(4.dp))
            Text("Will be saved as ${Ignore.toMask(typed)}", color = Overlay, fontSize = 11.sp)
        }

        Spacer(Modifier.height(12.dp))
        if (list.isEmpty()) {
            Text("Nobody. Open someone's profile to add them.", color = Overlay, fontSize = 13.sp)
        } else {
            for (entry in list.sortedByDescending { it.added }) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp)
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
                        Text(nameOf(entry.network), color = Overlay, fontSize = 11.sp)
                    }
                    Text(
                        "Remove",
                        color = Subtext,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { engine.removeIgnore(entry.mask, entry.network) }
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }
}

/**
 * Commands you make up yourself.
 *
 * The phone has applied these since they existed and had no way to edit one,
 * so an alias could only be made at a desk. Shared with the desktop: an alias
 * that works there and not here is two clients, and the whole point of one is
 * that it is shorter than what it stands for.
 */
@Composable
private fun AliasesCard(engine: SwitchboardEngine) {
    val aliases = engine.savedAliases()
    var name by remember { mutableStateOf("") }
    var expansion by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }

    fun add() {
        val wanted = name.trim().removePrefix("/")
        when {
            !Aliases.validName(wanted) ->
                problem = "A name can only be letters, digits, dashes and underscores."
            expansion.isBlank() -> problem = "An alias needs something to expand into."
            else -> {
                engine.setAliases(
                    aliases.filterNot { it.name.equals(wanted, true) } +
                        Aliases.Alias(wanted, expansion.trim())
                )
                name = ""
                expansion = ""
                problem = null
            }
        }
    }

    Spacer(Modifier.height(8.dp))
    SectionLabel("Aliases")
    Card {
        Text(
            "A command of your own. \$1 is the first word after it, \$* is all of them, " +
                "\$2- is the second onwards. One alias may use another, but not itself.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 18.sp
        )

        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            SettingField(
                value = name,
                onChange = { name = it; problem = null },
                hint = "j",
                modifier = Modifier.weight(1f).padding(end = 8.dp)
            )
            SettingField(
                value = expansion,
                onChange = { expansion = it; problem = null },
                hint = "/join \$1",
                modifier = Modifier.weight(2f)
            )
        }

        problem?.let {
            Spacer(Modifier.height(6.dp))
            Text(it, color = Red, fontSize = 12.sp, lineHeight = 16.sp)
        }

        Spacer(Modifier.height(10.dp))
        Button(
            onClick = { add() },
            enabled = name.isNotBlank() && expansion.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Blue),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Add", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }

        Spacer(Modifier.height(12.dp))
        if (aliases.isEmpty()) {
            Text("None yet.", color = Overlay, fontSize = 13.sp)
        } else {
            for (alias in aliases.sortedBy { it.name }) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Surface0)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("/${alias.name}", color = Blue, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        alias.expansion.replace("\n", " ; "),
                        color = Subtext,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        "Remove",
                        color = Overlay,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { engine.setAliases(aliases.filterNot { it.name == alias.name }) }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }
}

/**
 * Dialling through a proxy.
 *
 * Kept on the device rather than in the shared config, unlike almost
 * everything else here: a proxy describes where you are, not who you are, and
 * the one a desktop uses at home is rarely the one a phone on mobile data
 * should. The desktop keeps its own for the same reason.
 *
 * Host names are resolved by the proxy, never here — which is the whole point
 * over Tor, and on an ordinary network is the difference between hiding where
 * you connect and announcing it in a DNS lookup first.
 */
@Composable
private fun ProxyCard(engine: SwitchboardEngine) {
    val saved = remember { engine.savedProxy() }
    var type by remember { mutableStateOf(saved?.type ?: "none") }
    var host by remember { mutableStateOf(saved?.host.orEmpty()) }
    var port by remember { mutableStateOf(saved?.port?.takeIf { it > 0 }?.toString().orEmpty()) }
    var user by remember { mutableStateOf(saved?.username.orEmpty()) }
    var pass by remember { mutableStateOf(saved?.password.orEmpty()) }
    var note by remember { mutableStateOf<String?>(null) }

    Spacer(Modifier.height(8.dp))
    SectionLabel("Proxy")
    Card {
        Row(modifier = Modifier.fillMaxWidth()) {
            for (option in listOf("none" to "Off", "socks5" to "SOCKS5", "socks4" to "SOCKS4a")) {
                val picked = type == option.first
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = 6.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (picked) Surface1 else Surface0)
                        .clickable { type = option.first; note = null }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        option.second,
                        color = if (picked) Text0 else Overlay,
                        fontSize = 13.sp,
                        fontWeight = if (picked) FontWeight.Bold else FontWeight.Normal
                    )
                }
            }
        }

        if (type != "none") {
            Spacer(Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SettingField(
                    value = host,
                    onChange = { host = it; note = null },
                    hint = "Proxy host",
                    modifier = Modifier.weight(2f).padding(end = 8.dp)
                )
                SettingField(
                    value = port,
                    onChange = { port = it.filter { c -> c.isDigit() }; note = null },
                    hint = "Port",
                    numeric = true,
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                SettingField(
                    value = user,
                    onChange = { user = it; note = null },
                    hint = "Username (optional)",
                    modifier = Modifier.weight(1f).padding(end = if (type == "socks5") 8.dp else 0.dp)
                )
                // SOCKS5 can carry a password (RFC 1929); SOCKS4a only a name
                if (type == "socks5") {
                    SettingField(
                        value = pass,
                        onChange = { pass = it; note = null },
                        hint = "Password",
                        secret = true,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Text(
            note
                ?: if (type == "none") "Connections go straight out from this phone."
                else "Host names are resolved by the proxy, not here. Applies to every network on its next connection.",
            color = if (note != null) Green else Subtext,
            fontSize = 12.sp,
            lineHeight = 17.sp
        )

        Spacer(Modifier.height(12.dp))
        Button(
            onClick = {
                engine.saveProxy(
                    Socks.Settings(
                        type = type,
                        host = host.trim(),
                        port = port.toIntOrNull() ?: 0,
                        username = user.trim(),
                        password = pass
                    )
                )
                note = if (type == "none") "Saved. Reconnect to stop using the proxy."
                else "Saved. Networks you are already on stay where they are — reconnect to move them onto the proxy."
            },
            colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Blue),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Save", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
    }
}

@Composable
private fun SettingField(
    value: String,
    onChange: (String) -> Unit,
    hint: String,
    modifier: Modifier = Modifier,
    numeric: Boolean = false,
    secret: Boolean = false
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        placeholder = { Text(hint, color = Overlay, fontSize = 13.sp) },
        textStyle = androidx.compose.ui.text.TextStyle(color = Text0, fontSize = 14.sp),
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        // `secret` decides the keyboard as well as the dots. It used to decide
        // only the dots, which left autocorrect rewriting passwords behind them
        keyboardOptions = KeyboardOptions(
            keyboardType = when {
                secret -> KeyboardType.Password
                numeric -> KeyboardType.Number
                else -> KeyboardType.Text
            },
            autoCorrect = !secret
        ),
        shape = RoundedCornerShape(8.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Blue,
            unfocusedBorderColor = Surface1,
            cursorColor = Blue
        ),
        modifier = modifier
    )
}

@Composable
private fun Card(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Sizes.gutter)
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
    SectionLabel("Appearance")
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
