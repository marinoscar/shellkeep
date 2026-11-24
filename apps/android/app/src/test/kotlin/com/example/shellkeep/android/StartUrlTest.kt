package com.example.shellkeep.android

import org.junit.Assert.assertEquals
import org.junit.Test

/** The launcher icon opens the sessions list; a link to another page keeps its own path. */
class StartUrlTest {
    @Test fun `the root launch URL opens the sessions list and keeps the launch parameters`() {
        assertEquals(
            "https://app.example.com/sessions?source=twa&appVersion=1.2.3&appVersionCode=42",
            StartUrl.apply("https://app.example.com/?source=twa&appVersion=1.2.3&appVersionCode=42"),
        )
    }

    @Test fun `a server with a port and no trailing slash`() {
        assertEquals(
            "https://app.example.com:8443/sessions?source=twa",
            StartUrl.apply("https://app.example.com:8443?source=twa"),
        )
    }

    @Test fun `a link to another page keeps its path`() {
        val link = "https://app.example.com/servers/abc?source=twa&appVersion=1&appVersionCode=1"
        assertEquals(link, StartUrl.apply(link))
    }

    @Test fun `an unparseable value is returned unchanged`() {
        assertEquals("not a url", StartUrl.apply("not a url"))
    }
}
