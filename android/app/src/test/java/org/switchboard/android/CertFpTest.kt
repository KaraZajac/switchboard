package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.switchboard.android.irc.CertFp
import java.io.File

/**
 * SASL EXTERNAL, which needs the handshake to present a certificate.
 *
 * The same corpus `tests/main/certfp.test.ts` reads. Both clients implemented
 * the mechanism and neither had anywhere to put a certificate, so the
 * connection presented none and the server had nothing to look up.
 */
class CertFpTest {

    private val fixtures = File(
        System.getProperty("switchboard.fixtures")
            ?: error("switchboard.fixtures is not set; see app/build.gradle.kts")
    )

    private val corpus: JsonObject =
        Json { ignoreUnknownKeys = true }
            .parseToJsonElement(File(fixtures, "certfp.json").readText())
            .jsonObject

    private fun text(key: String) = corpus[key]!!.jsonPrimitive.content

    @Test
    fun `reads every case the desktop reads`() {
        for (entry in corpus["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val pem = case["pem"]!!.jsonPrimitive.content

            val whole = case["hasCertificate"]!!.jsonPrimitive.booleanOrNull!! &&
                case["hasKey"]!!.jsonPrimitive.booleanOrNull!!

            assertEquals("$name: read", whole, CertFp.read(pem) != null)
            assertEquals(
                "$name: problem",
                case["problem"]!!.jsonPrimitive.contentOrNull,
                CertFp.problem(pem)
            )
        }
    }

    @Test
    fun `keeps the two blocks apart whichever order they came in`() {
        val both = CertFp.read(text("certificate") + "\n" + text("privateKey"))
        val swapped = CertFp.read(text("privateKey") + "\n" + text("certificate"))

        assertEquals(both, swapped)
        assertNotNull(both)
        assertEquals(true, both!!.certificate.contains("BEGIN CERTIFICATE"))
        assertEquals(false, both.certificate.contains("PRIVATE KEY"))
    }

    @Test
    fun `computes the fingerprint a network asks for`() {
        // The same number openssl prints, and the same one the desktop computes
        assertEquals(
            text("fingerprint"),
            CertFp.fingerprint(text("certificate") + "\n" + text("privateKey"))
        )
    }

    @Test
    fun `builds a socket factory from the certificate, and none without one`() {
        assertNotNull(
            "a readable certificate is one we can present",
            CertFp.socketFactory(text("certificate") + "\n" + text("privateKey"))
        )
        assertNull("nothing to present", CertFp.socketFactory(null))
        assertNull("nothing readable to present", CertFp.socketFactory("hunter2"))
    }

    @Test
    fun `says how to convert a key in the older format`() {
        val pkcs1 = text("certificate") +
            "\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"

        val problem = CertFp.problem(pkcs1)
        assertNotNull("a PKCS#1 key is readable but not usable by Java", problem)
        assertEquals(true, problem!!.contains("openssl pkcs8"))
    }
}
