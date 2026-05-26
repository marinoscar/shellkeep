package cr.marin.shellkeep.terminal

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire-compatible model for user-defined terminal key shortcuts. Field names
 * and modifier strings match `apps/web/src/types/index.ts` so the same JSON
 * payload from `/api/user-settings` deserializes here without translation.
 */

@Serializable
enum class KeyShortcutModifier {
    @SerialName("ctrl") CTRL,
    @SerialName("shift") SHIFT,
    @SerialName("alt") ALT,
    @SerialName("meta") META,
}

/**
 * Canonical base-key identifiers. Mirrors `KEY_SHORTCUT_BASE_KEYS` in
 * `apps/web/src/types/index.ts` and the Zod schema in
 * `apps/api/src/common/schemas/settings.schema.ts` — keep in sync.
 */
object KeyShortcutBaseKeys {
    val ALL: List<String> = listOf(
        "Escape", "Tab", "Enter", "Backspace", "Space",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Home", "End", "PageUp", "PageDown", "Insert", "Delete",
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
        "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
        "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
    )
}

@Serializable
data class Keystroke(
    val modifiers: List<KeyShortcutModifier> = emptyList(),
    val key: String,
)

@Serializable
data class KeyShortcut(
    val id: String,
    val label: String,
    val keystrokes: List<Keystroke>,
)
