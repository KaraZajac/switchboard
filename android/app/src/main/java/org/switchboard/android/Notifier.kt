package org.switchboard.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface

/**
 * Telling you something happened.
 *
 * The most conspicuous thing a phone chat client can be missing. Two channels,
 * because the two cases want different treatment: being spoken to directly
 * should ring, and a busy channel you are merely in should not.
 *
 * Messaging-style notifications rather than plain text ones: they group by
 * conversation, show who said what, and give the system what it needs to offer
 * a reply action later.
 */
class Notifier(private val context: Context) {

    private val manager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    /** What we have shown per conversation, so a thread reads as a thread */
    private val threads = mutableMapOf<String, MutableList<Pair<String, String>>>()

    /**
     * The two channels, and why they are named the way they are.
     *
     * `IMPORTANCE_HIGH` buys a heads-up and a sound. It does **not** buy a
     * vibration: a channel's `shouldVibrate` starts false and there is no
     * importance that turns it on, so a phone that had never been told to
     * buzz simply never buzzed. Nothing said so — the notification arrived,
     * it made a noise, and the one signal you can feel in a pocket was the
     * one missing.
     *
     * The ids carry a version because **a channel cannot be changed after it
     * is created**. Importance, sound and vibration are the user's from that
     * moment on, and `createNotificationChannel` on an existing id is a no-op
     * for all three. So fixing this in code fixes nothing on a phone that has
     * already run the app: the only way to ship a corrected channel is to
     * ship a new one, and to take the old one away so it does not sit in the
     * system settings looking like a second copy.
     */
    fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        manager.createNotificationChannel(
            NotificationChannel(
                MENTIONS,
                "Mentions and direct messages",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "When someone says your name or messages you directly"
                enableVibration(true)
                // Two short pulses rather than one long one: long enough to
                // feel through a coat, short enough not to read as a call.
                vibrationPattern = longArrayOf(0, 180, 120, 180)
                enableLights(true)
            }
        )

        manager.createNotificationChannel(
            NotificationChannel(
                MESSAGES,
                "Channel messages",
                // Quiet by default: a busy channel should not buzz all evening.
                // The user can raise it in the system settings if they want to,
                // which is the right place for that decision.
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Everything else said in channels you are in"
                enableVibration(false)
            }
        )

        // The versions these replaced. Left behind they would show up in the
        // system's notification settings as duplicates, with the old
        // behaviour, and whichever the user changed would be the wrong one.
        for (old in RETIRED) runCatching { manager.deleteNotificationChannel(old) }
    }

    /**
     * Show a message.
     *
     * [mentioned] decides which channel it lands on, and therefore whether the
     * phone makes a sound. Nothing is shown for the conversation on screen —
     * notifying someone about a message they are looking at is noise.
     */
    fun show(
        conversationKey: String,
        conversation: String,
        nick: String,
        displayName: String,
        text: String,
        colour: Int,
        mentioned: Boolean
    ) {
        val history = threads.getOrPut(conversationKey) { mutableListOf() }
        history.add(displayName to text)
        // A notification is a reminder, not a transcript
        while (history.size > 8) history.removeAt(0)

        val me = Person.Builder().setName("You").build()
        val group = conversation.startsWith("#") || conversation.startsWith("&")
        val style = NotificationCompat.MessagingStyle(me).setGroupConversation(group)
        // A channel is named; a direct message is named after the person
        // already, and a title on top read "robin: robin".
        if (group) style.setConversationTitle(conversation)

        for ((who, said) in history) {
            style.addMessage(
                said,
                System.currentTimeMillis(),
                Person.Builder()
                    .setName(who)
                    .setIcon(IconCompat.createWithBitmap(avatar(who, colour)))
                    .build()
            )
        }

        // Where a tap should land: the network and the conversation, by their
        // own names rather than the folded key, so a nick keeps its case.
        // MainActivity reads these on the way in.
        val open = PendingIntent.getActivity(
            context,
            conversationKey.hashCode(),
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_SERVER, conversationKey.substringBefore(':'))
                .putExtra(EXTRA_CHANNEL, conversation)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = NotificationCompat
            .Builder(context, if (mentioned) MENTIONS else MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setStyle(style)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(
                if (mentioned) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW
            )
            .setGroup(GROUP)
            .build()

        runCatching { manager.notify(conversationKey.hashCode(), notification) }
    }

    /** Reading a conversation clears what was waiting in it */
    fun clear(conversationKey: String) {
        threads.remove(conversationKey)
        runCatching { manager.cancel(conversationKey.hashCode()) }
    }

    /**
     * A round initial, matching the one in the app.
     *
     * The system wants a bitmap, and a person with a recognisable colour in the
     * shade they have in the channel is worth more than a generic glyph.
     */
    private fun avatar(name: String, colour: Int): Bitmap {
        val size = 128
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        canvas.drawCircle(
            size / 2f,
            size / 2f,
            size / 2f,
            Paint().apply { isAntiAlias = true; color = colour }
        )

        val letter = name.firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "?"
        val text = Paint().apply {
            isAntiAlias = true
            color = 0xFF11111B.toInt()
            textSize = size * 0.5f
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val baseline = size / 2f - (text.descent() + text.ascent()) / 2f
        canvas.drawText(letter, size / 2f, baseline, text)

        return bitmap
    }

    companion object {
        // Versioned, because a channel's settings are fixed at creation — see
        // [createChannels]. Bump the suffix when one of them has to change.
        const val MENTIONS = "switchboard-mentions-v2"
        const val MESSAGES = "switchboard-messages-v2"

        /** Ids that have been superseded, removed on the way past */
        private val RETIRED = listOf("switchboard-mentions", "switchboard-messages")
        const val GROUP = "switchboard-conversations"
        const val EXTRA_SERVER = "server"
        const val EXTRA_CHANNEL = "channel"
    }
}
