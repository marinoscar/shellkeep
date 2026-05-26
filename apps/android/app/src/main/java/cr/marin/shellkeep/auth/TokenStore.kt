package cr.marin.shellkeep.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted persistence of access + refresh tokens, backed by Android Keystore.
 *
 * Backed by [EncryptedSharedPreferences] with [MasterKey.KeyScheme.AES256_GCM].
 * On API 26+ the master key lives in the hardware-backed Keystore; below that
 * (we don't ship below minSdk 26) it would fall back to software-backed AES.
 *
 * Thread-safe: all access goes through synchronized accessors on the
 * underlying SharedPreferences which is itself thread-safe.
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun read(): Tokens? {
        val access = prefs.getString(KEY_ACCESS, null) ?: return null
        val refresh = prefs.getString(KEY_REFRESH, null) ?: return null
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        return Tokens(access, refresh, expiresAt)
    }

    fun write(tokens: Tokens) {
        prefs.edit()
            .putString(KEY_ACCESS, tokens.accessToken)
            .putString(KEY_REFRESH, tokens.refreshToken)
            .putLong(KEY_EXPIRES_AT, tokens.expiresAtEpochMs)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    data class Tokens(
        val accessToken: String,
        val refreshToken: String,
        /** Milliseconds since epoch at which the access token expires. */
        val expiresAtEpochMs: Long,
    )

    companion object {
        private const val FILE_NAME = "shellkeep_tokens"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_EXPIRES_AT = "expires_at"
    }
}
