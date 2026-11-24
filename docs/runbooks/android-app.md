# Runbook: Ship the Android app

> **Audience:** administrators and the developer who builds the app · **Pages and routes:** `/admin/settings/android`, `/api/admin/android-app/*`, `/.well-known/assetlinks.json` · **Permission:** `system_settings:read` and `system_settings:write` · **Added by:** #74

The Android app is a Trusted Web Activity (TWA) around the ShellKeep web app (`apps/android`, a Kotlin shell on the platform's `:platform-core`). Chrome opens the site full screen, without a URL bar, only when the installed APK's package name and signing certificate appear in `/.well-known/assetlinks.json`. ShellKeep hosts the signed APK, offers updates inside the TWA, and pushes to the phone over the `android_app` notification channel. The existing Android MVP issue (29) decides any native scope; this runbook covers the platform half only.

## 1. What an operator must supply

| Item | Why | Where it lives |
|---|---|---|
| The real package id | `identity.json` ships `com.example.shellkeep` as a placeholder | `android.applicationId` in `packages/shared/identity.json`; change it **before the first signed release**, because a package id and its signing key are the app's identity forever |
| A release keystore | Signs the APK; losing it means installed apps can never update | `shellkeep android keystore init` creates it under `~/.shellkeep/android/` (mode 600); never commit it |
| The signing certificate's SHA-256 | What Chrome compares to `assetlinks.json` | `shellkeep android keystore show`; trusted through the admin page or `android publish --trust` |
| Object storage | APKs are stored under `android-releases/` | `/admin/settings/storage` (an upload without it is `503 STORAGE_NOT_CONFIGURED`) |
| Web Push (VAPID) keys | The `android_app` channel is Web Push to the app's subscriptions | `/admin/settings/push` |
| A phone | The TWA, the keyboard and the push cannot be proven on a server | See [§6](#6-what-only-a-device-can-prove) |

## 2. Trust the app

1. Sign in as an administrator and open **Admin > Android app** (`/admin/settings/android`).
2. Add the package name and the SHA-256 certificate fingerprint of the keystore. Saving audits `android_app.trusted_apps.updated`.
3. Check it: `curl -s https://<your host>/.well-known/assetlinks.json` returns the list (an empty array before step 2). The path is public and answers during maintenance. The Doctor check `android.assetlinks` grades the same thing.

If the TWA shows a URL bar, the installed app's pair is not trusted, or nginx does not map the path (`infra/nginx/app.d/locations/android-app.conf` includes the platform snippet).

## 3. Build and publish

Needs JDK 17+ and the Android SDK on your machine (not in CI, not in the API container). From a checkout:

```bash
shellkeep android doctor            # checks the JDK, SDK, keystore, version and the server
shellkeep login --server https://<your host>
shellkeep android release --bump patch --notes "What changed"
```

`release` bumps `apps/android/version.properties`, builds and signs the APK into `dist/android/`, uploads it to `POST /api/admin/android-app/releases` (150 MiB, streamed, never buffered) and commits `version.properties` only after the upload succeeded. A new signing key needs `--trust` once the list is non-empty. `shellkeep android releases` lists them and makes one current (a rollback).

On a deploy, `SHELLKEEP_DEPLOY_ANDROID=1 shellkeep deploy update` runs the same build and publish after `verify`. Without the variable the step is skipped, and a failure never fails the deploy.

## 4. Install and update

A signed-in user gets a 10-minute download link from the admin page or `POST /api/android-app/releases/:id/download-link`. The link is HMAC-signed under a sub-key of `SECRETS_ENCRYPTION_KEY` and bound to the user. Inside the TWA, the update banner appears when the installed `versionCode` is older than `GET /api/android-app/releases/latest`.

## 5. Test the push

On the admin page choose **Send test notification**. The result reports counts per outcome (sent, failed, no subscription); the endpoint itself is never shown. The notification lands on `/sessions`.

## 6. What only a device can prove

- The TWA opens without a URL bar once the certificate is trusted and the package is installed from the hosted APK.
- Web Push reaches the phone after notification permission is granted inside the TWA (Android 13 asks for `POST_NOTIFICATIONS`).
- The terminal's key-shortcut bar and keyboard inset behave in the TWA: [SCROLLING.md](../SCROLLING.md#terminal-in-the-android-twa).

## 7. Roll back

Make the previous release current (`shellkeep android releases current <id>`), or delete a bad one on the admin page. To remove the feature, revert the change: the migration stays installed and its tables are inert without the module. `npm run storage:purge` removes stored APKs.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Upload `409 RELEASE_UNTRUSTED_APP` | New package or signing key | Trust it first, or upload with `trust=true` |
| Upload `409 RELEASE_VERSION_NOT_NEWER` | `versionCode` did not rise | `shellkeep android version --bump patch`, rebuild |
| Download `410 DOWNLOAD_LINK_EXPIRED` | Link older than 10 minutes | Request a new one |
| `android.releases` Doctor check warns | No current release, or storage not configured | Publish one, configure storage |
