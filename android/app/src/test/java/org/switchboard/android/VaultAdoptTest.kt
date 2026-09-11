package org.switchboard.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.vault.VaultEnvelope
import org.switchboard.android.vault.VaultKdf
import org.switchboard.android.vault.shouldAdoptVault

/**
 * Pairing a phone that has already been opened once.
 *
 * The ordering rule has a corpus the desktop reads too; this pins the shape
 * that actually happened, because reading the rule on its own did not make it
 * obvious. A phone makes itself a config the first time it launches, so that
 * adding a server is not gated on owning a desktop. Both that config and a
 * freshly made desktop one are version 1 — and a phone is always set up after
 * the desktop it pairs to, so the phone's was always the later of the two.
 *
 * The tiebreak therefore handed it to the phone, every time. Pairing reported
 * success, the phone followed the desktop perfectly well, and the shared
 * config silently never arrived — so the one thing it exists for, the phone
 * taking over when the desktop stops, could not happen. Nothing said so: the
 * phone's own config counts as unlocked, so not one of the banners that would
 * have told somebody fired.
 *
 * The timestamps below are the ones off the two devices the day this was found.
 */
class VaultAdoptTest {

    private fun envelope(version: Int, updatedAt: String, by: String) = VaultEnvelope(
        format = 1,
        kdf = VaultKdf(name = "pbkdf2-sha256", iterations = 1000, salt = "c2FsdA=="),
        iv = "aXYtdHdlbHZlLQ==",
        ciphertext = "",
        tag = "",
        version = version,
        updatedAt = updatedAt,
        updatedBy = by
    )

    private val desktop = envelope(1, "2026-09-10T23:40:34.393Z", "desktop")
    private val phone = envelope(1, "2026-09-10T23:40:50.580Z", "phone")

    @Test
    fun `a phone opened before pairing still takes the desktop's config`() {
        assertTrue(shouldAdoptVault(desktop, phone, currentIsPlaceholder = true))
    }

    @Test
    fun `without the flag the phone's own empty config wins, which was the bug`() {
        assertFalse(shouldAdoptVault(desktop, phone, currentIsPlaceholder = false))
    }

    /**
     * The protection that has to survive the fix.
     *
     * A phone that has a config somebody chose must not be talked out of it by
     * an older one — that is how a password the user has already changed comes
     * back.
     */
    @Test
    fun `a config somebody chose is not given up for an older one`() {
        val older = envelope(3, "2026-09-10T23:59:00.000Z", "desktop")
        val ours = envelope(7, "2026-09-10T05:00:00.000Z", "phone")
        assertFalse(shouldAdoptVault(older, ours, currentIsPlaceholder = false))
    }

    /**
     * A placeholder has nothing in it, so there is nothing to roll back, and
     * it yields to anything at all.
     */
    @Test
    fun `a placeholder yields even to an older config`() {
        val older = envelope(3, "2026-09-10T23:59:00.000Z", "desktop")
        val ours = envelope(7, "2026-09-10T05:00:00.000Z", "phone")
        assertTrue(shouldAdoptVault(older, ours, currentIsPlaceholder = true))
    }

    /**
     * A peer on an older build sends a version and no timestamp. The rule then
     * has nothing to compare and falls back to versions alone — which is
     * exactly what that peer itself does, so the two still agree.
     */
    @Test
    fun `an offer with no timestamp is settled on version alone`() {
        val ours = envelope(4, "2026-09-10T05:00:00.000Z", "phone")
        assertTrue(shouldAdoptVault(envelope(5, "", "desktop"), ours))
        assertFalse(shouldAdoptVault(envelope(4, "", "desktop"), ours))
        assertFalse(shouldAdoptVault(envelope(3, "", "desktop"), ours))
    }
}
