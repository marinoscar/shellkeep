/**
 * The runbooks HTTP calls (issue #65), on the app's one client (`services/api.ts`): the access
 * token in `Authorization: Bearer`, the 401 refresh, the maintenance hook. Shapes: `./types.ts`.
 */
import { api } from '../../../services/api';
import type {
  ApprovalsPage,
  CreateRunInput,
  Page,
  RunbookDefinitionInput,
  RunbookDetail,
  RunbookListItem,
  RunbookSecret,
  RunbookVersionSummary,
  RunbookVersionView,
  RunbookView,
  RunDetail,
  RunArtifacts,
  SignedDownload,
  RunStatus,
  RunAuditPage,
  RunbookCommandRow,
  RunListItem,
  StartRunResult,
  RunTrigger,
  TargetPreview,
  TargetSelector,
  ValidationResult,
} from './types';

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The `If-Match` of a version: the ETag `GET /api/runbooks/:id` sends (`"v<n>"`). */
export const versionEtag = (version: number): string => `"v${version}"`;

export type RunbooksFilter = 'all' | 'mine' | 'shared';

export interface ListRunbooksParams {
  page?: number;
  pageSize?: number;
  q?: string;
  tag?: string;
  includeArchived?: boolean;
  filter?: RunbooksFilter;
}

export function listRunbooks(params: ListRunbooksParams = {}): Promise<Page<RunbookListItem>> {
  return api.get(
    `/runbooks${query({
      page: params.page,
      pageSize: params.pageSize,
      q: params.q,
      tag: params.tag,
      includeArchived: params.includeArchived,
      filter: params.filter && params.filter !== 'all' ? params.filter : undefined,
    })}`,
  );
}

export const getRunbook = (id: string): Promise<RunbookDetail> => api.get(`/runbooks/${id}`);

export interface CreateRunbookInput {
  name: string;
  description?: string;
  tags?: string[];
  definition: RunbookDefinitionInput;
  changelog?: string;
}

export const createRunbook = (input: CreateRunbookInput): Promise<RunbookDetail> => api.post('/runbooks', input);

/** `PUT /api/runbooks/:id/definition` with `If-Match: "v<expectedVersion>"`; 412 when stale. */
export function replaceDefinition(
  id: string,
  expectedVersion: number,
  body: { definition: RunbookDefinitionInput; changelog?: string },
): Promise<RunbookDetail & { created: boolean }> {
  return api.put(`/runbooks/${id}/definition`, body, { headers: { 'If-Match': versionEtag(expectedVersion) } });
}

export const updateRunbookMetadata = (
  id: string,
  body: { name?: string; description?: string | null; tags?: string[] },
): Promise<RunbookView> => api.patch(`/runbooks/${id}`, body);

export const archiveRunbook = (id: string): Promise<void> => api.delete(`/runbooks/${id}`);
export const restoreRunbook = (id: string): Promise<RunbookView> => api.post(`/runbooks/${id}/restore`);

export const listVersions = (id: string): Promise<Page<RunbookVersionSummary>> =>
  api.get(`/runbooks/${id}/versions${query({ pageSize: 100 })}`);

export const getVersion = (id: string, version: number): Promise<RunbookVersionView> =>
  api.get(`/runbooks/${id}/versions/${version}`);

export const validateDefinition = (definition: RunbookDefinitionInput): Promise<ValidationResult> =>
  api.post('/runbooks/validate', { definition });

export const previewTargets = (selector: Partial<TargetSelector>): Promise<TargetPreview> =>
  api.post('/runbooks/targets/preview', { selector });

export const listRunbookSecrets = async (): Promise<RunbookSecret[]> => {
  const secrets = await api.get<RunbookSecret[]>('/runbook-secrets');
  return Array.isArray(secrets) ? secrets : [];
};

/** Write-only: the value is sent once and never comes back. */
export const putRunbookSecret = (name: string, body: { value: string; label?: string }): Promise<RunbookSecret> =>
  api.put(`/runbook-secrets/${encodeURIComponent(name)}`, body);

export const startRun = (runbookId: string, input: CreateRunInput): Promise<StartRunResult> =>
  api.post(`/runbooks/${runbookId}/runs`, input);

export interface ListRunsParams {
  page?: number;
  pageSize?: number;
  runbookId?: string;
  status?: RunStatus;
  trigger?: RunTrigger;
  since?: string;
}

export const listRuns = (params: ListRunsParams = {}): Promise<Page<RunListItem>> =>
  api.get(`/runbook-runs${query({ ...params })}`);

export const getRun = (id: string): Promise<RunDetail> => api.get(`/runbook-runs/${id}`);

/** The redacted log of one step as text. */
export async function getStepLog(runId: string, targetId: string, stepIndex: number): Promise<string> {
  const blob = await api.getBlob(`/runbook-runs/${runId}/targets/${targetId}/steps/${stepIndex}/log`);
  return blobText(blob);
}

/** A blob's text; through `FileReader` where `Blob.text` is missing (older engines, jsdom). */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the log'));
    reader.readAsText(blob);
  });
}

export const cancelRun = (id: string): Promise<{ id: string; status: string }> => api.post(`/runbook-runs/${id}/cancel`);
export const cancelTarget = (id: string, targetId: string): Promise<{ id: string; status: string }> =>
  api.post(`/runbook-runs/${id}/targets/${targetId}/cancel`);
export const retryRun = (id: string, only: 'failed' | 'all' = 'failed'): Promise<{ runId: string }> =>
  api.post(`/runbook-runs/${id}/retry`, { only });
export const resumeRun = (id: string): Promise<unknown> => api.post(`/runbook-runs/${id}/resume`);

export const listApprovals = (
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'all' = 'pending',
  page = 1,
  pageSize = 50,
): Promise<ApprovalsPage> => api.get(`/runbook-approvals${query({ status, page, pageSize })}`);

export async function countPendingApprovals(): Promise<number> {
  const result = await api.get<{ count: number }>('/runbook-approvals?status=pending&count=true');
  return result.count;
}

export const decideApproval = (
  id: string,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<{ id: string; status: string }> =>
  api.post(`/runbook-approvals/${id}/decision`, { decision, ...(comment ? { comment } : {}) });

/** A run's audit trail (#67), oldest first. */
export const getRunAudit = (id: string, page = 1, pageSize = 200): Promise<RunAuditPage> =>
  api.get(`/runbook-runs/${id}/audit${query({ page, pageSize })}`);

/** Download a run's audit trail as a file (#67): CSV (formula-safe) or JSON. */
export async function downloadRunAudit(id: string, format: 'csv' | 'json'): Promise<void> {
  const blob = await api.getBlob(`/runbook-runs/${id}/audit/export${query({ format })}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `run-${id}-audit.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ListCommandsParams {
  serverId?: string;
  userId?: string;
  runId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** The org-wide command log (#67): what runbooks ran, newest first. */
export const listRunbookCommands = (params: ListCommandsParams = {}): Promise<Page<RunbookCommandRow>> =>
  api.get(`/runbook-commands${query({ ...params })}`);

// ---------------------------------------------------------------------------
// Artifacts (#63)
// ---------------------------------------------------------------------------

export const getRunArtifacts = (runId: string): Promise<RunArtifacts> => api.get(`/runbook-runs/${runId}/artifacts`);

/** Queues the zip bundle of a finished run; `jobId` is null when a bundle already exists. */
export const requestRunBundle = (runId: string): Promise<{ jobId: string | null; artifactId: string | null }> =>
  api.post(`/runbook-runs/${runId}/artifacts/bundle`);

/** A signed URL (15 minutes) of one artifact. The caller opens it and drops it: it is never logged or stored. */
export const getArtifactDownload = (runId: string, artifactId: string): Promise<SignedDownload> =>
  api.get(`/runbook-runs/${runId}/artifacts/${artifactId}/download`);
