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
  RunStatus,
  RunSummary,
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

export const listRunbookSecrets = (): Promise<RunbookSecret[]> => api.get('/runbook-secrets');

/** Write-only: the value is sent once and never comes back. */
export const putRunbookSecret = (name: string, body: { value: string; label?: string }): Promise<RunbookSecret> =>
  api.put(`/runbook-secrets/${encodeURIComponent(name)}`, body);

export const startRun = (runbookId: string, input: CreateRunInput): Promise<{ runId: string }> =>
  api.post(`/runbooks/${runbookId}/runs`, input);

export interface ListRunsParams {
  page?: number;
  pageSize?: number;
  runbookId?: string;
  status?: RunStatus;
  trigger?: RunTrigger;
  since?: string;
}

export const listRuns = (params: ListRunsParams = {}): Promise<Page<RunSummary>> =>
  api.get(`/runbook-runs${query({ ...params })}`);

export const getRun = (id: string): Promise<RunDetail> => api.get(`/runbook-runs/${id}`);

/** The redacted log of one step as text. */
export async function getStepLog(runId: string, targetId: string, stepIndex: number): Promise<string> {
  const blob = await api.getBlob(`/runbook-runs/${runId}/targets/${targetId}/steps/${stepIndex}/log`);
  return blob.text();
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
