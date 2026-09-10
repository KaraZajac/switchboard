package org.switchboard.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.Services

/**
 * Knowing NickServ when you see it.
 *
 * The lines are real ones, from the three services packages most of IRC runs.
 * Getting this wrong in the permissive direction costs a banner nobody needed;
 * getting it wrong the other way means a new user sits in a channel wondering
 * why their nick keeps being taken.
 */
class ServicesTest {

    @Test
    fun `the usual bots are recognised whatever case they are written in`() {
        assertTrue(Services.isServices("NickServ"))
        assertTrue(Services.isServices("nickserv"))
        assertTrue(Services.isServices("ChanServ"))
        assertTrue(Services.isServices("SaslServ"))
        assertTrue(Services.isServices("NickServ@services."))
    }

    @Test
    fun `an ordinary person is not a services bot`() {
        assertFalse(Services.isServices("robin"))
        assertFalse(Services.isServices("nickservant"))
        assertFalse(Services.isServices("servicedesk"))
    }

    @Test
    fun `atheme's prompt is recognised`() {
        assertTrue(
            Services.asksForIdentification(
                "This nickname is registered. Please choose a different nickname, or " +
                    "identify via /msg NickServ IDENTIFY <password>."
            )
        )
    }

    @Test
    fun `anope's prompt is recognised`() {
        assertTrue(
            Services.asksForIdentification(
                "This nick is registered. Please choose a different nick or identify " +
                    "via /msg NickServ IDENTIFY <password>"
            )
        )
    }

    @Test
    fun `a prompt phrased as instructions is recognised`() {
        assertTrue(
            Services.asksForIdentification(
                "You must identify to services with your password before you can use this nick."
            )
        )
    }

    @Test
    fun `an answer is not a prompt`() {
        assertFalse(Services.asksForIdentification("You are now identified for kara."))
        assertTrue(Services.confirmsIdentification("You are now identified for kara."))
        assertTrue(Services.confirmsIdentification("Password accepted - you are now recognized."))
    }

    @Test
    fun `ordinary services chatter is not a prompt`() {
        assertFalse(Services.asksForIdentification("Your memo has been sent."))
        assertFalse(Services.asksForIdentification("Channel #lobby is registered to robin."))
        assertFalse(Services.confirmsIdentification("Your memo has been sent."))
    }
}
