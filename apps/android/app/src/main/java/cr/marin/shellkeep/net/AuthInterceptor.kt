package cr.marin.shellkeep.net

import cr.marin.shellkeep.auth.TokenStore
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Attaches `Authorization: Bearer <accessToken>` to every outbound request
 * unless the request is already authenticated (e.g. a refresh call) or
 * marked as public via the [SkipAuth] header.
 *
 * Add `Header(SkipAuth.HEADER, "1")` on Retrofit methods that must skip the
 * Bearer (e.g. /api/auth/device/code, /api/auth/device/token, /api/auth/refresh).
 */
class AuthInterceptor(private val tokenStore: TokenStore) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        if (original.header(SkipAuth.HEADER) != null) {
            // Strip the marker before sending; the server should not see it.
            val cleaned = original.newBuilder().removeHeader(SkipAuth.HEADER).build()
            return chain.proceed(cleaned)
        }
        if (original.header("Authorization") != null) {
            return chain.proceed(original)
        }
        val token = tokenStore.read()?.accessToken ?: return chain.proceed(original)
        val authed = original.newBuilder()
            .addHeader("Authorization", "Bearer $token")
            .build()
        return chain.proceed(authed)
    }
}

object SkipAuth {
    const val HEADER = "X-Skip-Auth"
}
