package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.Scram

/**
 * SCRAM, against the vector the RFC prints.
 *
 * The exchange is four HMACs and an XOR in a particular order, and getting any
 * of them slightly wrong fails in exactly one way: the server says 904 and the
 * user is told their password is wrong. `tests/main/scram.test.ts` checks the
 * desktop against the same numbers, which is what makes two implementations of
 * the same handshake worth having.
 */
class ScramTest {

    private val serverFirst =
        "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF\$k0," +
            "s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096"

    @Test
    fun `computes the client proof RFC 7677 prints`() {
        val scram = Scram("user", "pencil", "SCRAM-SHA-256", nonce = "rOprNGfwEbeRWgbNEkqO")

        assertEquals("n,,n=user,r=rOprNGfwEbeRWgbNEkqO", scram.first())

        val clientFinal = scram.next(serverFirst)
        assertEquals(
            "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF\$k0," +
                "p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
            clientFinal
        )
    }

    @Test
    fun `accepts the server signature RFC 7677 prints, and refuses any other`() {
        val good = Scram("user", "pencil", "SCRAM-SHA-256", nonce = "rOprNGfwEbeRWgbNEkqO")
        good.first()
        good.next(serverFirst)
        assertNull(
            "a verified exchange has nothing left to send",
            good.next("v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=")
        )
        assertTrue("and it says so", good.serverVerified)

        // SCRAM proves both sides knew the password. This is the half that was
        // computed and thrown away, so a server that could not prove it was
        // treated exactly like one that could.
        val bad = Scram("user", "pencil", "SCRAM-SHA-256", nonce = "rOprNGfwEbeRWgbNEkqO")
        bad.first()
        bad.next(serverFirst)
        assertNull(bad.next("v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="))
        assertFalse("a server that did not know the password is not verified", bad.serverVerified)
    }

    @Test
    fun `refuses a server that did not echo our nonce`() {
        val scram = Scram("user", "pencil", "SCRAM-SHA-256", nonce = "rOprNGfwEbeRWgbNEkqO")
        scram.first()
        assertNull(
            "an exchange we did not start is not one to answer",
            scram.next("r=somebodyelsesnonce,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096")
        )
        assertFalse(scram.serverVerified)
    }

    @Test
    fun `SHA-512 is the same exchange with a longer proof`() {
        val scram = Scram("user", "pencil", "SCRAM-SHA-512", nonce = "rOprNGfwEbeRWgbNEkqO")
        scram.first()
        val clientFinal = scram.next(serverFirst)
        assertNotNull(clientFinal)

        val proof = clientFinal!!.substringAfter("p=")
        // 64 bytes of proof, base64
        assertEquals(88, proof.length)
    }
}
