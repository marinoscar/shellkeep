// =============================================================================
// The per-step log sink (issue #62)
// =============================================================================
//
// One `LogSink` per executed step. It is the ONLY path from a command's output to the database, the
// event bus, a browser and storage, so redaction lives here and nowhere downstream:
//
//   1. decode UTF-8 per stream (a multi-byte character split across two reads is carried over);
//   2. buffer by LINE (a secret never straddles a chunk boundary: a multi-line secret holds back
//      `longest literal - 1` characters), flushed when a line completes, when the buffer outgrows
//      `MAX_LINE`, after `IDLE_FLUSH_MS` of quiet, and at the end;
//   3. REDACT the flushed text with `redactText` (the shared patterns plus every secret value of the run
//      as an exact literal, which the output then shows as `[REDACTED:literal]`);
//   4. split into chunks of at most 4 KiB (UTF-8 safe), INSERT each into `runbook_run_log_chunks` with an
//      increasing `seq` and publish it on `runbooks.run` (well under the bus's 7,500-byte envelope);
//   5. cap at `maxBytes` of output: past it ONE `system` chunk `[output truncated]` is written and
//      `log_truncated` is set; later output is dropped;
//   6. at the end, `finish()` joins the chunks, uploads them to
//      `runbook-artifacts/<orgId>/<runId>/<targetId>/<stepIndex>.log`, records the key on the step and
//      deletes the chunks. If storage is unavailable the chunks stay (the reconcile job retries).
//
// Writes are serialised through a promise chain so `seq` is gap-free and in order.
// =============================================================================

import { StringDecoder } from 'node:string_decoder';

import { Logger } from '@nestjs/common';

import { redactText } from '../../command-safety';
import { LOG_CHUNK_BYTES, OUTPUT_TAIL_BYTES } from './engine.constants';
import type { RunEvent } from './run-events';

export type SinkStream = 'stdout' | 'stderr' | 'system';

/** What the sink needs from persistence and the bus: ports, so the sink is testable alone. */
export interface LogSinkPorts {
  /** Persists one chunk. */
  insertChunk(chunk: { runStepId: string; seq: number; stream: SinkStream; data: string; bytes: number }): Promise<void>;
  publish(event: RunEvent): Promise<void>;
}

export interface LogSinkOptions {
  runId: string;
  targetId: string;
  stepIndex: number;
  runStepId: string;
  /** Exact secret values to remove from every chunk. */
  secrets: readonly string[];
  /** Cap on the stored output (`runbooks.maxLogBytesPerStep`). */
  maxBytes: number;
  ports: LogSinkPorts;
  idleFlushMs?: number;
  /**
   * A step that spans several jobs (an AI step that waits for an approval, #64) opens a new sink per job:
   * `seq` continues after the chunks already stored and the byte cap counts the bytes already written.
   */
  startSeq?: number;
  startBytes?: number;
}

const MAX_LINE = 8_192;
export const IDLE_FLUSH_MS = 400;
export const TRUNCATED_MARKER = '[output truncated]\n';

/** Splits `text` into pieces of at most `limit` UTF-8 bytes without cutting a character. */
export function splitUtf8(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  for (const char of text) {
    const width = Buffer.byteLength(char, 'utf8');
    if (size + width > limit && current !== '') {
      pieces.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += width;
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

/** The last `limit` bytes of `text`, starting on a character boundary. */
export function tailUtf8(text: string, limit: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= limit) return text;
  let start = buffer.length - limit;
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString('utf8');
}

export class LogSink {
  private readonly logger = new Logger(LogSink.name);
  private readonly decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  private readonly pending: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  private readonly timers: Partial<Record<'stdout' | 'stderr', NodeJS.Timeout>> = {};
  private readonly holdback: number;
  private chain: Promise<void> = Promise.resolve();
  private seq: number;
  private written: number;
  private tail = '';
  private closed = false;

  truncated = false;

  constructor(private readonly options: LogSinkOptions) {
    this.seq = options.startSeq ?? 0;
    this.written = options.startBytes ?? 0;
    const longest = options.secrets.reduce((max, secret) => Math.max(max, secret.length), 0);
    // Only a secret with a line break can straddle a line boundary.
    const multiLine = options.secrets.some((secret) => secret.includes('\n'));
    this.holdback = multiLine ? Math.max(0, longest - 1) : 0;
  }

  /** The bytes of (redacted) output stored. */
  get bytes(): number {
    return this.written;
  }

  /** The last bytes of the redacted output, for the matrix. */
  outputTail(): string {
    return this.tail;
  }

  /** Feeds raw output. Never throws. */
  push(stream: 'stdout' | 'stderr', data: Buffer): void {
    if (this.closed) return;
    this.pending[stream] += this.decoders[stream].write(data);
    this.flushComplete(stream, false);
    this.armIdle(stream);
  }

  /** A line of the engine's own (`system` stream), for example `[exit 3]`. */
  system(text: string): void {
    if (this.closed) return;
    this.enqueue(() => this.emit('system', text));
  }

  /** Flushes what is buffered and waits for every write. Call once, when the step's command has ended. */
  async close(): Promise<void> {
    if (this.closed) return this.chain;
    for (const stream of ['stdout', 'stderr'] as const) {
      const timer = this.timers[stream];
      if (timer) clearTimeout(timer);
      this.pending[stream] += this.decoders[stream].end();
      this.flushComplete(stream, true);
    }
    this.closed = true;
    await this.chain;
  }

  private armIdle(stream: 'stdout' | 'stderr'): void {
    const existing = this.timers[stream];
    if (existing) clearTimeout(existing);
    if (this.pending[stream] === '') return;
    const timer = setTimeout(() => this.flushComplete(stream, false, true), this.options.idleFlushMs ?? IDLE_FLUSH_MS);
    timer.unref();
    this.timers[stream] = timer;
  }

  /** Emits the part of the buffer that is safe to redact and send. */
  private flushComplete(stream: 'stdout' | 'stderr', final: boolean, idle = false): void {
    const text = this.pending[stream];
    if (text === '') return;
    let cut: number;
    if (final) cut = text.length;
    else {
      cut = text.lastIndexOf('\n') + 1;
      if (cut === 0 && (idle || text.length > MAX_LINE)) cut = text.length;
      else if (idle) cut = text.length;
      if (this.holdback > 0) cut = this.safeCut(text, Math.min(cut, Math.max(0, text.length - this.holdback)));
    }
    if (cut <= 0) return;
    this.pending[stream] = text.slice(cut);
    const segment = text.slice(0, cut);
    this.enqueue(() => this.emit(stream, segment));
  }

  /** Moves `cut` back to the start of any secret occurrence it would split. */
  private safeCut(text: string, cut: number): number {
    let moved = true;
    while (moved && cut > 0) {
      moved = false;
      for (const secret of this.options.secrets) {
        if (secret.length === 0) continue;
        let at = text.indexOf(secret);
        while (at !== -1 && at < cut) {
          if (at + secret.length > cut) {
            cut = at;
            moved = true;
            break;
          }
          at = text.indexOf(secret, at + 1);
        }
      }
    }
    return cut;
  }

  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch((error) => {
      this.logger.warn(`log chunk write failed: ${error instanceof Error ? error.name : 'error'}`);
    });
  }

  private async emit(stream: SinkStream, raw: string): Promise<void> {
    if (this.truncated) return;
    const redacted = redactText(raw, { extraLiterals: this.options.secrets.filter((secret) => secret.length > 0) }).text;
    for (const piece of splitUtf8(redacted, LOG_CHUNK_BYTES)) {
      const size = Buffer.byteLength(piece, 'utf8');
      if (this.written + size > this.options.maxBytes) {
        this.truncated = true;
        await this.write('system', TRUNCATED_MARKER);
        return;
      }
      await this.write(stream, piece);
    }
  }

  private async write(stream: SinkStream, data: string): Promise<void> {
    const bytes = Buffer.byteLength(data, 'utf8');
    const seq = this.seq;
    this.seq += 1;
    this.written += bytes;
    this.tail = tailUtf8(this.tail + data, OUTPUT_TAIL_BYTES);
    await this.options.ports.insertChunk({ runStepId: this.options.runStepId, seq, stream, data, bytes });
    await this.options.ports.publish({
      type: 'chunk',
      runId: this.options.runId,
      targetId: this.options.targetId,
      stepIndex: this.options.stepIndex,
      stepRowId: this.options.runStepId,
      seq,
      stream,
      data,
    });
  }
}
