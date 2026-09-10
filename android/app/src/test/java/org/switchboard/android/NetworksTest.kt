package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The list offered to somebody with no networks.
 *
 * This phone reads the desktop's `src/shared/networks.json`, copied into its
 * assets at build time. The copy is what this checks: that the file the build
 * hands the app is the one the desktop ships, and that it parses into the
 * shape the picker expects.
 *
 * A broken entry here is a first-run experience that dead-ends, on the one
 * screen where a user has no way to tell our mistake from their own.
 */
class NetworksTest {

    private val json = Json { ignoreUnknownKeys = true }

    private val original = File(
        System.getProperty("switchboard.fixtures")!!
    ).resolveSibling("../src/shared/networks.json").normalize()

    private val copied = File("src/main/assets/networks.json")

    private fun parse(file: File) =
        json.parseToJsonElement(file.readText()).let { it as JsonObject }

    @Test
    fun `the asset is the desktop's file, not a second copy of it`() {
        assertTrue("the build should have copied it: $copied", copied.exists())
        assertEquals(original.readText(), copied.readText())
    }

    @Test
    fun `parses into what the picker renders`() {
        val networks = parse(copied)["networks"]!!.jsonArray
        assertTrue("a useful number of them", networks.size >= 8)

        for (entry in networks) {
            val network = entry as JsonObject
            val id = network["id"]!!.jsonPrimitive.content

            assertTrue("$id has a name", network["name"]!!.jsonPrimitive.content.isNotBlank())
            assertTrue("$id says what it is for", network["description"]!!.jsonPrimitive.content.length > 20)
            assertTrue("$id says where it is", network["region"]!!.jsonPrimitive.content.isNotBlank())
            assertTrue("$id has a host", network["host"]!!.jsonPrimitive.content.contains('.'))
            assertTrue("$id is over TLS", network["tls"]!!.jsonPrimitive.content == "true")

            val port = network["port"]!!.jsonPrimitive.content.toInt()
            assertTrue("$id has a usable port", port in 1..65535)
        }
    }

    @Test
    fun `no two of them are the same network`() {
        val networks = parse(copied)["networks"]!!.jsonArray
        val ids = networks.map { (it as JsonObject)["id"]!!.jsonPrimitive.content }
        val hosts = networks.map { (it as JsonObject)["host"]!!.jsonPrimitive.content }

        assertEquals(ids.size, ids.toSet().size)
        assertEquals(hosts.size, hosts.toSet().size)
    }
}
