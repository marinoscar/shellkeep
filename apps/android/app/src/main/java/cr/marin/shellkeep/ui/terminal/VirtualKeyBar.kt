package cr.marin.shellkeep.ui.terminal

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cr.marin.shellkeep.terminal.KeyShortcut
import cr.marin.shellkeep.terminal.KeyShortcutModifier
import cr.marin.shellkeep.terminal.Keystroke
import cr.marin.shellkeep.terminal.KeystrokeEncoder

/**
 * Native virtual key bar that sits above the soft keyboard.
 *
 * Always-on chips: Ctrl/Alt sticky toggles, Esc, Tab, arrows, Home/End,
 * Page Up/Down, Insert, Delete, F1-F12, plus a few common Ctrl combinations
 * that terminal users hit constantly (^C, ^D, ^L, ^Z, ^\). User-defined
 * chips from `settings.terminal.keyShortcuts` are appended via [extraShortcuts].
 *
 * Sticky modifiers only affect SPECIAL keys tapped on this bar. Soft-keyboard
 * input goes directly to the terminal view and is not modified — users who
 * want arbitrary Ctrl+letter combos should define them as KeyShortcuts in
 * Settings. (Matches the web app's behavior.)
 */
@Composable
fun VirtualKeyBar(
    onBytes: (ByteArray) -> Unit,
    modifier: Modifier = Modifier,
    extraShortcuts: List<KeyShortcut> = emptyList(),
) {
    var ctrlSticky by remember { mutableStateOf(false) }
    var altSticky by remember { mutableStateOf(false) }

    fun activeMods(): List<KeyShortcutModifier> = buildList {
        if (ctrlSticky) add(KeyShortcutModifier.CTRL)
        if (altSticky) add(KeyShortcutModifier.ALT)
    }

    fun send(key: String) {
        val s = KeystrokeEncoder.encode(Keystroke(activeMods(), key))
        onBytes(s.toByteArray(Charsets.UTF_8))
        // Sticky modifiers consume after one use, matching desktop sticky-keys UX.
        if (ctrlSticky) ctrlSticky = false
        if (altSticky) altSticky = false
    }

    fun sendShortcut(shortcut: KeyShortcut) {
        onBytes(KeystrokeEncoder.encode(shortcut).toByteArray(Charsets.UTF_8))
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            FilterChip(
                selected = ctrlSticky,
                onClick = { ctrlSticky = !ctrlSticky },
                label = { Text("Ctrl") },
            )
            FilterChip(
                selected = altSticky,
                onClick = { altSticky = !altSticky },
                label = { Text("Alt") },
            )

            keyChip("Esc") { send("Escape") }
            keyChip("Tab") { send("Tab") }

            keyChip("↑") { send("ArrowUp") }
            keyChip("↓") { send("ArrowDown") }
            keyChip("←") { send("ArrowLeft") }
            keyChip("→") { send("ArrowRight") }

            keyChip("Home") { send("Home") }
            keyChip("End") { send("End") }
            keyChip("PgUp") { send("PageUp") }
            keyChip("PgDn") { send("PageDown") }
            keyChip("Ins") { send("Insert") }
            keyChip("Del") { send("Delete") }

            for (i in 1..12) {
                keyChip("F$i") { send("F$i") }
            }

            // Common Ctrl combos pre-bound for one-tap access.
            keyChip("^C") { sendShortcut(BUILTIN_CTRL_C) }
            keyChip("^D") { sendShortcut(BUILTIN_CTRL_D) }
            keyChip("^L") { sendShortcut(BUILTIN_CTRL_L) }
            keyChip("^Z") { sendShortcut(BUILTIN_CTRL_Z) }
            keyChip("^\\") { sendShortcut(BUILTIN_CTRL_BACKSLASH) }

            for (shortcut in extraShortcuts) {
                keyChip(shortcut.label) { sendShortcut(shortcut) }
            }
        }
    }
}

@Composable
private fun keyChip(label: String, onClick: () -> Unit) {
    AssistChip(
        onClick = onClick,
        label = { Text(label) },
        elevation = AssistChipDefaults.assistChipElevation(elevation = 0.dp),
    )
}

private val BUILTIN_CTRL_C = KeyShortcut(
    id = "builtin-ctrl-c", label = "^C",
    keystrokes = listOf(Keystroke(listOf(KeyShortcutModifier.CTRL), "c")),
)
private val BUILTIN_CTRL_D = KeyShortcut(
    id = "builtin-ctrl-d", label = "^D",
    keystrokes = listOf(Keystroke(listOf(KeyShortcutModifier.CTRL), "d")),
)
private val BUILTIN_CTRL_L = KeyShortcut(
    id = "builtin-ctrl-l", label = "^L",
    keystrokes = listOf(Keystroke(listOf(KeyShortcutModifier.CTRL), "l")),
)
private val BUILTIN_CTRL_Z = KeyShortcut(
    id = "builtin-ctrl-z", label = "^Z",
    keystrokes = listOf(Keystroke(listOf(KeyShortcutModifier.CTRL), "z")),
)
private val BUILTIN_CTRL_BACKSLASH = KeyShortcut(
    id = "builtin-ctrl-backslash", label = "^\\",
    keystrokes = listOf(Keystroke(listOf(KeyShortcutModifier.CTRL), "\\")),
)
