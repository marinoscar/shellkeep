package cr.marin.shellkeep.util

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.core.content.ContextCompat

/**
 * Thin wrapper around [ClipboardManager] for the terminal copy/paste paths.
 *
 * Image clipboard items aren't handled here — those go through the
 * platform image picker (PickVisualMedia) and then [ImageUploader] in the
 * Compose layer, matching how apps/web/src/pages/TerminalPage.tsx handles
 * pasted images.
 */
object Clipboard {

    /** Read the current system clipboard as plain text, or null if it's empty / not text. */
    fun readText(context: Context): String? {
        val mgr = ContextCompat.getSystemService(context, ClipboardManager::class.java) ?: return null
        val clip = mgr.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        val text = clip.getItemAt(0)?.coerceToText(context)?.toString()
        return if (text.isNullOrEmpty()) null else text
    }

    fun writeText(context: Context, text: String, label: String = "ShellKeep") {
        val mgr = ContextCompat.getSystemService(context, ClipboardManager::class.java) ?: return
        mgr.setPrimaryClip(ClipData.newPlainText(label, text))
    }
}
