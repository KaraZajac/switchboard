package org.switchboard.android

import computer.iroh.Connection
import computer.iroh.Endpoint
import computer.iroh.EndpointOptions
import computer.iroh.EndpointTicket
import computer.iroh.RecvStream
import computer.iroh.SendStream
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.atomic.AtomicInteger

/**
 * The phone's half of the link to a Switchboard desktop.
 *
 * Speaks the same vocabulary the desktop's own window uses: `call` names an IPC
 * channel, `event` carries what the desktop UI would have received. Nothing
 * here knows anything about IRC — the desktop holds the connections and the
 * credentials, and this is a second front end onto them.
 */
class RemoteClient(private val scope: CoroutineScope) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val alpn = ALPN.toByteArray()

    private var endpoint: Endpoint? = null
    private var connection: Connection? = null
    private var send: SendStream? = null
    private var recv: RecvStream? = null

    private val writeLock = Mutex()
    private val nextId = AtomicInteger(1)
    private val pending = mutableMapOf<Int, CompletableDeferred<JsonElement>>()

    var onEvent: ((channel: String, data: JsonElement) -> Unit)? = null
    var onStatus: ((String) -> Unit)? = null

    /**
     * Frames that are not calls or events: who is holding the connections, and
     * keeping the shared vault in step. The desktop peer is always addressed as
     * "desktop" — there is exactly one of it on this link.
     */
    var onPeerFrame: ((JsonObject) -> Unit)? = null

    /** True once the handshake succeeded, so the coordinator knows it has a peer */
    var isLinked: Boolean = false
        private set

    /**
     * Dial a desktop by its ticket and complete the handshake.
     *
     * [secretKey] is this device's long-lived identity. The desktop recognises a
     * paired phone by its public key, so generating a fresh one each launch
     * would turn every restart back into a stranger.
     */
    suspend fun connect(
        ticket: String,
        pairingCode: String?,
        deviceName: String,
        secretKey: ByteArray
    ) {
        // A re-dial must not leave the previous endpoint bound: each one holds
        // a UDP socket and its own QUIC state, and they accumulate.
        runCatching { connection?.close(0, "redial".toByteArray()) }
        runCatching { endpoint?.shutdown() }
        connection = null
        endpoint = null

        onStatus?.invoke("Starting endpoint…")
        val ep = Endpoint.bind(EndpointOptions(alpns = listOf(alpn), secretKey = secretKey))
        endpoint = ep

        onStatus?.invoke("Dialing desktop…")
        val addr = EndpointTicket.fromString(ticket.trim()).endpointAddr()
        val conn = ep.connect(addr, alpn)
        connection = conn

        val stream = conn.openBi()
        send = stream.send()
        recv = stream.recv()

        scope.launch(Dispatchers.IO) { readLoop() }

        writeFrame(
            buildJsonObject {
                put("t", JsonPrimitive("hello"))
                put("v", JsonPrimitive(PROTOCOL_VERSION))
                put("name", JsonPrimitive(deviceName))
                if (!pairingCode.isNullOrBlank()) put("pairingCode", JsonPrimitive(pairingCode))
            }
        )
    }

    /** Invoke a channel on the desktop core and wait for its result. */
    suspend fun call(channel: String, vararg args: JsonElement): JsonElement {
        val id = nextId.getAndIncrement()
        val waiter = CompletableDeferred<JsonElement>()
        synchronized(pending) { pending[id] = waiter }

        writeFrame(
            buildJsonObject {
                put("t", JsonPrimitive("call"))
                put("id", JsonPrimitive(id))
                put("channel", JsonPrimitive(channel))
                put("args", buildJsonArray { args.forEach { add(it) } })
            }
        )
        return waiter.await()
    }

    suspend fun close() {
        linkLost("closed")
        runCatching { connection?.close(0, "bye".toByteArray()) }
        runCatching { endpoint?.shutdown() }
        connection = null
        endpoint = null
    }

    /**
     * Write one frame, or decide the link is gone.
     *
     * A write to a timed-out QUIC stream throws, and this is called from the
     * session heartbeat — which beats precisely when the desktop has stopped
     * answering. Letting that propagate took the whole app down at the one
     * moment the phone is supposed to carry on without it.
     */
    private suspend fun writeFrame(frame: JsonObject) {
        val bytes = (json.encodeToString(JsonObject.serializer(), frame) + "\n").toByteArray()
        try {
            // One stream, many coroutines: interleaved writes would corrupt frames.
            writeLock.withLock { send?.writeAll(bytes) ?: throw IllegalStateException("no link") }
        } catch (e: Throwable) {
            linkLost(e.message ?: "the link went away")
        }
    }

    /** The link is no longer usable: say so once, and let everyone waiting go */
    private fun linkLost(reason: String) {
        val wasLinked = isLinked
        isLinked = false
        send = null

        val waiting = synchronized(pending) {
            val snapshot = pending.values.toList()
            pending.clear()
            snapshot
        }
        for (waiter in waiting) waiter.completeExceptionally(RuntimeException(reason))

        if (wasLinked) {
            onStatus?.invoke("Link closed: $reason")
            // The coordinator has to hear this: with the desktop gone, this
            // phone is about to become the connection.
            onPeerFrame?.invoke(buildJsonObject { put("t", JsonPrimitive("peer-gone")) })
        }
    }

    private suspend fun readLoop() {
        val stream = recv ?: return
        val buffer = StringBuilder()

        try {
            while (true) {
                val chunk = stream.read(READ_LIMIT)
                if (chunk.isEmpty()) break
                buffer.append(String(chunk))

                while (true) {
                    val newline = buffer.indexOf("\n")
                    if (newline < 0) break
                    val line = buffer.substring(0, newline)
                    buffer.delete(0, newline + 1)
                    if (line.isNotBlank()) handleFrame(json.parseToJsonElement(line).jsonObject)
                }
            }
        } catch (e: Throwable) {
            linkLost(e.message ?: "the stream ended")
        } finally {
            linkLost("the stream ended")
        }
    }

    /** Send a session or vault frame to the desktop */
    suspend fun sendPeerFrame(frame: JsonObject) = writeFrame(frame)

    private fun handleFrame(frame: JsonObject) {
        val type = frame["t"]?.jsonPrimitive?.content

        if (type in PEER_FRAMES) {
            onPeerFrame?.invoke(frame)
            return
        }

        when (type) {
            "welcome" -> {
                isLinked = true
                onStatus?.invoke("Paired with ${frame["name"]?.jsonPrimitive?.content}")
            }

            "denied" -> {
                isLinked = false
                onStatus?.invoke("Rejected: ${frame["reason"]?.jsonPrimitive?.content}")
            }

            "result" -> {
                val id = frame["id"]?.jsonPrimitive?.int ?: return
                val waiter = synchronized(pending) { pending.remove(id) } ?: return
                val ok = frame["ok"]?.jsonPrimitive?.content == "true"
                if (ok) {
                    waiter.complete(frame["value"] ?: JsonNull)
                } else {
                    waiter.completeExceptionally(
                        RuntimeException(frame["error"]?.jsonPrimitive?.content ?: "call failed")
                    )
                }
            }

            "event" -> {
                val channel = frame["channel"]?.jsonPrimitive?.content ?: return
                onEvent?.invoke(channel, frame["data"] ?: JsonNull)
            }
        }
    }

    companion object {
        const val ALPN = "switchboard/remote/0"
        const val PROTOCOL_VERSION = 1
        private const val READ_LIMIT = 65536u

        private val PEER_FRAMES = setOf(
            "heartbeat", "claim", "yielded", "goodbye",
            "vault-offer", "vault-request", "vault-payload"
        )

        fun str(value: String): JsonElement = JsonPrimitive(value)
        fun num(value: Int): JsonElement = JsonPrimitive(value)
        fun nul(): JsonElement = JsonNull
        fun arrayOfStrings(values: List<String>): JsonArray = buildJsonArray {
            values.forEach { add(JsonPrimitive(it)) }
        }
    }
}
