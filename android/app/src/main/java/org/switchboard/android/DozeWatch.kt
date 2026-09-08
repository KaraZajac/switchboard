package org.switchboard.android

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * Staying useful while the phone is asleep.
 *
 * Doze is the last thing standing between this and a failover you can rely on.
 * With the screen off and the phone still, Android suspends network access,
 * ignores wake locks and defers timers — so the five-second heartbeat simply
 * stops, and a desktop that dies at midnight goes unnoticed until morning.
 *
 * Three things help, in order of how much:
 *
 * 1. **Being exempt from battery optimisation.** The user grants it once and
 *    Doze stops applying. Nothing else comes close, which is why the app asks
 *    plainly rather than burying it.
 * 2. **An alarm that fires anyway.** `setExactAndAllowWhileIdle` is allowed
 *    through Doze, roughly every nine minutes at best. That turns "never
 *    notices" into "notices within a quarter of an hour", which is the
 *    difference between a standby device and an ornament.
 * 3. **Reacting the moment Doze lifts.** The phone wakes for a maintenance
 *    window or because someone picked it up; that is the cheapest chance to
 *    re-check the link, and taking it costs nothing.
 */
class DozeWatch(
    private val context: Context,
    private val onWake: () -> Unit
) {
    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    private val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    /** True while the system is holding this app back */
    val isDozing: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && power.isDeviceIdleMode

    /** True when the user has exempted us, so Doze does not apply */
    val isExempt: Boolean
        get() = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            power.isIgnoringBatteryOptimizations(context.packageName)

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_TICK -> {
                    Log.i(TAG, "backstop tick (dozing=$isDozing)")
                    onWake()
                    schedule()
                }

                PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED -> {
                    // Leaving Doze is the cheapest chance to notice the desktop
                    // went away while we were asleep
                    if (!isDozing) {
                        Log.i(TAG, "doze lifted")
                        onWake()
                    }
                }
            }
        }
    }

    fun start() {
        val filter = IntentFilter(ACTION_TICK).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
        schedule()
    }

    fun stop() {
        runCatching { context.unregisterReceiver(receiver) }
        alarms.cancel(pendingTick())
    }

    /**
     * Ask to be woken, even in Doze.
     *
     * The interval is a floor, not a promise: the system coalesces these and
     * will not honour one more than about every nine minutes. Asking for less
     * would be pretending.
     */
    private fun schedule() {
        val at = System.currentTimeMillis() + BACKSTOP_INTERVAL_MS
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingTick())
            } else {
                alarms.setExact(AlarmManager.RTC_WAKEUP, at, pendingTick())
            }
        }.onFailure {
            // Android 12+ can refuse exact alarms. An inexact one still fires,
            // just later — worse, but not nothing.
            runCatching { alarms.set(AlarmManager.RTC_WAKEUP, at, pendingTick()) }
        }
    }

    private fun pendingTick(): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(ACTION_TICK).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    companion object {
        private const val TAG = "SwitchboardDoze"
        private const val ACTION_TICK = "org.switchboard.android.HEARTBEAT_TICK"

        /**
         * How often to ask to be woken while asleep.
         *
         * Nine minutes is the shortest Doze will honour, so anything smaller is
         * a request the system quietly ignores.
         */
        const val BACKSTOP_INTERVAL_MS = 9 * 60 * 1000L

        /** The screen the user grants the exemption on */
        fun batteryExemptionIntent(context: Context): Intent =
            Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(android.net.Uri.parse("package:${context.packageName}"))
    }
}
