package com.example.shellkeep.android

import android.net.Uri
import io.github.marinoscar.platform.android.core.twa.TwaLauncher

/**
 * The launcher: everything comes from the platform's [TwaLauncher] (launch URL with
 * `?source=twa&appVersion=…&appVersionCode=…`, incoming https links on the server's host, the
 * setup screen while no server is configured). The only difference is the start page: the launcher
 * icon opens `/sessions` ([StartUrl]). There is no JavaScript bridge.
 */
class TwaLauncherActivity : TwaLauncher() {
    override fun setupActivity() = SetupActivity::class.java

    override fun getLaunchingUrl(): Uri = Uri.parse(StartUrl.apply(super.getLaunchingUrl().toString()))
}
