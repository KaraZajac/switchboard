package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.session.Cancellable
import org.switchboard.android.session.ConnectionControl
import org.switchboard.android.session.CoordinatorTransport
import org.switchboard.android.session.DESKTOP_PRIORITY
import org.switchboard.android.session.DISCOVERY_MS
import org.switchboard.android.session.HEARTBEAT_INTERVAL_MS
import org.switchboard.android.session.HEARTBEAT_TIMEOUT_MS
import org.switchboard.android.session.PHONE_PRIORITY
import org.switchboard.android.session.SessionClock
import org.switchboard.android.session.SessionCoordinator
import org.switchboard.android.session.SessionFrame
import org.switchboard.android.session.SessionRole

/**
 * The same scenarios as `tests/main/session.test.ts`, against the Kotlin port.
 *
 * Both implementations have to reach the same conclusion about who is holding
 * the connections, in the same order — the ordering matters as much as the
 * outcome, because a phone that connects before the desktop has let go puts the
 * user on the network twice.
 */
class SessionCoordinatorTest {

    /** A hand-driven clock: these cases are all about elapsed time */
    private class FakeClock : SessionClock {
        var time = 1_700_000_000_000L
        private val timers = mutableListOf<Timer>()

        private class Timer(var due: Long, val interval: Long?, val action: () -> Unit) {
            var cancelled = false
        }

        override fun now(): Long = time

        override fun schedule(delayMs: Long, action: () -> Unit): Cancellable {
            val timer = Timer(time + delayMs, null, action)
            timers.add(timer)
            return Cancellable { timer.cancelled = true }
        }

        override fun repeating(intervalMs: Long, action: () -> Unit): Cancellable {
            val timer = Timer(time + intervalMs, intervalMs, action)
            timers.add(timer)
            return Cancellable { timer.cancelled = true }
        }

        fun advance(millis: Long) {
            val target = time + millis
            while (true) {
                val next = timers
                    .filter { !it.cancelled && it.due <= target }
                    .minByOrNull { it.due } ?: break

                time = next.due
                if (next.interval != null) {
                    next.due = time + next.interval
                } else {
                    timers.remove(next)
                }
                next.action()
            }
            time = target
        }
    }

    private class Harness {
        val clock = FakeClock()
        val events = mutableListOf<String>()
        var linked = true
        val running = mutableSetOf<String>()
        val deaf = mutableSetOf<String>()

        lateinit var desktop: Peer
        lateinit var phone: Peer

        inner class Peer(val id: String, priority: Int) {
            var resumed = 0
            var released = 0

            var coordinator: SessionCoordinator = build(priority)

            fun build(priority: Int): SessionCoordinator = SessionCoordinator(
                priority,
                object : CoordinatorTransport {
                    override fun send(frame: SessionFrame, peerId: String?) {
                        val otherId = if (id == "desktop") "phone" else "desktop"
                        if (!linked || otherId !in running || otherId in deaf) return
                        events.add("$id sent ${frame::class.simpleName}")
                        val other = if (id == "desktop") phone else desktop
                        other.coordinator.handleFrame(id, frame)
                    }

                    override fun hasPeers(): Boolean = linked && running.any { it != id }
                },
                object : ConnectionControl {
                    override fun resume() {
                        running.add(id)
                        resumed++
                        events.add("$id took the connections")
                    }

                    override fun release() {
                        released++
                        events.add("$id released the connections")
                    }

                    override fun vaultVersion(): Int = 3
                },
                clock
            )

            fun start() {
                running.add(id)
                coordinator.start()
            }

            fun stop() {
                running.remove(id)
                coordinator.stop()
            }

            /** The desktop relaunching: a new coordinator with the same identity */
            fun restart(priority: Int) {
                stop()
                coordinator = build(priority)
            }
        }

        init {
            desktop = Peer("desktop", DESKTOP_PRIORITY)
            phone = Peer("phone", PHONE_PRIORITY)
        }
    }

    @Test
    fun `a device on its own is the connection`() {
        val h = Harness()
        h.desktop.start()
        assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
    }

    @Test
    fun `the phone becomes a follower when the desktop is up`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()
        h.clock.advance(HEARTBEAT_INTERVAL_MS)

        assertEquals(SessionRole.FOLLOWER, h.phone.coordinator.state().role)
        assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
        assertEquals(0, h.phone.resumed)
    }

    @Test
    fun `the phone takes over when the desktop stops beating`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()
        h.clock.advance(HEARTBEAT_INTERVAL_MS)
        assertEquals(SessionRole.FOLLOWER, h.phone.coordinator.state().role)

        h.linked = false
        h.desktop.stop()
        h.clock.advance(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

        assertEquals(SessionRole.PRIMARY, h.phone.coordinator.state().role)
        assertTrue(h.phone.resumed > 0)
    }

    @Test
    fun `does not take over early - a slow beat is not a dead desktop`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()
        h.clock.advance(HEARTBEAT_INTERVAL_MS)

        h.linked = false
        h.desktop.stop()
        h.clock.advance(HEARTBEAT_TIMEOUT_MS - 1000)

        assertEquals(SessionRole.FOLLOWER, h.phone.coordinator.state().role)
    }

    @Test
    fun `hands back when the desktop returns, releasing before it connects`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()
        h.clock.advance(HEARTBEAT_INTERVAL_MS)

        h.linked = false
        h.desktop.stop()
        h.clock.advance(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)
        assertEquals(SessionRole.PRIMARY, h.phone.coordinator.state().role)

        h.events.clear()
        h.linked = true
        // The desktop comes back as a fresh process: it must look before it leaps
        h.desktop.restart(DESKTOP_PRIORITY)
        h.desktop.start()
        assertEquals(SessionRole.FOLLOWER, h.desktop.coordinator.state().role)

        h.clock.advance(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS * 3)

        assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
        assertEquals(SessionRole.FOLLOWER, h.phone.coordinator.state().role)

        // The order matters: the phone must be off the network before the
        // desktop joins it, or the user is connected twice.
        val released = h.events.indexOf("phone released the connections")
        val took = h.events.indexOf("desktop took the connections")
        assertTrue("the phone should have released", released >= 0)
        assertTrue("the desktop must not connect before that", took > released)
    }

    @Test
    fun `never leaves both devices holding the connections`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()

        fun bothPrimary() =
            h.desktop.coordinator.state().role == SessionRole.PRIMARY &&
                h.phone.coordinator.state().role == SessionRole.PRIMARY

        for (step in 0 until 20) {
            h.clock.advance(HEARTBEAT_INTERVAL_MS)
            if (step == 5) h.linked = false
            if (step == 15) h.linked = true
            if (step < 5 || step > 17) assertFalse("step $step", bothPrimary())
        }
    }

    @Test
    fun `claims the connection back from a phone that is holding it`() {
        val h = Harness()
        h.phone.start() // alone, so it holds the connections
        assertEquals(SessionRole.PRIMARY, h.phone.coordinator.state().role)

        h.desktop.start()
        assertEquals(SessionRole.FOLLOWER, h.desktop.coordinator.state().role) // looks first
        h.clock.advance(HEARTBEAT_INTERVAL_MS)

        assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
        assertEquals(SessionRole.FOLLOWER, h.phone.coordinator.state().role)
        assertEquals(1, h.phone.released)
    }

    @Test
    fun `takes over anyway when a claim goes unanswered`() {
        val h = Harness()
        h.phone.start()
        h.desktop.start()

        // The phone is still beating but has stopped listening: our claim to
        // take the connection back never reaches it.
        h.deaf.add("phone")
        h.desktop.coordinator.handleFrame(
            "phone",
            SessionFrame.Heartbeat(SessionRole.PRIMARY, PHONE_PRIORITY, "2026-09-08T00:00:00Z", 3)
        )
        assertTrue(h.desktop.coordinator.state().claiming)

        h.clock.advance(HEARTBEAT_TIMEOUT_MS + 1000)
        assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
    }

    @Test
    fun `reports the vault version so a stale peer can tell`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()
        h.clock.advance(HEARTBEAT_INTERVAL_MS)

        assertEquals(3, h.phone.coordinator.state().vaultVersion)
        assertTrue(h.phone.coordinator.state().peers.containsKey("desktop"))
    }

    @Test
    fun `a follower keeps beating, so the primary can see it`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()
        h.clock.advance(HEARTBEAT_INTERVAL_MS)
        assertEquals(SessionRole.FOLLOWER, h.phone.coordinator.state().role)

        // Several beats later the desktop should still know the phone is there
        h.clock.advance(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

        val peers = h.desktop.coordinator.state().peers
        assertTrue(peers.containsKey("phone"))
        assertEquals(SessionRole.FOLLOWER, peers["phone"]?.role)
        assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
    }

    @Test
    fun `a follower beating does not unseat the primary`() {
        val h = Harness()
        h.desktop.start()
        h.phone.start()

        repeat(10) {
            h.clock.advance(HEARTBEAT_INTERVAL_MS)
            assertEquals(SessionRole.PRIMARY, h.desktop.coordinator.state().role)
            assertEquals(0, h.phone.released)
        }
    }
}
