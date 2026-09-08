package org.switchboard.android

import android.app.Application
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
class SwitchboardApp : Application() {

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
}
