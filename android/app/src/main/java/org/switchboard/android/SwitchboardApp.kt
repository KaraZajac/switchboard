package org.switchboard.android

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import okhttp3.OkHttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.switchboard.android.irc.Sts
import org.switchboard.android.irc.StsStore

/**
 * The engine, held for as long as the process lives.
 *
 * It used to belong to the activity, which meant the phone stopped being a
 * standby connection the moment someone pressed Home: Android demotes a
 * backgrounded activity's process to `cached`, freezes it, and the IRC socket
 * goes with it. A failover that only works while you are looking at the app is
 * not a failover.
 *
 * So the engine lives here, on a scope that outlives every screen, and
 * [SwitchboardService] keeps the process out of the cached bucket while it is
 * actually holding something.
 */
class SwitchboardApp : Application(), ImageLoaderFactory {

    /** Not the activity's scope: this has to survive the activity going away */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val store by lazy { SwitchboardStore() }
    val engine by lazy { SwitchboardEngine(applicationContext, scope, store) }

    override fun onCreate() {
        super.onCreate()
        SwitchboardService.createChannel(this)

        // Before anything dials. A Strict Transport Security policy that is not
        // loaded until later protects nothing on the connection that matters
        // most — the first one after a restart.
        Sts.useStore(StsStore(applicationContext))
    }

    /**
     * Every picture this app fetches says who is asking.
     *
     * Coil sends no useful `User-Agent` of its own, and a fair number of hosts
     * refuse a request without one — Wikimedia answers `HTTP 403`. So an
     * avatar or a network icon hosted there simply never appeared, silently,
     * because a failed image load looks exactly like a network that set none.
     *
     * Naming the client is also the honest thing to do: these are requests
     * made on a user's behalf to a third party the *server* chose, and the
     * host on the other end is entitled to know what is calling.
     */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .okHttpClient {
                OkHttpClient.Builder()
                    .addInterceptor { chain ->
                        chain.proceed(
                            chain.request().newBuilder()
                                .header("User-Agent", USER_AGENT)
                                .build()
                        )
                    }
                    .build()
            }
            .build()

    private companion object {
        val USER_AGENT = "Switchboard/${BuildConfig.VERSION_NAME} (Android)"
    }
}
