package cr.marin.shellkeep.net

import cr.marin.shellkeep.net.dto.CreateSessionRequest
import cr.marin.shellkeep.net.dto.CurrentUserDto
import cr.marin.shellkeep.net.dto.DataEnvelope
import cr.marin.shellkeep.net.dto.DeviceCodeRequest
import cr.marin.shellkeep.net.dto.DeviceCodeResponse
import cr.marin.shellkeep.net.dto.DeviceTokenRequest
import cr.marin.shellkeep.net.dto.DeviceTokenResponse
import cr.marin.shellkeep.net.dto.PaginatedResponse
import cr.marin.shellkeep.net.dto.RefreshTokenRequest
import cr.marin.shellkeep.net.dto.RefreshTokenResponse
import cr.marin.shellkeep.net.dto.ServerProfileDto
import cr.marin.shellkeep.net.dto.SignedDownloadUrlDto
import cr.marin.shellkeep.net.dto.StorageObjectDto
import cr.marin.shellkeep.net.dto.TerminalSessionDto
import cr.marin.shellkeep.net.dto.UpdateSessionRequest
import cr.marin.shellkeep.net.dto.UserSettingsDto
import okhttp3.MultipartBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {

    // -------------------------------------------------------------------------
    // Device auth (RFC 8628) — Public endpoints (no Bearer required)
    // -------------------------------------------------------------------------

    @POST("api/auth/device/code")
    suspend fun deviceCode(@Body body: DeviceCodeRequest): DataEnvelope<DeviceCodeResponse>

    /**
     * Returns raw Response so callers can inspect 200 vs 400 + error body
     * (`authorization_pending`, `slow_down`, `expired_token`, `access_denied`).
     */
    @POST("api/auth/device/token")
    suspend fun deviceToken(@Body body: DeviceTokenRequest): Response<DataEnvelope<DeviceTokenResponse>>

    @DELETE("api/auth/device/sessions/{id}")
    suspend fun revokeDeviceSession(@Path("id") id: String): Response<Unit>

    // -------------------------------------------------------------------------
    // Auth — Public refresh; authenticated me + logout
    // -------------------------------------------------------------------------

    @POST("api/auth/refresh")
    suspend fun refresh(@Body body: RefreshTokenRequest): RefreshTokenResponse

    @GET("api/auth/me")
    suspend fun me(): DataEnvelope<CurrentUserDto>

    @POST("api/auth/logout")
    suspend fun logout(): Response<Unit>

    // -------------------------------------------------------------------------
    // Terminal sessions — bare responses (no { data } envelope per controller)
    // -------------------------------------------------------------------------

    @GET("api/sessions")
    suspend fun listSessions(
        @Query("page") page: Int? = null,
        @Query("pageSize") pageSize: Int? = null,
        @Query("status") status: String? = null,
    ): PaginatedResponse<TerminalSessionDto>

    @GET("api/sessions/{id}")
    suspend fun getSession(@Path("id") id: String): TerminalSessionDto

    @POST("api/sessions")
    suspend fun createSession(@Body body: CreateSessionRequest): TerminalSessionDto

    @PATCH("api/sessions/{id}")
    suspend fun renameSession(
        @Path("id") id: String,
        @Body body: UpdateSessionRequest,
    ): TerminalSessionDto

    @DELETE("api/sessions/{id}")
    suspend fun deleteSession(@Path("id") id: String): Response<Unit>

    // -------------------------------------------------------------------------
    // Server profiles — needed for the new-session picker
    // -------------------------------------------------------------------------

    @GET("api/server-profiles")
    suspend fun listServerProfiles(
        @Query("page") page: Int? = null,
        @Query("pageSize") pageSize: Int? = null,
    ): PaginatedResponse<ServerProfileDto>

    // -------------------------------------------------------------------------
    // Storage — image paste flow
    // -------------------------------------------------------------------------

    @Multipart
    @POST("api/storage/objects")
    suspend fun uploadObject(
        @Part file: MultipartBody.Part,
    ): DataEnvelope<StorageObjectDto>

    @GET("api/storage/objects/{id}/download")
    suspend fun getDownloadUrl(
        @Path("id") id: String,
        @Query("expiresIn") expiresInSeconds: Int = 3600,
    ): DataEnvelope<SignedDownloadUrlDto>

    // -------------------------------------------------------------------------
    // User settings — If-Match for optimistic concurrency on PATCH
    // -------------------------------------------------------------------------

    @GET("api/user-settings")
    suspend fun getUserSettings(): DataEnvelope<UserSettingsDto>

    @PATCH("api/user-settings")
    suspend fun patchUserSettings(
        @Header("If-Match") versionMatch: String,
        @Body body: UserSettingsDto,
    ): DataEnvelope<UserSettingsDto>
}
