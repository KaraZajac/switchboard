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
import androidx.core.app.ServiceCompat
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
    private var idle: IdleWatch? = null

    private val engine: SwitchboardEngine
        get() = (application as SwitchboardApp).engine

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            switchOff()
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

        // Away when nobody is there. The screen is the only idle clock an
        // ordinary Android app gets, and it has to be watched from something
        // that outlives the activity — an app in the background is not an app
        // whose person has gone.
        if (idle == null) {
            idle = IdleWatch(this, onChange = { engine.applyAutoAway() }).also { watch ->
                watch.start()
                engine.idleSeconds = { watch.idleSeconds }
            }
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

    /**
     * Off, because somebody said so.
     *
     * Swiping the app out of the recents list does not stop this and must not:
     * being a standby connection is the whole job, and a phone that stopped
     * watching every time its person tidied their recents would be no use as
     * one. So there has to be somewhere to say stop, and the notification is
     * where somebody looking at it is — the same place Waze puts it.
     *
     * This has to be a real stop, not just the service going away. The engine
     * lives on the application and outlives this: without telling it, the
     * sockets stayed open, the coordinator went on beating, and the desktop
     * went on believing this phone was standing by. [SwitchboardEngine.stop]
     * has always done the right thing — leave the session so the desktop takes
     * over at once rather than waiting out the heartbeat, hand back what this
     * phone was holding, and flush what it heard while it was holding it — and
     * until now nothing anywhere called it.
     *
     * The notification goes with it. A foreground service that has stopped
     * leaving its status line behind is how you get a phone that says it is
     * holding the IRC connections when it is not.
     */
    private fun switchOff() {
        engine.stop()
        // And the screen, if there is one — see [SwitchboardEngine.onSwitchOff]
        engine.onSwitchOff?.invoke()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        watcher?.cancel()
        doze?.stop()
        doze = null
        idle?.stop()
        idle = null
        engine.idleSeconds = { 0L }
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

        // A different request code from `open`, or the two PendingIntents are
        // the same one to Android — it matches on everything but the extras —
        // and tapping "Switch off" opens the app instead.
        val off = PendingIntent.getService(
            this,
            1,
            Intent(this, SwitchboardService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            // No icon: an action with one is drawn with it on old versions and
            // without it on new ones, and this reads as a word either way.
            .addAction(NotificationCompat.Action.Builder(0, "Switch off", off).build())
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
