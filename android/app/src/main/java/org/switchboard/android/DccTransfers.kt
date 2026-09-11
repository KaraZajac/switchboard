package org.switchboard.android

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.UUID

/**
 * Files somebody offers over DCC.
 *
 * Receiving only. Sending needs a listening socket the other side can reach,
 * which behind mobile NAT it almost never can — offering a transfer that
 * cannot complete is worse than not offering one, and the desktop is there for
 * that.
 *
 * Nothing is automatic. An offer is recorded and shown; the socket is opened
 * when somebody presses Accept. Auto-accepting a DCC is how the protocol got
 * its reputation, and nothing here turns that on.
 *
 * The line itself is read by [org.switchboard.android.irc.Dcc], which the
 * desktop shares — see `src/shared/dcc.ts`.
 */
class DccTransfers(private val context: Context, private val scope: CoroutineScope) {

    /** @param state `offered`, `active`, `done` or `failed` */
    data class Transfer(
        val id: String,
        val serverId: String,
        val peer: String,
        val filename: String,
        val address: String,
        val port: Int,
        val size: Long,
        var transferred: Long = 0,
        var state: String = "offered",
        var error: String? = null,
        /** Where it ended up, once it did */
        var savedTo: String? = null
    )

    private val all = mutableStateListOf<Transfer>()

    /** Everything offered, being moved, or finished this session */
    val transfers: List<Transfer> get() = all

    /** Bumped on every change, so a screen watching it redraws */
    var revision by mutableStateOf(0)
        private set

    private fun changed() {
        revision++
    }

    /** Somebody offered a file. Shown, not taken. */
    fun offered(
        serverId: String,
        peer: String,
        filename: String,
        address: String,
        port: Int,
        size: Long
    ) {
        all += Transfer(UUID.randomUUID().toString(), serverId, peer, filename, address, port, size)
        changed()
    }

    /** Refuse one. Nothing is sent — the sender's own timeout ends it. */
    fun decline(id: String) {
        all.removeAll { it.id == id }
        changed()
    }

    /**
     * Take it.
     *
     * The size the sender claimed is not trusted for anything but a progress
     * bar: a sender who says one number and streams another is stopped at the
     * number they said, because a transfer that keeps writing until the
     * storage fills is the failure that matters.
     */
    fun accept(id: String) {
        val transfer = all.firstOrNull { it.id == id } ?: return
        if (transfer.state != "offered") return

        transfer.state = "active"
        changed()

        scope.launch(Dispatchers.IO) {
            runCatching { receive(transfer) }
                .onFailure {
                    transfer.state = "failed"
                    transfer.error = it.message ?: "It did not work"
                    withContext(Dispatchers.Main) { changed() }
                }
        }
    }

    private suspend fun receive(transfer: Transfer) {
        val socket = Socket()
        socket.connect(InetSocketAddress(transfer.address, transfer.port), 30_000)
        socket.soTimeout = 60_000

        val (stream, where) = openFor(transfer.filename)
        transfer.savedTo = where

        socket.use { open ->
            stream.use { out ->
                val input = open.getInputStream()
                val output = open.getOutputStream()
                val chunk = ByteArray(16 * 1024)

                while (true) {
                    val room = if (transfer.size > 0) transfer.size - transfer.transferred else Long.MAX_VALUE
                    if (room <= 0) break

                    val read = input.read(chunk, 0, minOf(chunk.size.toLong(), room).toInt())
                    if (read <= 0) break

                    out.write(chunk, 0, read)
                    transfer.transferred += read

                    // DCC acknowledges with the running total as a big-endian
                    // 32-bit count. Some senders wait for it before sending
                    // more, so leaving it out is a transfer that stops after
                    // one window and never says why.
                    output.write(
                        ByteBuffer.allocate(4).putInt(transfer.transferred.toInt()).array()
                    )
                    output.flush()

                    withContext(Dispatchers.Main) { changed() }
                }
            }
        }

        // A sender that hung up early left a file that is not the file
        if (transfer.size > 0 && transfer.transferred < transfer.size) {
            transfer.state = "failed"
            transfer.error = "The sender hung up before the file was finished"
        } else {
            transfer.state = "done"
        }
        withContext(Dispatchers.Main) { changed() }
    }

    /**
     * Somewhere to put it.
     *
     * The public Downloads folder through MediaStore on anything modern, which
     * needs no permission and puts the file where a person would look for it.
     * Older versions get the app's own downloads directory — still reachable
     * from a file manager, and not worth asking for storage permission over.
     */
    private fun openFor(filename: String): Pair<OutputStream, String> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, filename)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            if (uri != null) {
                val stream = resolver.openOutputStream(uri)
                if (stream != null) {
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    return stream to "Downloads/$filename"
                }
            }
        }

        val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: context.filesDir
        val file = File(directory, filename)
        return file.outputStream() to file.absolutePath
    }
}
