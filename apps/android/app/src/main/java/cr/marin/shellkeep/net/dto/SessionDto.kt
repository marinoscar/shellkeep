package cr.marin.shellkeep.net.dto

import kotlinx.serialization.Serializable

@Serializable
data class TerminalSessionDto(
    val id: String,
    val userId: String,
    val serverProfileId: String,
    val name: String,
    val status: String, // "active" | "detached" | "terminated"
    val tmuxSessionId: String,
    val cols: Int,
    val rows: Int,
    val lastActivityAt: String? = null,
    val terminatedAt: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val serverProfile: EmbeddedServerProfile? = null,
)

@Serializable
data class EmbeddedServerProfile(
    val name: String,
    val hostname: String,
    val port: Int,
    val username: String,
    val color: String? = null,
)

@Serializable
data class CreateSessionRequest(
    val serverProfileId: String,
    val name: String? = null,
)

@Serializable
data class UpdateSessionRequest(val name: String)
