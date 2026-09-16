package org.switchboard.android.push

import android.content.Context
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.MessagingReceiver
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage
import org.switchboard.android.SwitchboardApp

/**
 * What the distributor delivers.
 *
 * A broadcast receiver, so this runs whether or not the app is up — which is
 * the whole point: the message arrives when Android has stopped letting the
 * client hold a socket.
 *
 * The connector has already done the hard half. It owns the subscription keys,
 * handles the registration handshake with the distributor, and decrypts the
 * body (RFC 8291, via Tink) before handing it over. What arrives here is one
 * formatted IRC line, exactly as it would have come down a socket.
 *
 * Keep the work here short. A receiver has a few seconds and no window; the
 * two things worth doing are writing down an endpoint and drawing a
 * notification, and both are quick.
 */
class PushReceiver : MessagingReceiver() {

    /**
     * An endpoint for one network — the instance is its server id.
     *
     * Written down first and told to the server second, because the server may
     * not be connected. A network connected to later reads it from here on the
     * way up rather than waiting for the distributor to repeat itself.
     */
    override fun onNewEndpoint(context: Context, endpoint: PushEndpoint, instance: String) {
        val keys = endpoint.pubKeySet ?: return
        Push.remember(
            context,
            instance,
            endpoint.url,
            "p256dh=${keys.pubKey};auth=${keys.auth}"
        )
        app(context)?.pushEndpointChanged(instance)
    }

    override fun onUnregistered(context: Context, instance: String) {
        Push.forget(context, instance)
        app(context)?.pushEndpointChanged(instance)
    }

    /**
     * Nothing to do here but say so.
     *
     * `ACTION_REQUIRED` means the distributor wants the user to open it and
     * agree to something, and `VAPID_REQUIRED` that it will not take a
     * registration without the server's key — neither is fixed by trying
     * again, so neither is retried.
     */
    override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
        android.util.Log.w("Switchboard", "Push registration failed for $instance: $reason")
        Push.forget(context, instance)
    }

    /** One message, already decrypted, as a line off the wire */
    override fun onMessage(context: Context, message: PushMessage, instance: String) {
        if (!message.decrypted) return
        app(context)?.pushArrived(instance, message.content.toString(Charsets.UTF_8))
    }

    /**
     * The engine, which lives on the application rather than on a screen.
     *
     * A receiver runs in the app's own process, so this is the same engine the
     * user's session has — and where the process was cold it is made here,
     * which is the right answer: a push has just said there is something worth
     * connecting for.
     */
    private fun app(context: Context): SwitchboardApp? =
        context.applicationContext as? SwitchboardApp
}
