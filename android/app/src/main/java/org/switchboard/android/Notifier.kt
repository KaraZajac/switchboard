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

    fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        manager.createNotificationChannel(
            NotificationChannel(
                MENTIONS,
                "Mentions and direct messages",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "When someone says your name or messages you directly"
            }
        )

        manager.createNotificationChannel(
            NotificationChannel(
                MESSAGES,
                "Channel messages",
                // Quiet by default: a busy channel should not buzz all evening
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Everything else said in channels you are in"
            }
        )
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
        val style = NotificationCompat.MessagingStyle(me)
            .setConversationTitle(conversation)
            .setGroupConversation(conversation.startsWith("#"))

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

        val open = PendingIntent.getActivity(
            context,
            conversationKey.hashCode(),
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_CONVERSATION, conversationKey)
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
        const val MENTIONS = "switchboard-mentions"
        const val MESSAGES = "switchboard-messages"
        const val GROUP = "switchboard-conversations"
        const val EXTRA_CONVERSATION = "conversation"
    }
}
