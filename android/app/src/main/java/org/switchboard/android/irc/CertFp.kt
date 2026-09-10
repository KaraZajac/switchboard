package org.switchboard.android.irc

import java.io.ByteArrayInputStream
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory

/**
 * Logging in with a certificate instead of a password.
 *
 * The Kotlin half of `src/shared/certfp.ts`, checked against
 * `tests/fixtures/certfp.json`. SASL EXTERNAL is the one mechanism where
 * nothing secret crosses the wire at all: the TLS handshake has already proved
 * who you are, and the server looks up the fingerprint of the certificate you
 * presented. Both clients implemented the mechanism and neither had anywhere to
 * put a certificate, so the handshake presented none.
 */
object CertFp {

    /** A certificate and its key, as the two PEM blocks a connection needs */
    data class Identity(val certificate: String, val privateKey: String)

    private val BLOCK =
        Regex("-----BEGIN ([A-Z0-9 ]+)-----\\r?\\n([\\s\\S]*?)-----END \\1-----")

    /**
     * Pull the certificate and key out of whatever was pasted.
     *
     * Order is not assumed — a key is whichever block says it is a key —
     * because openssl writes the two in either order and getting it wrong
     * would be silent.
     */
    fun read(pem: String?): Identity? {
        if (pem.isNullOrEmpty()) return null

        var certificate: String? = null
        var privateKey: String? = null

        for (match in BLOCK.findAll(pem)) {
            val label = match.groupValues[1]
            when {
                label == "CERTIFICATE" && certificate == null -> certificate = match.value
                label.endsWith("PRIVATE KEY") && privateKey == null -> privateKey = match.value
            }
        }

        val cert = certificate ?: return null
        val key = privateKey ?: return null
        return Identity(cert, key)
    }

    /** What is wrong with what was pasted, in a sentence someone can act on */
    fun problem(pem: String?): String? {
        if (pem.isNullOrBlank()) return null

        val labels = BLOCK.findAll(pem).map { it.groupValues[1] }.toList()
        return when {
            labels.isEmpty() ->
                "That does not look like a PEM file — it should have -----BEGIN lines in it."
            !labels.contains("CERTIFICATE") ->
                "That has a key in it but no certificate. Both belong in the same box."
            labels.none { it.endsWith("PRIVATE KEY") } ->
                "That has a certificate in it but no private key. Both belong in the same box."
            // PKCS#1. Java reads PKCS#8, which is what openssl writes by default
            labels.contains("RSA PRIVATE KEY") ->
                "That key is in the older format. Convert it with: " +
                    "openssl pkcs8 -topk8 -nocrypt -in key.pem -out key8.pem"
            else -> null
        }
    }

    /** The certificate's base64 body, which is the DER a fingerprint is taken of */
    fun body(certificate: String): String = certificate
        .replace("-----BEGIN CERTIFICATE-----", "")
        .replace("-----END CERTIFICATE-----", "")
        .replace(Regex("\\s+"), "")

    /**
     * The fingerprint a network's services want, lowercase hex.
     *
     * The string that goes to `NickServ CERT ADD`. Working it out is most of
     * why nobody uses CertFP.
     */
    fun fingerprint(pem: String?): String? {
        val identity = read(pem) ?: return null
        val der = runCatching { Base64.getDecoder().decode(body(identity.certificate)) }
            .getOrNull() ?: return null

        return MessageDigest.getInstance("SHA-256").digest(der)
            .joinToString("") { "%02x".format(it) }
    }

    /**
     * A socket factory that presents this certificate.
     *
     * Null when there is nothing to present, or when what was pasted cannot be
     * read — in which case the connection goes ahead without one rather than
     * failing to happen at all, and SASL EXTERNAL reports the refusal itself.
     */
    fun socketFactory(pem: String?): SSLSocketFactory? {
        val identity = read(pem) ?: return null

        return runCatching {
            val certificate = CertificateFactory.getInstance("X.509")
                .generateCertificate(
                    ByteArrayInputStream(Base64.getDecoder().decode(body(identity.certificate)))
                ) as X509Certificate

            val keyBytes = Base64.getDecoder().decode(
                identity.privateKey
                    .replace(Regex("-----(BEGIN|END) [A-Z0-9 ]+-----"), "")
                    .replace(Regex("\\s+"), "")
            )

            // RSA or EC: whichever the key actually is. Asking the wrong one
            // throws, and a certificate people generate today is as likely to
            // be either.
            val key = listOf("RSA", "EC")
                .firstNotNullOfOrNull { algorithm ->
                    runCatching {
                        KeyFactory.getInstance(algorithm)
                            .generatePrivate(PKCS8EncodedKeySpec(keyBytes))
                    }.getOrNull()
                } ?: return null

            val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
                load(null, null)
                setKeyEntry("switchboard", key, CHARS, arrayOf(certificate))
            }

            val managers = KeyManagerFactory
                .getInstance(KeyManagerFactory.getDefaultAlgorithm())
                .apply { init(store, CHARS) }

            SSLContext.getInstance("TLS")
                .apply { init(managers.keyManagers, null, null) }
                .socketFactory
        }.getOrNull()
    }

    /**
     * The in-memory keystore's password.
     *
     * It never leaves this process and never reaches a disk: the KeyStore API
     * requires one, and there is nothing for it to protect.
     */
    private val CHARS = CharArray(0)
}
