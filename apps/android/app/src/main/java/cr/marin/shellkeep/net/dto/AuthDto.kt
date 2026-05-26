package cr.marin.shellkeep.net.dto

import kotlinx.serialization.Serializable

/**
 * Body sent to the (cookie-less) `/api/auth/refresh` endpoint by non-browser
 * clients. Backend support landed in commit c71bcc6.
 */
@Serializable
data class RefreshTokenRequest(val refreshToken: String)

/**
 * Response shape returned by `/api/auth/refresh` when the refresh token was
 * supplied via JSON body (mobile/non-browser). The cookie-only browser path
 * returns a different shape that omits `refreshToken`; this DTO is not used
 * for that path.
 */
@Serializable
data class RefreshTokenResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

@Serializable
data class CurrentUserDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val profileImageUrl: String? = null,
    val roles: List<RoleDto> = emptyList(),
    val permissions: List<String> = emptyList(),
    val isActive: Boolean = true,
    val createdAt: String? = null,
)

@Serializable
data class RoleDto(val name: String)
