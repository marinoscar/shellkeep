// =============================================================================
// The run events (issue #62)
// =============================================================================
//
// What travels on the EVENT_BUS channel `runbooks.run` (and on the SSE stream built from it). Every
// payload is plain JSON well under the bus's 7,500-byte envelope: a log chunk is at most 4 KiB of
// text (the sink redacts it BEFORE it is stored or published). No event carries a secret, a command
// line or a hostname.
// =============================================================================

export type RunEvent =
  | { type: 'run'; runId: string; status: string; finishedAt?: string | null }
  | { type: 'target'; runId: string; targetId: string; status: string; errorCode?: string | null }
  | {
      type: 'step';
      runId: string;
      targetId: string;
      stepIndex: number;
      status: string;
      exitCode?: number | null;
      durationMs?: number | null;
    }
  | { type: 'approval'; runId: string; approvalId: string; status: string; scope: string; kind: string }
  | {
      type: 'chunk';
      runId: string;
      targetId: string;
      stepIndex: number;
      /** The step row id: with `seq` it is the SSE event id (`<stepRowId>:<seq>`). */
      stepRowId: string;
      seq: number;
      stream: 'stdout' | 'stderr' | 'system';
      data: string;
    };

/** A cancel request relayed to the replica that runs the target (`runbooks.cancel`). */
export interface RunCancelMessage {
  runId: string;
  /** Absent: the whole run. */
  targetId?: string;
}

/** The SSE `id:` of a log chunk. */
export const chunkEventId = (stepRowId: string, seq: number): string => `${stepRowId}:${seq}`;

/** Parses a `Last-Event-ID`; `null` when it is not `<uuid>:<seq>`. */
export function parseChunkEventId(value: string | undefined): { stepRowId: string; seq: number } | null {
  const match = /^([0-9a-f-]{36}):(\d{1,9})$/i.exec(value ?? '');
  return match ? { stepRowId: match[1]!, seq: Number(match[2]) } : null;
}
