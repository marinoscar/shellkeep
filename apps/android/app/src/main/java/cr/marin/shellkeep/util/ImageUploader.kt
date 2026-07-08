package cr.marin.shellkeep.util

import android.content.Context
import android.net.Uri
import cr.marin.shellkeep.net.ApiService
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Mirrors the web app's image-paste flow (apps/web/src/pages/TerminalPage.tsx:147-159):
 *
 *   1. Multipart POST to /api/storage/objects with the image bytes
 *   2. GET /api/storage/objects/{id}/download?expiresIn=3600 to obtain a
 *      signed URL valid for one hour
 *   3. The caller types the URL into the active terminal
 *
 * Returns the signed URL on success, or null on any failure (the caller
 * surfaces an error via snackbar). Pure suspend function, no Android UI.
 */
object ImageUploader {

    suspend fun uploadAndGetUrl(
        context: Context,
        service: ApiService,
        uri: Uri,
        expiresInSeconds: Int = 3600,
    ): String? {
        val contentResolver = context.contentResolver
        val mimeType = contentResolver.getType(uri) ?: "image/png"
        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        val extension = mimeType.substringAfter('/', "png").substringBefore(';').ifBlank { "png" }
        val filename = "clipboard-${System.currentTimeMillis()}.$extension"

        val part = MultipartBody.Part.createFormData(
            name = "file",
            filename = filename,
            body = bytes.toRequestBody(mimeType.toMediaTypeOrNull()),
        )

        val uploaded = service.uploadObject(part).data
        val signed = service.getDownloadUrl(uploaded.id, expiresInSeconds).data
        return signed.url
    }
}
