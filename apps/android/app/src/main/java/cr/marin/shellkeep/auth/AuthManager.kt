package cr.marin.shellkeep.auth

import android.os.Build
import cr.marin.shellkeep.net.ApiService
import cr.marin.shellkeep.net.dto.ClientInfo
import cr.marin.shellkeep.net.dto.DeviceCodeRequest
import cr.marin.shellkeep.net.dto.DeviceCodeResponse
import cr.marin.shellkeep.net.dto.DeviceTokenError
import cr.marin.shellkeep.net.dto.DeviceTokenRequest
import cr.marin.shellkeep.net.dto.DeviceTokenResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

/**
 * High-level façade for the device-authorization (RFC 8628) sign-in flow and
 * post-login token lifecycle. Sits on top of [TokenStore] and [ApiService].
 *
 * State exposed via [state]:
 *   Unknown        — initial; we have not yet checked the store
 *   Unauthenticated — no tokens, user must run the device flow
 *   Authenticated  — tokens present; access-token expiry is tracked but the
 *                    TokenAuthenticator does the actual refresh on 401
 */
class AuthManager(
    private val apiService: ApiService,
    private val tokenStore: TokenStore,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {

    private val _state = MutableStateFlow<AuthState>(AuthState.Unknown)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        _state.value = when (tokenStore.read()) {
            null -> AuthState.Unauthenticated
            else -> AuthState.Authenticated
        }
    }

    // -------------------------------------------------------------------------
    // Device flow
    // -------------------------------------------------------------------------

    /**
     * Kicks off device-code issuance. The returned [DeviceCodeResponse] holds
     * the user-facing code + verification URI to show on screen, and the
     * `deviceCode` + `interval` to feed back into [pollForToken].
     */
    suspend fun startDeviceFlow(deviceName: String = defaultDeviceName()): DeviceCodeResponse {
        val response = apiService.deviceCode(
            DeviceCodeRequest(
                clientInfo = ClientInfo(
                    deviceName = deviceName,
                    userAgent = "ShellKeepAndroid/${Build.VERSION.RELEASE}"
                )
            )
        )
        return response.data
    }

    /**
     * Polls `/api/auth/device/token` at the server-supplied [intervalSec],
     * respecting RFC 8628 errors:
     *   - `authorization_pending` → wait `interval` and retry
     *   - `slow_down`             → add 5 s to interval and retry
     *   - `expired_token`         → throw [DeviceCodeExpired]
     *   - `access_denied`         → throw [DeviceAccessDenied]
     *
     * Aborts (throws [DeviceCodeExpired]) after [expiresInSec] regardless.
     *
     * On success, tokens are persisted to [TokenStore] and the state flow
     * transitions to [AuthState.Authenticated] before this returns.
     */
    suspend fun pollForToken(
        deviceCode: String,
        intervalSec: Int,
        expiresInSec: Int,
    ): DeviceTokenResponse {
        val deadline = System.currentTimeMillis() + expiresInSec * 1000L
        var interval = intervalSec.coerceAtLeast(1)

        while (true) {
            if (System.currentTimeMillis() >= deadline) throw DeviceCodeExpired

            delay(interval * 1000L)

            val response = try {
                apiService.deviceToken(DeviceTokenRequest(deviceCode))
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                // Transient network error; back off one tick and retry.
                continue
            }

            if (response.isSuccessful) {
                val tokens = response.body()?.data ?: continue
                persist(tokens)
                _state.value = AuthState.Authenticated
                return tokens
            }

            val err = parseError(response.errorBody()?.string())
            when (err?.error) {
                DeviceTokenError.AUTHORIZATION_PENDING -> Unit // keep polling
                DeviceTokenError.SLOW_DOWN -> interval += 5
                DeviceTokenError.EXPIRED_TOKEN -> throw DeviceCodeExpired
                DeviceTokenError.ACCESS_DENIED -> throw DeviceAccessDenied
                else -> {
                    // Unknown error — treat like a transient failure but cap retries
                    // implicitly via the deadline check at the top of the loop.
                }
            }
        }
    }

    private fun persist(tokens: DeviceTokenResponse) {
        val expiresAt = System.currentTimeMillis() + tokens.expiresIn * 1000L
        tokenStore.write(
            TokenStore.Tokens(
                accessToken = tokens.accessToken,
                refreshToken = tokens.refreshToken,
                expiresAtEpochMs = expiresAt,
            )
        )
    }

    private fun parseError(body: String?): DeviceTokenError? {
        if (body.isNullOrBlank()) return null
        return try {
            json.decodeFromString(DeviceTokenError.serializer(), body)
        } catch (t: Throwable) {
            null
        }
    }

    // -------------------------------------------------------------------------
    // Logout
    // -------------------------------------------------------------------------

    /**
     * Revokes the current refresh token on the server (best-effort) and clears
     * local storage. Always transitions to Unauthenticated, even if the
     * server call fails (e.g. offline) — the user has decided to log out.
     */
    suspend fun logout() {
        try {
            apiService.logout()
        } catch (ce: CancellationException) {
            throw ce
        } catch (_: Throwable) {
            // Best-effort.
        }
        tokenStore.clear()
        _state.value = AuthState.Unauthenticated
    }

    /** Force-clear local tokens without touching the network. Used by the auth-failure callback. */
    fun forceUnauthenticate() {
        tokenStore.clear()
        _state.value = AuthState.Unauthenticated
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun defaultDeviceName(): String {
        val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        return "$manufacturer ${Build.MODEL}".take(64)
    }

    sealed interface AuthState {
        data object Unknown : AuthState
        data object Unauthenticated : AuthState
        data object Authenticated : AuthState
    }

    object DeviceCodeExpired : RuntimeException("Device code expired before user approved.")
    object DeviceAccessDenied : RuntimeException("User denied the device authorization request.")
}
