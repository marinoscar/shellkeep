package cr.marin.shellkeep.net.dto

import kotlinx.serialization.Serializable

@Serializable
data class ServerProfileDto(
    val id: String,
    val name: String,
    val hostname: String,
    val port: Int,
    val username: String,
    val authMethod: String, // "password" | "key" | "agent"
    val color: String? = null,
    val tags: List<String> = emptyList(),
    val fingerprint: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)
