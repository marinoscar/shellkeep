/* eslint-disable no-control-regex -- matching terminal control characters is this file's whole job */
// Pure: removes terminal control sequences and normalises line endings.

// OSC: ESC ] ... (BEL | ESC \)    DCS/PM/APC/SOS: ESC (P|^|_|X) ... ESC \
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const STRING_SEQ = /\u001b[P^_X][^\u001b]*(?:\u001b\\)?/g;
// CSI: ESC [ params intermediates final
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// Two-byte escapes (ESC c, ESC =, ESC ( B ...)
const ESC_OTHER = /\u001b[()#][0-9A-Za-z]|\u001b[@-Z\\-_=>78cDEHMNO]/g;
const C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
// Other C0 controls except \n and \t.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g;

/** Strips CSI/OSC/DCS sequences and stray control characters; normalises CRLF and CR to LF. */
export function stripAnsi(text: string): string {
  return text
    .replace(OSC, '')
    .replace(STRING_SEQ, '')
    .replace(CSI, '')
    .replace(C1_CSI, '')
    .replace(ESC_OTHER, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/\u001b/g, '');
}
