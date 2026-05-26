package cr.marin.shellkeep.terminal

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Minimal byte-stream → text buffer for the MVP terminal pane.
 *
 * This is **not** a full VT100/VT220 emulator. It does just enough to make
 * an interactive shell readable on the phone:
 *
 *  - Accumulates UTF-8 bytes (re-buffering partial code points across writes).
 *  - Strips CSI escape sequences (ESC `[` … final-byte) and OSC sequences
 *    (ESC `]` … BEL / ST) since we don't honour them.
 *  - Drops most other C0/C1 control bytes but keeps `\n` `\t` and applies
 *    `\r` (truncate current line to start of line) and `\b` (rub-out one
 *    character).
 *  - Caps total retained text at MAX_CHARS so memory does not grow
 *    unboundedly during a long session.
 *
 * Full-screen TUIs (vim, htop, less) will render garbled because we ignore
 * cursor-positioning escapes. Replacing this with the Termux terminal-emulator
 * (or a custom one) is tracked as a follow-up — TerminalConnection's wire
 * protocol does not change.
 *
 * Thread-safety: a single writer is assumed (TerminalConnection.output
 * collector). Readers via [text] are safe (StateFlow).
 */
class TerminalBuffer {

    private val sb = StringBuilder()
    private val _text = MutableStateFlow("")
    val text: StateFlow<String> = _text.asStateFlow()

    private var pendingTail: ByteArray = EMPTY_BYTES

    fun write(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        val combined = if (pendingTail.isEmpty()) bytes
        else pendingTail + bytes
        val (decoded, tail) = decodeUtf8(combined)
        pendingTail = tail
        if (decoded.isNotEmpty()) appendDecoded(decoded)
        _text.value = sb.toString()
    }

    fun clear() {
        sb.clear()
        pendingTail = EMPTY_BYTES
        _text.value = ""
    }

    private fun appendDecoded(input: String) {
        var i = 0
        val n = input.length
        while (i < n) {
            val c = input[i]
            when {
                c == ESC -> {
                    // Look at the following byte (if any) to dispatch.
                    if (i + 1 >= n) {
                        // Lone trailing ESC — drop; not enough info to parse.
                        return
                    }
                    val intro = input[i + 1]
                    i = when (intro) {
                        '[' -> skipCsi(input, i + 2)        // CSI: 0-n params, then a final byte 0x40..0x7E
                        ']' -> skipOsc(input, i + 2)        // OSC: terminated by BEL or ESC \
                        'P', '^', '_' -> skipStString(input, i + 2) // DCS / PM / APC
                        else -> i + 2                       // single-char escape, drop intro byte
                    }
                }
                c == '\r' -> {
                    // Move logical cursor to start of current line — model that by
                    // erasing back to the last '\n' (or buffer start). Drop the '\r'.
                    val newlineIdx = sb.lastIndexOf('\n')
                    val from = if (newlineIdx == -1) 0 else newlineIdx + 1
                    sb.delete(from, sb.length)
                    i++
                }
                c == '\b' -> {
                    if (sb.isNotEmpty() && sb.last() != '\n') sb.deleteCharAt(sb.length - 1)
                    i++
                }
                c == '\u0007' -> i++ // BEL — silently drop
                c.code in 0..0x1F && c != '\n' && c != '\t' -> i++ // other C0 control — drop
                else -> {
                    sb.append(c)
                    i++
                }
            }
        }
        if (sb.length > MAX_CHARS) {
            sb.delete(0, sb.length - MAX_CHARS)
        }
    }

    private fun skipCsi(input: String, start: Int): Int {
        var i = start
        // CSI: parameter bytes 0x30-0x3F, intermediate 0x20-0x2F, final 0x40-0x7E
        while (i < input.length) {
            val code = input[i].code
            if (code in 0x40..0x7E) return i + 1 // final byte consumed
            i++
        }
        return i
    }

    private fun skipOsc(input: String, start: Int): Int {
        var i = start
        while (i < input.length) {
            val c = input[i]
            if (c == '\u0007') return i + 1 // BEL terminator
            if (c == ESC && i + 1 < input.length && input[i + 1] == '\\') return i + 2 // ESC \\
            i++
        }
        return i
    }

    /** Skip DCS / PM / APC strings (terminated by ST = ESC \\) */
    private fun skipStString(input: String, start: Int): Int {
        var i = start
        while (i < input.length) {
            if (input[i] == ESC && i + 1 < input.length && input[i + 1] == '\\') return i + 2
            i++
        }
        return i
    }

    /**
     * UTF-8 decode that returns (decoded text, leftover trailing bytes that
     * are part of a partial code point) so a multi-byte char split across
     * two WS frames doesn't render as garbage.
     */
    private fun decodeUtf8(bytes: ByteArray): Pair<String, ByteArray> {
        // Find the start of any trailing incomplete UTF-8 sequence by walking
        // back from the end up to 3 bytes.
        var split = bytes.size
        var look = 0
        while (look < 4 && split > 0) {
            val b = bytes[split - 1].toInt() and 0xFF
            split--
            look++
            if (b and 0x80 == 0) break                 // 1-byte sequence — already complete
            if (b and 0xC0 == 0xC0) {
                // Start byte of a multi-byte sequence; check if it has enough following bytes.
                val needed = when {
                    b and 0xE0 == 0xC0 -> 2
                    b and 0xF0 == 0xE0 -> 3
                    b and 0xF8 == 0xF0 -> 4
                    else -> 1
                }
                val remaining = bytes.size - split
                return if (remaining < needed) {
                    val tail = bytes.copyOfRange(split, bytes.size)
                    val head = bytes.copyOfRange(0, split)
                    String(head, Charsets.UTF_8) to tail
                } else {
                    String(bytes, Charsets.UTF_8) to EMPTY_BYTES
                }
            }
            // continuation byte (10xxxxxx) — keep walking
        }
        return String(bytes, Charsets.UTF_8) to EMPTY_BYTES
    }

    companion object {
        private const val MAX_CHARS = 200_000
        private const val ESC = '\u001B'
        private val EMPTY_BYTES = ByteArray(0)
    }
}
