package org.switchboard.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager

/**
 * How long the phone has been left alone.
 *
 * The desktop asks the operating system how long since any input anywhere.
 * Android gives an ordinary app no such clock, and the nearest honest answer is
 * the screen: while it is dark nobody is touching this phone, and the moment it
 * lights up somebody is.
 *
 * Deliberately not the app being in the background. People leave one app for
 * another constantly while entirely present, and calling that away would mark
 * somebody away for reading a message they were sent — the opposite of what the
 * feature is for.
 *
 * `ACTION_SCREEN_ON` and `ACTION_SCREEN_OFF` cannot be declared in the
 * manifest; Android only delivers them to a receiver registered while running,
 * which is what [start] does.
 */
class IdleWatch(
    private val context: Context,
    /** Called the moment the screen changes, so coming back is not a poll away */
    private val onChange: () -> Unit = {},
    private val now: () -> Long = { System.currentTimeMillis() }
) {
    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager

    /**
     * When the screen went dark, or null while it is lit.
     *
     * Seeded from the current state rather than assumed lit: this starts with
     * the foreground service, which on a phone that rebooted in a drawer is a
     * phone whose screen has been off the whole time.
     */
    @Volatile
    private var darkSince: Long? = if (power.isInteractive) null else now()

    /** Seconds since anybody last touched this phone */
    val idleSeconds: Long
        get() = darkSince?.let { (now() - it) / 1000 } ?: 0

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> if (darkSince == null) darkSince = now()
                Intent.ACTION_SCREEN_ON -> darkSince = null
                else -> return
            }
            // Picking the phone up should take the away back now. Waiting for
            // the next poll means answering somebody while the channel still
            // says you are not there.
            onChange()
        }
    }

    fun start() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        // Both are system broadcasts, so this is not exported either way; the
        // flag is what Android 14 requires rather than a choice.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
    }

    fun stop() {
        runCatching { context.unregisterReceiver(receiver) }
    }
}
