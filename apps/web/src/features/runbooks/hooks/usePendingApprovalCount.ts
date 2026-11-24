import { useEffect, useState } from 'react';
import { countPendingApprovals } from '../api/runbooksApi';

export const APPROVAL_COUNT_REFRESH_MS = 60_000;

/**
 * The pending-approvals count of the Runbooks destination badge (#65):
 * `GET /api/runbook-approvals?status=pending&count=true`, refreshed every minute. A failed call
 * shows no badge rather than an error: the inbox itself reports errors.
 */
export function usePendingApprovalCount(enabled = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () =>
      countPendingApprovals()
        .then((n) => {
          if (!cancelled) setCount(n);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, APPROVAL_COUNT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return count;
}
