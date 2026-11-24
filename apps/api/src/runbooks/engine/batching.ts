import type { RunStrategy } from '../schema/runbook-definition.schema';

/**
 * The wave (`batch_index`) of the target at `position`:
 *   - `batchSize` set: waves of that size;
 *   - canary without a batch size: the first `concurrency` targets are wave 0, the rest wave 1;
 *   - otherwise everything is wave 0 (a plain sliding window).
 */
export function batchIndexOf(position: number, strategy: Pick<RunStrategy, 'batchSize' | 'pauseAfterFirstBatch' | 'concurrency'>): number {
  if (strategy.batchSize !== undefined) return Math.floor(position / strategy.batchSize);
  if (strategy.pauseAfterFirstBatch) return position < strategy.concurrency ? 0 : 1;
  return 0;
}
