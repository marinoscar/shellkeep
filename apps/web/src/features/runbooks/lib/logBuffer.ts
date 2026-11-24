/**
 * Orders one step's log chunks (issue #65). The engine numbers a step's chunks from 0 with no
 * gaps (`log-sink.ts`), so the buffer writes them strictly in `seq` order, holds a chunk that
 * arrives ahead of a missing one, and drops any `seq` it already wrote: a `Last-Event-ID` replay
 * after a reconnect overlaps what the live tail delivered.
 */
export interface LogChunk {
  seq: number;
  data: string;
}

export class LogBuffer {
  /** The next `seq` to write; `null` until the first chunk sets the baseline. */
  private next: number | null;
  private readonly pending = new Map<number, string>();

  /** @param startSeq - the first `seq` expected (0 for a log read from its start). */
  constructor(startSeq: number | null = 0) {
    this.next = startSeq;
  }

  /** The `seq` the buffer waits for. */
  get expected(): number | null {
    return this.next;
  }

  /** How many chunks are held for a gap. */
  get held(): number {
    return this.pending.size;
  }

  /** Accept one chunk; returns the data now writable, in order (possibly empty). */
  push(chunk: LogChunk): string[] {
    if (this.next === null) this.next = chunk.seq;
    if (chunk.seq < this.next || this.pending.has(chunk.seq)) return [];
    this.pending.set(chunk.seq, chunk.data);
    const out: string[] = [];
    while (this.pending.has(this.next)) {
      out.push(this.pending.get(this.next)!);
      this.pending.delete(this.next);
      this.next += 1;
    }
    return out;
  }

  /** Give up on a gap: write what is held, in order, and continue after it. */
  flush(): string[] {
    const seqs = [...this.pending.keys()].sort((a, b) => a - b);
    const out = seqs.map((seq) => this.pending.get(seq)!);
    this.pending.clear();
    if (seqs.length > 0) this.next = seqs[seqs.length - 1]! + 1;
    return out;
  }
}
