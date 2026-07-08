package cr.marin.shellkeep.net.dto

import kotlinx.serialization.Serializable

/**
 * Standard `{ "data": ... }` envelope used by device-auth and storage endpoints.
 * Endpoints under `/api/sessions` return the bare model — do NOT wrap those.
 */
@Serializable
data class DataEnvelope<T>(val data: T)

@Serializable
data class PaginatedResponse<T>(
    val items: List<T>,
    val total: Int,
    val page: Int,
    val pageSize: Int,
    val totalPages: Int,
)
