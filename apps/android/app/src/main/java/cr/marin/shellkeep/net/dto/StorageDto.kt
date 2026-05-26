package cr.marin.shellkeep.net.dto

import kotlinx.serialization.Serializable

@Serializable
data class StorageObjectDto(
    val id: String,
    val status: String,
    val filename: String? = null,
    val mimeType: String? = null,
    val size: Long? = null,
    val createdAt: String? = null,
)

@Serializable
data class SignedDownloadUrlDto(
    val url: String,
    val expiresAt: String? = null,
    val expiresIn: Int? = null,
)
