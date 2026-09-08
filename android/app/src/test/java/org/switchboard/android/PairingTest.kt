package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.switchboard.android.pairing.Pairing
import java.io.File

/**
 * Reading what the desktop's QR says.
 *
 * The desktop writes these strings and this reads them, so the two have to
 * agree about every shape — including the ones that must be refused rather than
 * half-accepted. Same fixture, both test suites.
 */
class PairingTest {

    private val fixtures = File(
        System.getProperty("switchboard.fixtures")
            ?: error("switchboard.fixtures is not set; see app/build.gradle.kts")
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val corpus = json.parseToJsonElement(
        File(fixtures, "pairing.json").readText()
    ).jsonObject

    @Test
    fun `reads every URI the desktop encodes`() {
        for (entry in corpus["encoded"]!!.jsonArray) {
            val case = entry.jsonObject
            val uri = case["uri"]!!.jsonPrimitive.content
            val expectedCode = case["code"].let { if (it is JsonNull) null else it!!.jsonPrimitive.content }

            val payload = Pairing.parse(uri)
            assertEquals("ticket from $uri", case["ticket"]!!.jsonPrimitive.content, payload?.ticket)
            assertEquals("code from $uri", expectedCode, payload?.code)
        }
    }

    @Test
    fun `encodes what the desktop would encode`() {
        for (entry in corpus["encoded"]!!.jsonArray) {
            val case = entry.jsonObject
            val ticket = case["ticket"]!!.jsonPrimitive.content
            val code = case["code"].let { if (it is JsonNull) null else it!!.jsonPrimitive.content }

            // Not byte-equality with the desktop's string — the two escape a few
            // characters differently and both are valid. What matters is that
            // each side reads the other's, so check the round trip.
            val payload = Pairing.parse(Pairing.encode(ticket, code))
            assertEquals(ticket, payload?.ticket)
            assertEquals(code, payload?.code)
        }
    }

    @Test
    fun `accepts a bare ticket, which is what people paste`() {
        for (entry in corpus["alsoAccepted"]!!.jsonArray) {
            val case = entry.jsonObject
            val payload = Pairing.parse(case["input"]!!.jsonPrimitive.content)
            assertEquals(case["ticket"]!!.jsonPrimitive.content, payload?.ticket)
            assertNull(payload?.code)
        }
    }

    @Test
    fun `refuses what the desktop refuses`() {
        for (entry in corpus["rejected"]!!.jsonArray) {
            val input = entry.jsonPrimitive.content
            assertNull("should be refused: '$input'", Pairing.parse(input))
        }
    }
}
