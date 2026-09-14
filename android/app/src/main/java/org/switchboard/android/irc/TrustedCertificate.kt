package org.switchboard.android.irc

import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager

/**
 * A server's certificate, when nobody vouches for it.
 *
 * The Kotlin half of `src/shared/certificate.ts`, checked against
 * `tests/fixtures/certificate.json`. A private network runs on a certificate
 * no root store has heard of, and the phone refused it flat. The answer is
 * SSH's: show the fingerprint, let the user say yes to that one certificate,
 * and remember the choice on the server's config — where the desktop reads
 * it too.
 */
object TrustedCertificate {

    /** Hex pairs joined by colons, upper case — the way OpenSSL prints one */
    fun format(raw: String): String {
        val hex = raw.filter { it.isDigit() || it.lowercaseChar() in 'a'..'f' }.uppercase()
        return hex.chunked(2).joinToString(":")
    }

    /** Whether two spellings name the same certificate */
    fun same(a: String?, b: String?): Boolean {
        if (a.isNullOrEmpty() || b.isNullOrEmpty()) return false
        val left = format(a)
        return left.isNotEmpty() && left == format(b)
    }

    fun fingerprintOf(certificate: X509Certificate): String =
        format(MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02x".format(it) })

    /**
     * The system's own trust manager, wrapped: everything it accepts is
     * accepted, and what it refuses is accepted too when it is the one
     * certificate the user chose — and refused with the fingerprint attached
     * otherwise, so the refusal can be turned into an offer.
     *
     * Hostname checking stays with the system's manager, which does it when
     * the socket asks for it; a pinned certificate is trusted whatever name
     * it carries, since the pin *is* the identity.
     */
    fun trustManager(trusted: String?): X509ExtendedTrustManager {
        val system = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(null as KeyStore?) }
            .trustManagers
            .filterIsInstance<X509ExtendedTrustManager>()
            .first()
        return Pinning(trusted, system)
    }

    private class Pinning(
        private val trusted: String?,
        private val system: X509ExtendedTrustManager
    ) : X509ExtendedTrustManager() {

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
            verify(chain) { system.checkServerTrusted(chain, authType, socket) }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
            verify(chain) { system.checkServerTrusted(chain, authType, engine) }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
            verify(chain) { system.checkServerTrusted(chain, authType) }

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
            system.checkClientTrusted(chain, authType, socket)

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
            system.checkClientTrusted(chain, authType, engine)

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
            system.checkClientTrusted(chain, authType)

        override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers

        private fun verify(chain: Array<X509Certificate>, check: () -> Unit) {
            try {
                check()
            } catch (refusal: CertificateException) {
                val leaf = chain.firstOrNull() ?: throw refusal
                val fingerprint = fingerprintOf(leaf)
                if (same(trusted, fingerprint)) return
                throw UntrustedCertificate(
                    fingerprint = fingerprint,
                    subject = leaf.subjectX500Principal?.name?.substringAfter("CN=")?.substringBefore(","),
                    issuer = leaf.issuerX500Principal?.name?.substringAfter("CN=")?.substringBefore(","),
                    validTo = leaf.notAfter?.toInstant()?.toString(),
                    reason = refusal.message ?: "The certificate was refused",
                    cause = refusal
                )
            }
        }
    }
}

/** A refusal with the one thing the user can check attached */
class UntrustedCertificate(
    val fingerprint: String,
    val subject: String?,
    val issuer: String?,
    val validTo: String?,
    val reason: String,
    cause: Throwable
) : CertificateException(reason, cause)
