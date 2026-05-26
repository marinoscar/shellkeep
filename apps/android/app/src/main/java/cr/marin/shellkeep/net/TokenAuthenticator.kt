package cr.marin.shellkeep.net

import cr.marin.shellkeep.auth.TokenStore
import cr.marin.shellkeep.net.dto.RefreshTokenRequest
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Handles 401 responses by attempting exactly one body-based refresh against
 * `/api/auth/refresh` (see commit c71bcc6 for the mobile path). On success
 * the failing request is replayed with the new access token; on failure the
 * tokens are cleared and the original 401 surfaces to the caller.
 *
 * Refresh is serialised with a lock so concurrent 401s do not all attempt
 * to rotate the refresh token (which would invalidate each other under
 * the backend's rotation-and-reuse-detection policy).
 */
class TokenAuthenticator(
    private val tokenStore: TokenStore,
    private val apiServiceProvider: () -> ApiService,
    private val onAuthFailed: () -> Unit = {},
) : Authenticator {

    private val refreshLock = ReentrantLock()

    override fun authenticate(route: Route?, response: Response): Request? {
        // Do not loop on a refresh call that itself returned 401.
        if (response.request.url.encodedPath.endsWith("/api/auth/refresh")) {
            return null
        }
        // Prevent more than ~2 retries on the same request.
        if (priorRetryCount(response) >= 1) {
            return null
        }

        val currentToken = tokenStore.read() ?: return null

        // If another thread already refreshed since this request was sent, just
        // use the new token without making another refresh call.
        val staleAccess = bearerOf(response.request)
        val freshAccess = tokenStore.read()?.accessToken
        if (staleAccess != null && freshAccess != null && staleAccess != freshAccess) {
            return response.request.newBuilder()
                .header("Authorization", "Bearer $freshAccess")
                .build()
        }

        return refreshLock.withLock {
            // Re-check inside the lock.
            val latest = tokenStore.read() ?: return@withLock null
            val latestAccess = latest.accessToken
            if (staleAccess != null && staleAccess != latestAccess) {
                return@withLock response.request.newBuilder()
                    .header("Authorization", "Bearer $latestAccess")
                    .build()
            }
            try {
                val refreshed = runBlocking {
                    apiServiceProvider().refresh(RefreshTokenRequest(latest.refreshToken))
                }
                val expiresAt = System.currentTimeMillis() + refreshed.expiresIn * 1000L
                tokenStore.write(
                    TokenStore.Tokens(
                        accessToken = refreshed.accessToken,
                        refreshToken = refreshed.refreshToken,
                        expiresAtEpochMs = expiresAt,
                    )
                )
                response.request.newBuilder()
                    .header("Authorization", "Bearer ${refreshed.accessToken}")
                    .build()
            } catch (t: Throwable) {
                tokenStore.clear()
                onAuthFailed()
                null
            }
        }
    }

    private fun priorRetryCount(response: Response): Int {
        var prior = 0
        var r: Response? = response.priorResponse
        while (r != null) {
            prior++
            r = r.priorResponse
        }
        return prior
    }

    private fun bearerOf(request: Request): String? =
        request.header("Authorization")?.removePrefix("Bearer ")
}
