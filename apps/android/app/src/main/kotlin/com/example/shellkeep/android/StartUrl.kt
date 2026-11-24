package com.example.shellkeep.android

import java.net.URI

/**
 * ShellKeep opens on the sessions list, not the Home page: a phone user launches the app to get to
 * a terminal. The platform's launch URL is `${server}/?source=twa&appVersion=...&appVersionCode=...`;
 * this moves a bare root path to [START_PATH] and keeps every query parameter. A link to any other
 * page of the server (the launcher's https filter) keeps its own path.
 */
object StartUrl {
    const val START_PATH = "/sessions"

    fun apply(launchUrl: String): String {
        val uri = runCatching { URI(launchUrl) }.getOrNull() ?: return launchUrl
        val path = uri.rawPath
        if (!path.isNullOrEmpty() && path != "/") return launchUrl
        return runCatching {
            URI(uri.scheme, uri.authority, START_PATH, null, null).toString() +
                (uri.rawQuery?.let { "?$it" } ?: "") +
                (uri.rawFragment?.let { "#$it" } ?: "")
        }.getOrDefault(launchUrl)
    }
}
