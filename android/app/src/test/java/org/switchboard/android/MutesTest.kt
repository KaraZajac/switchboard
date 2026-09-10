package org.switchboard.android

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Muting, on the shape the desktop writes.
 *
 * The two clients keep one `mutes` setting between them, so this is really a
 * compatibility test: a mute set in `mutePersistence.ts` has to mean the same
 * thing here, including the timed ones the phone cannot set but must honour.
 */
class MutesTest {

    private val hour = 60 * 60 * 1000L

    @Test
    fun `muting a server and unmuting it again`() {
        var mutes = Mutes()
        assertFalse(mutes.serverMuted("srv"))

        mutes = mutes.toggleServer("srv")
        assertTrue(mutes.serverMuted("srv"))
        assertEquals(0L, mutes.servers["srv"])

        mutes = mutes.toggleServer("srv")
        assertFalse(mutes.serverMuted("srv"))
        assertTrue(mutes.servers.isEmpty())
    }

    @Test
    fun `channel keys are case-insensitive, the way channel names are`() {
        val mutes = Mutes().toggleChannel("srv", "#Lobby")

        assertTrue(mutes.channelMuted("srv", "#lobby"))
        assertTrue(mutes.channelMuted("srv", "#LOBBY"))
        assertEquals(setOf("srv:#lobby"), mutes.channels.keys)
    }

    @Test
    fun `a mute on one server does not quiet the same channel name on another`() {
        val mutes = Mutes().toggleChannel("srv", "#lobby")

        assertFalse(mutes.channelMuted("other", "#lobby"))
    }

    /**
     * The desktop can mute for an hour. The phone never writes one, but it has
     * to read one — otherwise "mute for an hour" over there is silence for ever
     * over here.
     */
    @Test
    fun `a timed mute the desktop set lapses on its own`() {
        val now = System.currentTimeMillis()
        val mutes = Mutes(servers = mapOf("srv" to now + hour, "old" to now - hour))

        assertTrue(mutes.serverMuted("srv", now))
        assertFalse(mutes.serverMuted("old", now))
    }

    @Test
    fun `zero means until somebody unmutes it, not the epoch`() {
        val mutes = Mutes(servers = mapOf("srv" to 0L))

        assertTrue(mutes.serverMuted("srv", System.currentTimeMillis()))
    }

    @Test
    fun `round-trips through the JSON the desktop stores`() {
        val mutes = Mutes().toggleServer("srv").toggleChannel("srv", "#lobby")
        val json = mutes.toJson()

        assertEquals("0", json["servers"]!!.jsonObject["srv"]!!.jsonPrimitive.content)
        assertEquals("0", json["channels"]!!.jsonObject["srv:#lobby"]!!.jsonPrimitive.content)
        assertEquals(mutes, Mutes.fromJson(json))
    }

    @Test
    fun `reads a setting the desktop wrote`() {
        val desktop = buildJsonObject {
            put("servers", buildJsonObject { put("srv", JsonPrimitive(0)) })
            put("channels", buildJsonObject { put("srv:#noise", JsonPrimitive(0)) })
        }

        val mutes = Mutes.fromJson(desktop)
        assertTrue(mutes.serverMuted("srv"))
        assertTrue(mutes.channelMuted("srv", "#noise"))
    }

    @Test
    fun `an empty or half-written setting is read as nothing muted`() {
        assertEquals(Mutes(), Mutes.fromJson(buildJsonObject { }))

        // One quoted value should not take the whole map down with it
        val odd = buildJsonObject {
            put("servers", buildJsonObject {
                put("srv", JsonPrimitive("0"))
                put("broken", JsonPrimitive("soon"))
            })
        }
        val mutes = Mutes.fromJson(odd)
        assertTrue(mutes.serverMuted("srv"))
        assertFalse(mutes.serverMuted("broken"))
    }
}
