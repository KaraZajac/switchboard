package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.switchboard.android.push.WebPush
import java.io.File
import java.security.KeyFactory
import java.security.KeyPair
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.util.Base64

/**
 * Web Push encryption, RFC 8291.
 *
 * The desktop has its own implementation of this, written from the same RFC
 * and sharing no code. These check that each can read what the other wrote,
 * which is the only evidence available until a server is actually sending
 * them — and the evidence that matters, because a server will be talking to
 * both.
 */
class WebPushTest {

    private val fixtures = File(
        System.getProperty("switchboard.fixtures")
            ?: error("switchboard.fixtures is not set; see app/build.gradle.kts")
    )

    private val json = Json { ignoreUnknownKeys = true }
    private fun load(name: String): JsonObject =
        json.parseToJsonElement(File(fixtures, name).readText()).jsonObject

    private fun decode(value: String): ByteArray = Base64.getDecoder().decode(value)

    /** Rebuild the desktop's subscription from the raw scalar it wrote out */
    private fun subscriptionFrom(publicKey: ByteArray, privateScalar: ByteArray, auth: ByteArray):
        WebPush.Subscription {
        val params = java.security.AlgorithmParameters.getInstance("EC").run {
            init(ECGenParameterSpec("secp256r1"))
            getParameterSpec(ECParameterSpec::class.java)
        }
        val factory = KeyFactory.getInstance("EC")
        val s = java.math.BigInteger(1, privateScalar)
        val private = factory.generatePrivate(ECPrivateKeySpec(s, params))

        val x = java.math.BigInteger(1, publicKey.copyOfRange(1, 33))
        val y = java.math.BigInteger(1, publicKey.copyOfRange(33, 65))
        val public = factory.generatePublic(ECPublicKeySpec(ECPoint(x, y), params))

        return WebPush.Subscription(KeyPair(public, private), auth)
    }

    // ── on its own ────────────────────────────────────────────────────

    @Test
    fun `reads back what it wrote`() {
        val subscription = WebPush.newSubscription()
        val message = "someone said your name in #lounge".toByteArray()

        val body = WebPush.encrypt(message, subscription.publicKey, subscription.authSecret)

        assertArrayEquals(message, WebPush.decrypt(body, subscription))
    }

    @Test
    fun `produces a different body every time, from the same input`() {
        val subscription = WebPush.newSubscription()
        val message = "hello".toByteArray()

        val first = WebPush.encrypt(message, subscription.publicKey, subscription.authSecret)
        val second = WebPush.encrypt(message, subscription.publicKey, subscription.authSecret)

        assertNotEquals(first.toList(), second.toList())
        assertArrayEquals(message, WebPush.decrypt(second, subscription))
    }

    @Test
    fun `carries an empty message`() {
        val subscription = WebPush.newSubscription()
        val body = WebPush.encrypt(ByteArray(0), subscription.publicKey, subscription.authSecret)

        assertEquals(0, WebPush.decrypt(body, subscription)?.size)
    }

    @Test
    fun `carries text that is not ASCII`() {
        val subscription = WebPush.newSubscription()
        val message = "🔥 mentioned you — «привет»".toByteArray()

        val body = WebPush.encrypt(message, subscription.publicKey, subscription.authSecret)

        assertArrayEquals(message, WebPush.decrypt(body, subscription))
    }

    @Test
    fun `a subscription advertises an uncompressed point`() {
        val subscription = WebPush.newSubscription()

        assertEquals(65, subscription.publicKey.size)
        assertEquals(0x04.toByte(), subscription.publicKey[0])
        assertEquals(16, subscription.authSecret.size)
    }

    // ── refusing what it should refuse ────────────────────────────────

    @Test
    fun `will not read a message meant for someone else`() {
        val mine = WebPush.newSubscription()
        val theirs = WebPush.newSubscription()

        val body = WebPush.encrypt("not for you".toByteArray(), theirs.publicKey, theirs.authSecret)

        assertNull(WebPush.decrypt(body, mine))
    }

    @Test
    fun `will not read a message whose ciphertext was altered`() {
        val subscription = WebPush.newSubscription()
        val body = WebPush.encrypt("as sent".toByteArray(), subscription.publicKey, subscription.authSecret)

        body[body.size - 20] = (body[body.size - 20].toInt() xor 0xFF).toByte()

        assertNull(WebPush.decrypt(body, subscription))
    }

    @Test
    fun `returns null for a body that is not one of these at all`() {
        val subscription = WebPush.newSubscription()

        assertNull(WebPush.decrypt(ByteArray(0), subscription))
        assertNull(WebPush.decrypt("nonsense".toByteArray(), subscription))
        assertNull(WebPush.decrypt(ByteArray(200), subscription))
    }

    // ── agreeing with the desktop ─────────────────────────────────────

    @Test
    fun `reads a message the desktop encrypted`() {
        val fixture = load("webpush.json")
        val subscription = subscriptionFrom(
            decode(fixture["publicKey"]!!.jsonPrimitive.content),
            decode(fixture["privateKey"]!!.jsonPrimitive.content),
            decode(fixture["authSecret"]!!.jsonPrimitive.content)
        )

        val plaintext = WebPush.decrypt(
            decode(fixture["body"]!!.jsonPrimitive.content),
            subscription
        )

        assertEquals(fixture["plaintext"]!!.jsonPrimitive.content, plaintext?.toString(Charsets.UTF_8))
    }

    /**
     * And the other direction: a body this client wrote, for the desktop suite
     * to read back.
     */
    @Test
    fun `writes a message the desktop can read`() {
        val fixture = load("webpush.json")
        val subscription = subscriptionFrom(
            decode(fixture["publicKey"]!!.jsonPrimitive.content),
            decode(fixture["privateKey"]!!.jsonPrimitive.content),
            decode(fixture["authSecret"]!!.jsonPrimitive.content)
        )

        val plaintext = "from the phone"
        val body = WebPush.encrypt(
            plaintext.toByteArray(),
            subscription.publicKey,
            subscription.authSecret
        )

        // It must at least be readable here; the desktop suite reads the file
        assertEquals(plaintext, WebPush.decrypt(body, subscription)?.toString(Charsets.UTF_8))

        File(fixtures, "webpush-from-android.json").writeText(
            """
            {
              "note": "A Web Push body written by the Kotlin implementation, for tests/main/webpush.test.ts to read.",
              "plaintext": "$plaintext",
              "publicKey": "${fixture["publicKey"]!!.jsonPrimitive.content}",
              "privateKey": "${fixture["privateKey"]!!.jsonPrimitive.content}",
              "authSecret": "${fixture["authSecret"]!!.jsonPrimitive.content}",
              "body": "${Base64.getEncoder().encodeToString(body)}"
            }
            """.trimIndent() + "\n"
        )
    }
}
