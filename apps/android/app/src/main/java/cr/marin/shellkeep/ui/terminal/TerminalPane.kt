package cr.marin.shellkeep.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cr.marin.shellkeep.terminal.TerminalConnection
import cr.marin.shellkeep.ui.theme.TerminalBackground
import cr.marin.shellkeep.ui.theme.TerminalForeground
import kotlinx.coroutines.launch

/**
 * One terminal pane bound to one [TerminalConnection].
 *
 * Output rendering: the connection's binary output stream is fed to a
 * [cr.marin.shellkeep.terminal.TerminalBuffer] (owned by the ViewModel)
 * which strips ANSI escapes and emits a plain-text StateFlow. We render
 * that as monospace lines in a LazyColumn with auto-scroll-to-bottom.
 *
 * Input capture: a transparent BasicTextField overlays the pane. The user
 * focuses it by tapping the pane; the soft keyboard appears (autocorrect
 * disabled, no suggestions). Every typed character is consumed and sent
 * immediately as raw bytes — the field never accumulates text.
 *
 * The pane is NOT a full terminal emulator. Cursor-positioning escapes are
 * dropped; vim/htop will render garbled. See TerminalBuffer for the trade-off.
 */
@Composable
fun TerminalPane(
    connection: TerminalConnection,
    text: String,
    modifier: Modifier = Modifier,
) {
    val focusRequester = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    var inputField by remember { mutableStateOf(TextFieldValue("")) }
    val lazyListState = rememberLazyListState()
    val lines = remember(text) { text.split('\n') }

    // Auto-scroll to bottom whenever new output lands.
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) {
            lazyListState.scrollToItem((lines.size - 1).coerceAtLeast(0))
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(TerminalBackground)
            .clickable { focusRequester.requestFocus() },
    ) {
        LazyColumn(
            state = lazyListState,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            items(count = lines.size, key = { it }) { idx ->
                Text(
                    text = lines[idx],
                    style = TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp,
                        color = TerminalForeground,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // Hidden input field — captures soft-keyboard typing and pipes it
        // straight to the WebSocket. Bytes are sent as UTF-8; the encoder
        // for special keys lives in VirtualKeyBar / KeystrokeEncoder.
        BasicTextField(
            value = inputField,
            onValueChange = { newValue ->
                val diff = computeDiff(inputField.text, newValue.text)
                if (diff.isNotEmpty()) {
                    connection.sendInput(diff.toByteArray(Charsets.UTF_8))
                }
                // Keep the field empty so backspace works the next round.
                inputField = TextFieldValue("")
            },
            keyboardOptions = KeyboardOptions(
                autoCorrect = false,
                capitalization = KeyboardCapitalization.None,
                keyboardType = KeyboardType.Ascii,
                imeAction = ImeAction.None,
            ),
            keyboardActions = KeyboardActions.Default,
            textStyle = TextStyle(color = Color.Transparent, fontSize = 1.sp),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(Color.Transparent),
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(focusRequester),
        )

        // Request focus when first composed so the soft keyboard appears
        // without an extra tap.
        LaunchedEffect(Unit) {
            scope.launch { focusRequester.requestFocus() }
        }
    }
}

/**
 * Compute the byte-string to send to the PTY based on what changed between
 * the previous and new field values. Most IME events produce a single
 * appended character (or a small batch on paste); backspace produces a
 * shorter string for which we emit DEL (0x7F).
 */
private fun computeDiff(prev: String, next: String): String {
    return when {
        next.length > prev.length && next.startsWith(prev) ->
            next.substring(prev.length)
        next.length < prev.length ->
            "\u007F".repeat(prev.length - next.length) // DEL per char removed
        next.isNotEmpty() ->
            next // unrelated change (autocorrect, etc.) — send the lot
        else -> ""
    }
}
