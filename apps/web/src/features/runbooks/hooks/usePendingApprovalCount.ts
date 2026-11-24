import { useSyncExternalStore } from 'react';
import { countPendingApprovals } from '../api/runbooksApi';

export const APPROVAL_COUNT_REFRESH_MS = 60_000;

/**
 * The pending-approvals count (#65): `GET /api/runbook-approvals?status=pending&count=true`,
 * refreshed every minute while anything shows it. ONE request per minute however many surfaces
 * draw the badge (the rail, the bottom bar, the user menu, the Runbooks page): a module-level
 * store polls while it has subscribers. A failed call keeps the last count rather than erroring:
 * the inbox itself reports errors.
 */
let count = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function load(): void {
  countPendingApprovals()
    .then((n) => {
      if (n === count) return;
      count = n;
      for (const listener of listeners) listener();
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    load();
    timer = setInterval(load, APPROVAL_COUNT_REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const noop = () => () => undefined;
const zero = () => 0;
const current = () => count;

/** Re-read the count now (after a decision). */
export function refreshPendingApprovalCount(): void {
  if (listeners.size > 0) load();
}

/** Reset the store (tests). */
export function resetPendingApprovalCount(): void {
  count = 0;
}

export function usePendingApprovalCount(enabled = true): number {
  return useSyncExternalStore(enabled ? subscribe : noop, enabled ? current : zero, zero);
}
