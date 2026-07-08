package cr.marin.shellkeep.terminal

import cr.marin.shellkeep.terminal.KeyShortcutModifier.ALT
import cr.marin.shellkeep.terminal.KeyShortcutModifier.CTRL
import cr.marin.shellkeep.terminal.KeyShortcutModifier.META
import cr.marin.shellkeep.terminal.KeyShortcutModifier.SHIFT

/**
 * Encodes a Keystroke / KeyShortcut into the byte string a PTY/xterm expects.
 *
 * Port of `apps/web/src/lib/terminal/encodeKeystroke.ts` — keep the two in
 * sync. Encoding priority is documented inline on [encode].
 *
 * Modifier code table (ECMA-48 / VT220):
 *   modifier_code = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0)
 * When the code is 1 (no modifier), the ";1" suffix is omitted.
 */
object KeystrokeEncoder {

    private const val ESC = "\u001B"
    private const val TAB = "\u0009"
    private const val CR = "\r"
    private const val DEL = "\u007F"
    private const val NUL = "\u0000"

    private val BARE_SEQUENCES: Map<String, String> = mapOf(
        "Escape" to ESC,
        "Tab" to TAB,
        "Enter" to CR,
        "Backspace" to DEL,
        "Space" to " ",
        "ArrowUp" to "$ESC[A",
        "ArrowDown" to "$ESC[B",
        "ArrowRight" to "$ESC[C",
        "ArrowLeft" to "$ESC[D",
        "Home" to "$ESC[H",
        "End" to "$ESC[F",
        "PageUp" to "$ESC[5~",
        "PageDown" to "$ESC[6~",
        "Insert" to "$ESC[2~",
        "Delete" to "$ESC[3~",
        "F1" to "${ESC}OP",
        "F2" to "${ESC}OQ",
        "F3" to "${ESC}OR",
        "F4" to "${ESC}OS",
        "F5" to "$ESC[15~",
        "F6" to "$ESC[17~",
        "F7" to "$ESC[18~",
        "F8" to "$ESC[19~",
        "F9" to "$ESC[20~",
        "F10" to "$ESC[21~",
        "F11" to "$ESC[23~",
        "F12" to "$ESC[24~",
    )

    private val CSI_CURSOR_FINAL: Map<String, String> = mapOf(
        "ArrowUp" to "A",
        "ArrowDown" to "B",
        "ArrowRight" to "C",
        "ArrowLeft" to "D",
        "Home" to "H",
        "End" to "F",
    )

    private val CSI_TILDE_CODE: Map<String, Int> = mapOf(
        "PageUp" to 5,
        "PageDown" to 6,
        "Insert" to 2,
        "Delete" to 3,
    )

    private val F_SS3_FINAL: Map<String, String> = mapOf(
        "F1" to "P", "F2" to "Q", "F3" to "R", "F4" to "S",
    )

    private val F_CSI_CODE: Map<String, Int> = mapOf(
        "F5" to 15, "F6" to 17, "F7" to 18, "F8" to 19,
        "F9" to 20, "F10" to 21, "F11" to 23, "F12" to 24,
    )

    private fun modCode(ks: Keystroke): Int {
        var code = 1
        if (SHIFT in ks.modifiers) code += 1
        if (ALT in ks.modifiers) code += 2
        if (CTRL in ks.modifiers) code += 4
        if (META in ks.modifiers) code += 8
        return code
    }

    private fun modSuffix(ks: Keystroke): String {
        val code = modCode(ks)
        return if (code == 1) "" else ";$code"
    }

    /**
     * Encoding priority (first matching rule wins):
     *   1. Shift+Tab                                   -> ESC [ Z
     *   2. Ctrl+Space                                  -> NUL
     *   3. Ctrl + letter (a-z)                         -> control char 0x01..0x1A
     *   4. Alt + any key (no Ctrl)                     -> ESC + bare encoding of key
     *   5. Modified cursor / Home / End                -> CSI 1;{mod}{final}
     *   6. Modified tilde keys (PgUp/PgDn/Ins/Del)     -> CSI {code};{mod}~
     *   7. Modified F-keys                             -> CSI 1;{mod}{P|Q|R|S} or CSI {code};{mod}~
     *   8. Bare special keys                           -> table lookup
     *   9. Printable letter with Shift                 -> uppercase
     *  10. Other printable characters                  -> the character itself
     */
    fun encode(ks: Keystroke): String {
        val key = ks.key
        val hasCtrl = CTRL in ks.modifiers
        val hasShift = SHIFT in ks.modifiers
        val hasAlt = ALT in ks.modifiers
        val hasMod = hasCtrl || hasShift || hasAlt || META in ks.modifiers

        // 1. Shift+Tab -> ESC [ Z
        if (key == "Tab" && hasShift && !hasCtrl && !hasAlt) {
            return "$ESC[Z"
        }

        // 2. Ctrl+Space -> NUL
        if (key == "Space" && hasCtrl) {
            return NUL
        }

        // 3. Ctrl + letter
        if (hasCtrl && !hasAlt && key.length == 1 && key[0] in 'a'..'z') {
            return (key[0].code - 96).toChar().toString()
        }

        // 4. Alt prefix (no Ctrl)
        if (hasAlt && !hasCtrl) {
            val inner = encode(ks.copy(modifiers = ks.modifiers.filter { it != ALT }))
            return ESC + inner
        }

        // From here we may have Ctrl (possibly with Shift), but not Alt.

        // 5. Modified cursor + Home/End
        CSI_CURSOR_FINAL[key]?.let { finalChar ->
            return if (!hasMod) BARE_SEQUENCES.getValue(key)
            else "$ESC[1${modSuffix(ks)}$finalChar"
        }

        // 6. Modified tilde keys
        CSI_TILDE_CODE[key]?.let { code ->
            return if (!hasMod) BARE_SEQUENCES.getValue(key)
            else "$ESC[$code${modSuffix(ks)}~"
        }

        // 7. Modified F-keys
        F_SS3_FINAL[key]?.let { finalChar ->
            return if (!hasMod) BARE_SEQUENCES.getValue(key)
            else "$ESC[1${modSuffix(ks)}$finalChar"
        }
        F_CSI_CODE[key]?.let { code ->
            return if (!hasMod) BARE_SEQUENCES.getValue(key)
            else "$ESC[$code${modSuffix(ks)}~"
        }

        // 8. Remaining bare special keys
        BARE_SEQUENCES[key]?.let { return it }

        // 9 & 10. Printable characters
        if (key.length == 1) {
            if (hasShift && key[0] in 'a'..'z') {
                return key.uppercase()
            }
            return key
        }

        // Fallback (should not be reached with valid inputs)
        return key
    }

    fun encode(shortcut: KeyShortcut): String =
        shortcut.keystrokes.joinToString(separator = "") { encode(it) }
}
