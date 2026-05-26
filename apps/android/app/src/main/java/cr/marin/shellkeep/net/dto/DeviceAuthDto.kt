package cr.marin.shellkeep.net.dto

import kotlinx.serialization.Serializable

@Serializable
data class ClientInfo(
    val deviceName: String? = null,
    val userAgent: String? = null,
)

@Serializable
data class DeviceCodeRequest(
    val clientInfo: ClientInfo? = null,
)

@Serializable
data class DeviceCodeResponse(
    val deviceCode: String,
    val userCode: String,
    val verificationUri: String,
    val verificationUriComplete: String,
    val expiresIn: Int,
    val interval: Int,
)

@Serializable
data class DeviceTokenRequest(val deviceCode: String)

@Serializable
data class DeviceTokenResponse(
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String,
    val expiresIn: Int,
)

/**
 * RFC 8628 error body returned with HTTP 400 while a device is still pending,
 * polling too fast, or after expiry / denial.
 */
@Serializable
data class DeviceTokenError(
    val error: String,
    val error_description: String? = null,
) {
    companion object {
        const val AUTHORIZATION_PENDING = "authorization_pending"
        const val SLOW_DOWN = "slow_down"
        const val EXPIRED_TOKEN = "expired_token"
        const val ACCESS_DENIED = "access_denied"
    }
}
