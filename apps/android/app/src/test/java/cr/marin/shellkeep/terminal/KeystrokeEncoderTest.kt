package cr.marin.shellkeep.terminal

import cr.marin.shellkeep.terminal.KeyShortcutModifier.ALT
import cr.marin.shellkeep.terminal.KeyShortcutModifier.CTRL
import cr.marin.shellkeep.terminal.KeyShortcutModifier.META
import cr.marin.shellkeep.terminal.KeyShortcutModifier.SHIFT
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pinned against the TypeScript source `apps/web/src/lib/terminal/encodeKeystroke.ts`.
 * If a test here changes, the TS encoder almost certainly needs the same change.
 */
class KeystrokeEncoderTest {

    private fun ks(key: String, vararg mods: KeyShortcutModifier) =
        Keystroke(modifiers = mods.toList(), key = key)

    private fun enc(key: String, vararg mods: KeyShortcutModifier) =
        KeystrokeEncoder.encode(ks(key, *mods))

    // --- Bare special keys ----------------------------------------------------

    @Test fun bare_escape() = assertEquals("\u001B", enc("Escape"))
    @Test fun bare_tab() = assertEquals("\u0009", enc("Tab"))
    @Test fun bare_enter() = assertEquals("\r", enc("Enter"))
    @Test fun bare_backspace() = assertEquals("\u007F", enc("Backspace"))
    @Test fun bare_space() = assertEquals(" ", enc("Space"))

    @Test fun bare_arrow_up() = assertEquals("\u001B[A", enc("ArrowUp"))
    @Test fun bare_arrow_down() = assertEquals("\u001B[B", enc("ArrowDown"))
    @Test fun bare_arrow_right() = assertEquals("\u001B[C", enc("ArrowRight"))
    @Test fun bare_arrow_left() = assertEquals("\u001B[D", enc("ArrowLeft"))
    @Test fun bare_home() = assertEquals("\u001B[H", enc("Home"))
    @Test fun bare_end() = assertEquals("\u001B[F", enc("End"))
    @Test fun bare_page_up() = assertEquals("\u001B[5~", enc("PageUp"))
    @Test fun bare_page_down() = assertEquals("\u001B[6~", enc("PageDown"))
    @Test fun bare_insert() = assertEquals("\u001B[2~", enc("Insert"))
    @Test fun bare_delete() = assertEquals("\u001B[3~", enc("Delete"))

    @Test fun bare_f1() = assertEquals("\u001BOP", enc("F1"))
    @Test fun bare_f4() = assertEquals("\u001BOS", enc("F4"))
    @Test fun bare_f5() = assertEquals("\u001B[15~", enc("F5"))
    @Test fun bare_f12() = assertEquals("\u001B[24~", enc("F12"))

    // --- Rule 1: Shift+Tab ----------------------------------------------------

    @Test fun shift_tab_is_csi_z() = assertEquals("\u001B[Z", enc("Tab", SHIFT))

    // --- Rule 2: Ctrl+Space ---------------------------------------------------

    @Test fun ctrl_space_is_nul() = assertEquals("\u0000", enc("Space", CTRL))

    // --- Rule 3: Ctrl + letter ------------------------------------------------

    @Test fun ctrl_a_is_soh() = assertEquals("\u0001", enc("a", CTRL))
    @Test fun ctrl_c_is_etx() = assertEquals("\u0003", enc("c", CTRL))
    @Test fun ctrl_d_is_eot() = assertEquals("\u0004", enc("d", CTRL))
    @Test fun ctrl_z_is_sub() = assertEquals("\u001A", enc("z", CTRL))

    // --- Rule 4: Alt prefix ---------------------------------------------------

    @Test fun alt_letter_prefixes_esc() = assertEquals("\u001Ba", enc("a", ALT))
    @Test fun alt_shift_letter_prefixes_esc_uppercases() =
        assertEquals("\u001BA", enc("a", ALT, SHIFT))
    @Test fun alt_arrow_up_prefixes_esc_then_bare() =
        assertEquals("\u001B\u001B[A", enc("ArrowUp", ALT))

    // --- Rule 5: Modified cursor / Home / End ---------------------------------

    @Test fun shift_arrow_up() = assertEquals("\u001B[1;2A", enc("ArrowUp", SHIFT))
    @Test fun ctrl_arrow_up() = assertEquals("\u001B[1;5A", enc("ArrowUp", CTRL))
    @Test fun ctrl_shift_arrow_up() = assertEquals("\u001B[1;6A", enc("ArrowUp", CTRL, SHIFT))
    @Test fun shift_home() = assertEquals("\u001B[1;2H", enc("Home", SHIFT))
    @Test fun ctrl_end() = assertEquals("\u001B[1;5F", enc("End", CTRL))

    // --- Rule 6: Modified tilde keys ------------------------------------------

    @Test fun ctrl_page_up() = assertEquals("\u001B[5;5~", enc("PageUp", CTRL))
    @Test fun shift_delete() = assertEquals("\u001B[3;2~", enc("Delete", SHIFT))
    @Test fun ctrl_shift_insert() = assertEquals("\u001B[2;6~", enc("Insert", CTRL, SHIFT))

    // --- Rule 7: Modified F-keys ----------------------------------------------

    @Test fun shift_f1() = assertEquals("\u001B[1;2P", enc("F1", SHIFT))
    @Test fun ctrl_f4() = assertEquals("\u001B[1;5S", enc("F4", CTRL))
    @Test fun ctrl_f5() = assertEquals("\u001B[15;5~", enc("F5", CTRL))
    @Test fun shift_f12() = assertEquals("\u001B[24;2~", enc("F12", SHIFT))

    // --- Rule 9: Shift + letter -> uppercase ----------------------------------

    @Test fun shift_letter_uppercases() = assertEquals("A", enc("a", SHIFT))

    // --- Rule 10: Plain printables --------------------------------------------

    @Test fun plain_letter() = assertEquals("a", enc("a"))
    @Test fun plain_digit() = assertEquals("5", enc("5"))
    @Test fun plain_punctuation() = assertEquals("/", enc("/"))

    // --- Meta modifier in modCode --------------------------------------------

    @Test fun meta_arrow_up() = assertEquals("\u001B[1;9A", enc("ArrowUp", META))

    // --- Shortcut concatenation ----------------------------------------------

    @Test fun encode_shortcut_concatenates_keystrokes() {
        val shortcut = KeyShortcut(
            id = "kill-and-clear",
            label = "Ctrl+C, then clear",
            keystrokes = listOf(
                ks("c", CTRL),
                ks("c"), ks("l"), ks("e"), ks("a"), ks("r"),
                ks("Enter"),
            ),
        )
        assertEquals("\u0003clear\r", KeystrokeEncoder.encode(shortcut))
    }
}
