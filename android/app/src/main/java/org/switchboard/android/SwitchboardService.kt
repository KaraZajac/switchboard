package org.switchboard.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Keeps the phone able to be the connection.
 *
 * Android demotes a backgrounded process to `cached` within a minute or two,
 * freezes it, and tears down its sockets — which is exactly what a standby
 * device must not let happen. A foreground service is the only way to say "this
 * process is doing something the user asked for", and the notification is the
 * price of saying it.
 *
 * The notification earns its place: it is the only way to see, without opening
 * anything, whether this phone is watching the desktop or standing in for it.
 */
class SwitchboardService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var watcher: Job? = null
    private var doze: DozeWatch? = null

    private val engine: SwitchboardEngine
        get() = (application as SwitchboardApp).engine

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification())
        engine.start()

        // Doze stops the heartbeat dead. This is what turns "never notices the
        // desktop died" into "notices within a quarter of an hour", and reacts
        // the instant the phone surfaces for any other reason.
        if (doze == null) {
            doze = DozeWatch(this) { engine.wake() }.also { it.start() }
        }

        // Keep the notification honest about what the phone is doing. Compose
        // state is not observable from here, so this polls — cheaply, and only
        // redrawing when the words would actually change.
        watcher?.cancel()
        watcher = scope.launch {
            var shown: String? = null
            while (true) {
                doze?.let { engine.noteDozeState(it.isDozing, it.isExempt) }
                val text = statusText()
                if (text != shown) {
                    shown = text
                    notificationManager().notify(NOTIFICATION_ID, buildNotification())
                }
                delay(2_000)
            }
        }

        // Restarted if the system kills us: a standby connection that gives up
        // after one memory-pressure event is not standby.
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        watcher?.cancel()
        doze?.stop()
        doze = null
        scope.cancel()
    }

    private fun statusText(): String = when (engine.mode) {
        EngineMode.HOLDING -> "Holding the IRC connections"
        EngineMode.FOLLOWING -> "Following the desktop"
        EngineMode.OFFLINE ->
            if (engine.needsPassphrase) "Locked — unlock to take over" else "Looking for the desktop"
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Switchboard")
            .setContentText(statusText())
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(open)
            .setOngoing(true)
            // Quiet: this is a status line, not news
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setShowWhen(false)
            .build()
    }

    private fun notificationManager() =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    companion object {
        private const val CHANNEL_ID = "switchboard-connection"
        private const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "org.switchboard.android.STOP"

        fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Connection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows whether this phone or your desktop is connected to IRC"
                setShowBadge(false)
            }
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }

        fun start(context: Context) {
            val intent = Intent(context, SwitchboardService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, SwitchboardService::class.java).setAction(ACTION_STOP)
            )
        }
    }
}
