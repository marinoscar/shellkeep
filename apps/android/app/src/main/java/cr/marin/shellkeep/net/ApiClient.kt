package cr.marin.shellkeep.net

import android.content.Context
import cr.marin.shellkeep.BuildConfig
import cr.marin.shellkeep.auth.AuthManager
import cr.marin.shellkeep.auth.TokenStore
import cr.marin.shellkeep.terminal.SessionsManager
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

/**
 * Singleton entry point for HTTP + WebSocket clients.
 *
 * Hold one instance for the whole app — initialise once from
 * [ShellKeepApp.onCreate] (or lazily here). The OkHttpClient is intentionally
 * shared between Retrofit and the terminal WebSocket so they share the same
 * connection pool, DNS cache, and trust manager.
 */
class ApiClient private constructor(
    val baseUrl: String,
    val tokenStore: TokenStore,
    onAuthFailed: () -> Unit,
) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    /** Lazy because TokenAuthenticator needs to call back into ApiService.refresh(). */
    private lateinit var serviceRef: ApiService

    val okHttp: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS) // keeps the terminal WS alive
        .addInterceptor(AuthInterceptor(tokenStore))
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.HEADERS
                })
            }
        }
        .authenticator(
            TokenAuthenticator(
                tokenStore = tokenStore,
                apiServiceProvider = { serviceRef },
                onAuthFailed = onAuthFailed,
            )
        )
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
        .client(okHttp)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val service: ApiService = retrofit.create(ApiService::class.java).also {
        serviceRef = it
    }

    val authManager: AuthManager = AuthManager(service, tokenStore)

    val sessionsManager: SessionsManager = SessionsManager(
        okHttp = okHttp,
        baseUrl = baseUrl,
        tokenStore = tokenStore,
    )

    companion object {
        @Volatile
        private var instance: ApiClient? = null

        fun get(context: Context): ApiClient {
            val existing = instance
            if (existing != null) return existing
            return synchronized(this) {
                instance ?: run {
                    lateinit var built: ApiClient
                    built = ApiClient(
                        baseUrl = BuildConfig.DEFAULT_API_BASE_URL,
                        tokenStore = TokenStore(context.applicationContext),
                        // Forward auth failures (refresh permanently broken) to the AuthManager
                        // so the UI bounces back to the pairing screen.
                        onAuthFailed = { built.authManager.forceUnauthenticate() },
                    )
                    instance = built
                    built
                }
            }
        }
    }
}
