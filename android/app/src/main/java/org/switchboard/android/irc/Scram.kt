package org.switchboard.android.irc

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * SASL SCRAM, as RFC 5802 defines it and IRCv3 uses it.
 *
 * A port of `src/main/irc/scram.ts`. The point of SCRAM over PLAIN is that the
 * password never crosses the wire and the client can check that the server also
 * knew it — so the server signature really is verified here rather than
 * accepted, which is the step it is tempting to skip.
 *
 * SHA-256 is what the IRCv3 examples use and what most servers advertise.
 * Libera advertises SHA-512 and not SHA-256, so a client that only knew the one
 * fell back to PLAIN there. The exchange is identical either way; only the
 * digest and the key length change.
 */
class Scram(
    username: String,
    private val password: String,
    mechanism: String = "SCRAM-SHA-256",
    /**
     * The client nonce, which is random except when a test needs to know it.
     * RFC 7677 prints one exchange in full, and checking against it is the
     * only way to know four HMACs and an XOR are in the right order — the
     * failure mode otherwise is a server saying 904 and a user being told
     * their password is wrong.
     */
    nonce: String? = null
) {

    /** The digest this mechanism names, and the MAC built on it */
    private val sha512 = mechanism == "SCRAM-SHA-512"
    private val digest = if (sha512) "SHA-512" else "SHA-256"
    private val macName = if (sha512) "HmacSHA512" else "HmacSHA256"

    private val clientNonce: String = nonce
        ?: Base64.getEncoder().encodeToString(ByteArray(24).also { SecureRandom().nextBytes(it) })

    // The username is escaped because ',' and '=' separate the attributes
    private val clientFirstBare =
        "n=${username.replace("=", "=3D").replace(",", "=2C")},r=$clientNonce"

    private var authMessage: String? = null
    private var saltedPassword: ByteArray? = null
    private var done = false

    /** The client-first message, sent once the server answers with "+" */
    fun first(): String = "n,,$clientFirstBare"

    /**
     * Answer a server message.
     *
     * Returns the next thing to send, or null when the exchange is over —
     * either because it finished or because the server failed to prove it knew
     * the password, which is not a thing to carry on from.
     */
    fun next(serverMessage: String): String? {
        if (done) return null

        return if (saltedPassword == null) clientFinal(serverMessage)
        else verify(serverMessage).let { null }
    }

    /** True once the server's signature has been checked and matched */
    var serverVerified = false
        private set

    private fun clientFinal(serverFirst: String): String? {
        val attributes = parse(serverFirst)
        val nonce = attributes["r"] ?: return abort()
        val salt = attributes["s"]?.let { Base64.getDecoder().decode(it) } ?: return abort()
        val iterations = attributes["i"]?.toIntOrNull() ?: return abort()

        // The server must extend our nonce, not replace it — otherwise this is
        // a different exchange than the one we started.
        if (!nonce.startsWith(clientNonce)) return abort()

        val withoutProof = "c=${Base64.getEncoder().encodeToString("n,,".toByteArray())},r=$nonce"
        val message = "$clientFirstBare,$serverFirst,$withoutProof"

        val salted = hi(password, salt, iterations)
        val clientKey = hmac(salted, "Client Key")
        val storedKey = MessageDigest.getInstance(digest).digest(clientKey)
        val clientSignature = hmac(storedKey, message)
        val proof = ByteArray(clientKey.size) { (clientKey[it].toInt() xor clientSignature[it].toInt()).toByte() }

        saltedPassword = salted
        authMessage = message

        return "$withoutProof,p=${Base64.getEncoder().encodeToString(proof)}"
    }

    private fun verify(serverFinal: String) {
        done = true
        val salted = saltedPassword ?: return
        val message = authMessage ?: return

        val signature = parse(serverFinal)["v"] ?: return
        val expected = hmac(hmac(salted, "Server Key"), message)

        serverVerified = MessageDigest.isEqual(
            expected,
            runCatching { Base64.getDecoder().decode(signature) }.getOrNull() ?: ByteArray(0)
        )
    }

    private fun abort(): String? {
        done = true
        return null
    }

    /** `a=1,b=2` into a map, keeping only the first of any repeated key */
    private fun parse(message: String): Map<String, String> =
        message.split(",").mapNotNull { part ->
            val key = part.substringBefore('=', "")
            if (key.length != 1) null else key to part.substringAfter('=', "")
        }.toMap()

    private fun hmac(key: ByteArray, data: String): ByteArray {
        val mac = Mac.getInstance(macName)
        mac.init(SecretKeySpec(key, macName))
        return mac.doFinal(data.toByteArray())
    }

    /** PBKDF2 as RFC 5802 spells it out: Hi(str, salt, i) */
    private fun hi(password: String, salt: ByteArray, iterations: Int): ByteArray {
        val mac = Mac.getInstance(macName)
        mac.init(SecretKeySpec(password.toByteArray(), macName))

        mac.update(salt)
        mac.update(byteArrayOf(0, 0, 0, 1))
        var u = mac.doFinal()
        val result = u.copyOf()

        for (round in 2..iterations) {
            u = mac.doFinal(u)
            for (i in result.indices) result[i] = (result[i].toInt() xor u[i].toInt()).toByte()
        }
        return result
    }
}
