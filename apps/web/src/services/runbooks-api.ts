import { api } from './api';

// Runbooks as the Servers page uses them (#79): pick a runbook, preview the targets, start a run.
// The run route is the runbook engine's (#62, `POST /api/runbooks/:id/runs`).

/** One row of `GET /api/runbooks` (only what the picker reads). */
export interface RunbookSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  latestVersion: { version: number } | null;
}

export interface RunbooksPage {
  items: RunbookSummary[];
  total: number;
}

/** `POST /api/runbooks/targets/preview`: the servers a selector resolves to, and the ones skipped. */
export interface RunbookTargetsPreview {
  servers: { id: string; name: string; hostname: string; hostKeyTrusted?: boolean }[];
  skipped: { serverProfileId: string; reason: string }[];
  total: number;
  capped: boolean;
  limit: number;
}

export async function listRunbooks(params: { q?: string; pageSize?: number } = {}): Promise<RunbooksPage> {
  const search = new URLSearchParams();
  search.set('pageSize', String(params.pageSize ?? 50));
  if (params.q) search.set('q', params.q);
  return api.get<RunbooksPage>(`/runbooks?${search.toString()}`);
}

/** The dry run of "Run runbook on selected": which of the chosen servers a run would reach. Nothing runs. */
export async function previewRunbookTargets(serverIds: string[]): Promise<RunbookTargetsPreview> {
  return api.post<RunbookTargetsPreview>('/runbooks/targets/preview', { selector: { serverIds } });
}

/** Starts a run of the runbook's latest version on exactly these servers. */
export async function startRunbookRun(runbookId: string, serverIds: string[]): Promise<{ runId: string }> {
  return api.post<{ runId: string }>(`/runbooks/${runbookId}/runs`, { targets: { serverIds } });
}
