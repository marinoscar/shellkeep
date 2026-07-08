# ShellKeep Android

Native Android client for ShellKeep — terminal sessions, multi-session tabs, native virtual key bar, copy/paste, image paste.

## Prerequisites

- JDK 17
- Android SDK with platform 35 + build-tools 35.0.0
- Gradle 8.10 or newer **on PATH** (or use Android Studio's bundled Gradle)

A Gradle wrapper jar is intentionally not committed. Generate one yourself the first time:

```bash
cd apps/android
gradle wrapper --gradle-version 8.10
```

After that, all subsequent commands use `./gradlew`.

## Build

```bash
cd apps/android
./gradlew :app:assembleDebug          # debug APK -> app/build/outputs/apk/debug/
./gradlew :app:assembleRelease        # signed release (requires env vars below)
./gradlew :app:lint :app:test         # static analysis + unit tests
```

## Signing (release)

The release build pulls signing material from env vars so CI can supply a keystore without committing secrets:

| Variable                    | Description                              |
|----------------------------|------------------------------------------|
| `ANDROID_KEYSTORE_PATH`     | Absolute path to the `.jks` keystore     |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password                        |
| `ANDROID_KEY_ALIAS`         | Key alias inside the keystore            |
| `ANDROID_KEY_PASSWORD`      | Key password                             |

If `ANDROID_KEYSTORE_PATH` is unset the release build is left unsigned (useful locally).

## API base URL

Compiled in via `BuildConfig.DEFAULT_API_BASE_URL`, defaults to `https://shellkeep.dev.marin.cr`. The app's settings screen lets the user override it at runtime.

## Install (sideload)

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or upload the signed release APK to a phone's downloads folder and tap it (allow "Install unknown apps" for the browser/file manager once).

## License

The terminal rendering (planned) uses Termux's `terminal-emulator` / `terminal-view` libraries, which are GPL-3.0. This Android client is therefore distributed under GPL-3.0. The server and web tiers in this repository are unaffected — GPL is triggered by distribution of the Android binary, not by the server's network use.
