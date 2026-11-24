// =============================================================================
// Binary detection and UTF-8 windows (issue #153)
// =============================================================================

/** The head of a file inspected to decide text or binary. */
export const BINARY_SNIFF_BYTES = 8192;

/**
 * True when `head` (the first bytes of a file) holds a NUL byte or invalid UTF-8. A multi-byte
 * character cut by the end of `head` is not an error when `truncated` (more bytes follow).
 */
export function looksBinary(head: Buffer, truncated: boolean): boolean {
  const sample = head.subarray(0, BINARY_SNIFF_BYTES);
  if (sample.includes(0)) return true;
  const cut = sample.length < head.length || truncated;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: cut });
    return false;
  } catch {
    return true;
  }
}

export interface Utf8Window {
  /** The decoded text. */
  text: string;
  /** Bytes skipped at the start (continuation bytes of a character that began before the window). */
  skipped: number;
  /** Bytes decoded; `skipped + length` is where the next window starts. */
  length: number;
}

const isContinuation = (b: number): boolean => (b & 0xc0) === 0x80;

/**
 * Decodes a byte window cut anywhere: leading continuation bytes (at most 3) are skipped and an
 * incomplete character at the end is left for the next window unless `eof`. Returns `null` when
 * the rest is not valid UTF-8 (the file is binary).
 */
export function decodeUtf8Window(buffer: Buffer, eof: boolean): Utf8Window | null {
  let start = 0;
  while (start < buffer.length && start < 3 && isContinuation(buffer[start])) start++;
  let end = buffer.length;
  if (!eof) {
    // Walk back over at most 3 continuation bytes to the lead byte; drop it when its character is incomplete.
    let i = end - 1;
    let back = 0;
    while (i >= start && back < 3 && isContinuation(buffer[i])) {
      i--;
      back++;
    }
    if (i >= start) {
      const lead = buffer[i];
      const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
      if (need > 1 && end - i < need) end = i;
    }
  }
  const slice = buffer.subarray(start, end);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(slice);
    return { text, skipped: start, length: slice.length };
  } catch {
    return null;
  }
}
