package org.switchboard.android.session

/**
 * Which device is holding the IRC connections — the phone's half.
 *
 * A direct port of `src/main/session/coordinator.ts`, and it has to stay one:
 * the algorithm only works if both devices reason identically about who is
 * primary. Two devices connected under one nick is the failure this exists to
 * prevent, and it is not a failure the user can undo.
 *
 * The phone outranks nothing — the desktop wins whenever it is up. But when the
 * desktop's heartbeat lapses, the phone unseals the shared vault, connects to
 * everything the desktop was holding, and hands back the moment it returns.
 */

enum class SessionRole { PRIMARY, FOLLOWER }

/** Higher wins. A desktop is a better host than a phone: mains power, no Doze. */
const val DESKTOP_PRIORITY = 100
const val PHONE_PRIORITY = 10

const val HEARTBEAT_INTERVAL_MS = 5_000L
/** Three missed beats before a follower concludes the primary is gone */
const val HEARTBEAT_TIMEOUT_MS = 16_000L
/**
 * How long a starting device listens before assuming it is the connection.
 *
 * A phone that woke from Doze must not barge onto the network while the desktop
 * is still sitting there holding it.
 */
const val DISCOVERY_MS = 6_000L

data class PeerInfo(val role: SessionRole, val priority: Int, val lastSeen: Long)

data class SessionState(
    val role: SessionRole,
    val priority: Int,
    val since: String?,
    val peers: Map<String, PeerInfo>,
    val claiming: Boolean,
    val vaultVersion: Int
)

sealed interface SessionFrame {
    data class Heartbeat(
        val role: SessionRole,
        val priority: Int,
        val since: String?,
        val vaultVersion: Int
    ) : SessionFrame

    data class Claim(val priority: Int) : SessionFrame
    data object Yielded : SessionFrame

    /**
     * "I am going away."
     *
     * Sent when a device shuts down on purpose. Without it the other side waits
     * out the heartbeat timeout before concluding anything — sixteen seconds of
     * a user's messages going nowhere, every time they close the app.
     */
    data object Goodbye : SessionFrame
}

/** What the coordinator needs from the IRC layer, injected so it stays testable */
interface ConnectionControl {
    /** Take the connections: this device is now the one on the network */
    fun resume()
    /** Give them up: another device is taking over */
    fun release()
    /** Current vault version, advertised in heartbeats */
    fun vaultVersion(): Int
}

interface CoordinatorTransport {
    /** Send a frame to one peer, or to all when [peerId] is null */
    fun send(frame: SessionFrame, peerId: String? = null)
    /** True when at least one peer is connected */
    fun hasPeers(): Boolean
}

/**
 * The clock and the timers, pulled out so tests can drive them.
 *
 * Android's real scheduler is not something a unit test should wait on, and the
 * cases worth testing are all about elapsed time.
 */
interface SessionClock {
    fun now(): Long
    fun schedule(delayMs: Long, action: () -> Unit): Cancellable
    fun repeating(intervalMs: Long, action: () -> Unit): Cancellable
}

fun interface Cancellable {
    fun cancel()
}

/**
 * Driven from three threads — the heartbeat timer, the QUIC read loop and the
 * coroutines that answer it — so every entry point is synchronized. The lock is
 * held only for state changes; sends go out through the transport, which does
 * its own queueing.
 */
class SessionCoordinator(
    private val priority: Int,
    private val transport: CoordinatorTransport,
    private val connections: ConnectionControl,
    private val clock: SessionClock
) {
    private var role = SessionRole.PRIMARY
    private var since: String? = null
    private var claiming = false
    private val peers = LinkedHashMap<String, PeerInfo>()

    private var heartbeat: Cancellable? = null
    private val listeners = mutableSetOf<(SessionState) -> Unit>()

    @Synchronized
    fun start() {
        if (heartbeat == null) heartbeat = clock.repeating(HEARTBEAT_INTERVAL_MS) { tick() }

        if (transport.hasPeers()) {
            // Someone might already be holding the connections — listen first.
            role = SessionRole.FOLLOWER
            since = null
            clock.schedule(DISCOVERY_MS) { evaluate() }
        } else {
            becomePrimary()
        }

        emit()
    }

    @Synchronized
    fun stop() {
        heartbeat?.cancel()
        heartbeat = null
    }

    fun onChange(listener: (SessionState) -> Unit): Cancellable {
        listeners.add(listener)
        return Cancellable { listeners.remove(listener) }
    }

    @Synchronized
    fun state(): SessionState = SessionState(
        role = role,
        priority = priority,
        since = since,
        peers = LinkedHashMap(peers),
        claiming = claiming,
        vaultVersion = connections.vaultVersion()
    )

    /**
     * Check now, rather than at the next beat.
     *
     * For when something outside knows the world may have moved on while we
     * were not running — coming out of Doze, or an alarm that fired through it.
     */
    @Synchronized
    fun poke() {
        if (heartbeat == null) return
        tick()
    }

    /** A peer disconnected from the link entirely */
    @Synchronized
    fun peerGone(peerId: String) {
        if (peers.remove(peerId) != null) evaluate()
    }

    /** Called by the transport each time a peer connects */
    @Synchronized
    fun peerConnected(peerId: String) {
        peers[peerId] = PeerInfo(SessionRole.FOLLOWER, 0, clock.now())
        sendHeartbeat(peerId)
    }

    @Synchronized
    fun handleFrame(peerId: String, frame: SessionFrame) {
        // A frame arriving before start() (or after stop()) must not flip roles:
        // this device is not in a position to hold or hand over anything yet.
        if (heartbeat == null) return

        when (frame) {
            is SessionFrame.Heartbeat -> {
                peers[peerId] = PeerInfo(frame.role, frame.priority, clock.now())
                evaluate()
            }

            is SessionFrame.Claim -> {
                if (frame.priority > priority && role == SessionRole.PRIMARY) {
                    // Release before saying so, or both devices are briefly on
                    // the network at once.
                    becomeFollower()
                    transport.send(SessionFrame.Yielded, peerId)
                } else {
                    sendHeartbeat(peerId)
                }
            }

            is SessionFrame.Yielded -> {
                if (claiming) {
                    claiming = false
                    becomePrimary()
                }
            }

            is SessionFrame.Goodbye -> {
                // They said so rather than us having to wait and infer it
                peers.remove(peerId)
                evaluate()
            }
        }
    }

    /**
     * Tell the peers we are going, and stop.
     *
     * Stops before speaking: saying goodbye while still listening means the
     * peer takes over, beats, and this device — already on its way out —
     * answers by claiming the connection straight back off them.
     */
    @Synchronized
    fun leave() {
        val wasRunning = heartbeat != null
        stop()
        if (wasRunning) transport.send(SessionFrame.Goodbye)
    }

    // ── internals ──────────────────────────────────────────────────────

    @Synchronized
    private fun tick() {
        expirePeers()

        // Everyone beats, follower included. A silent follower is invisible to
        // the primary, which then cannot show the user that the other device is
        // there — and cannot tell "no peer" apart from "a peer following me".
        sendHeartbeat()

        // No primary in sight for long enough: take over.
        if (role != SessionRole.PRIMARY && livePrimary() == null) takeOver()
    }

    private fun expirePeers() {
        val cutoff = clock.now() - HEARTBEAT_TIMEOUT_MS
        val stale = peers.filterValues { it.lastSeen < cutoff }.keys
        if (stale.isNotEmpty()) {
            stale.forEach { peers.remove(it) }
            emit()
        }
    }

    private fun livePrimary(): PeerInfo? {
        val cutoff = clock.now() - HEARTBEAT_TIMEOUT_MS
        return peers.values.firstOrNull { it.role == SessionRole.PRIMARY && it.lastSeen >= cutoff }
    }

    /**
     * Work out whether this device should be holding the connections.
     *
     * Ties never happen in practice (desktop 100, phone 10) but are resolved the
     * same way on both sides anyway, so two devices cannot both decide they won.
     */
    private fun evaluate() {
        val primary = livePrimary()

        if (role == SessionRole.PRIMARY && primary != null && primary.priority > priority) {
            // A better host is already up; step aside without being asked.
            becomeFollower()
            return
        }

        if (role == SessionRole.PRIMARY && primary != null && primary.priority < priority) {
            // Two primaries, and we outrank. Tell them to let go.
            transport.send(SessionFrame.Claim(priority))
            return
        }

        if (role == SessionRole.FOLLOWER && primary != null && primary.priority < priority) {
            claim()
            return
        }

        if (role == SessionRole.FOLLOWER && primary == null && !claiming) {
            takeOver()
        }
    }

    private fun claim() {
        if (claiming) return
        claiming = true
        transport.send(SessionFrame.Claim(priority))
        emit()

        // If nobody yields, take over anyway rather than leaving the user with
        // no connection at all.
        clock.schedule(HEARTBEAT_TIMEOUT_MS) {
            if (claiming) {
                claiming = false
                takeOver()
            }
        }
    }

    private fun takeOver() {
        if (role == SessionRole.PRIMARY) return
        becomePrimary()
    }

    private fun becomePrimary() {
        role = SessionRole.PRIMARY
        since = isoNow()
        claiming = false
        connections.resume()
        sendHeartbeat()
        emit()
    }

    private fun becomeFollower() {
        role = SessionRole.FOLLOWER
        since = null
        connections.release()
        emit()
    }

    private fun sendHeartbeat(peerId: String? = null) {
        transport.send(
            SessionFrame.Heartbeat(role, priority, since, connections.vaultVersion()),
            peerId
        )
    }

    private fun isoNow(): String = java.time.Instant.ofEpochMilli(clock.now()).toString()

    private fun emit() {
        val snapshot = state()
        for (listener in listeners.toList()) {
            runCatching { listener(snapshot) }
        }
    }
}
