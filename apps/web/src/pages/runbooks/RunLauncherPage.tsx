/**
 * The run launcher deep links (issue #65; the Servers page's "Run runbook on selected", #79):
 *
 *   `/runbooks/:id/run?targets=<serverId>,<serverId>`  the runbook's page with the launcher open
 *                                                       and those servers pre-selected;
 *   `/runbooks/run?targets=<serverId>,<serverId>`      the launcher asks for the runbook first.
 *
 * `targets` is a comma-separated list of server profile ids; anything that is not a UUID is
 * dropped. Without it the launcher starts from the runbook's default targets.
 */
import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import RunbookDetailPage from './RunbookDetailPage';
import RunbooksPage from './RunbooksPage';
import { RunLauncherDialog } from '../../features/runbooks/components/RunLauncherDialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server ids of a `?targets=` value. */
export function parseTargetsParam(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((id) => id.trim()).filter((id) => UUID.test(id)))].slice(0, 500);
}

/** Build the deep link (exported for the Servers page, #79). */
export function runLauncherPath(serverIds: readonly string[], runbookId?: string): string {
  const query = serverIds.length > 0 ? `?targets=${serverIds.map(encodeURIComponent).join(',')}` : '';
  return runbookId ? `/runbooks/${encodeURIComponent(runbookId)}/run${query}` : `/runbooks/run${query}`;
}

export default function RunLauncherPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const serverIds = useMemo(() => parseTargetsParam(searchParams.get('targets')), [searchParams]);

  if (id) return <RunbookDetailPage key={id} launch launchServerIds={serverIds} />;
  return (
    <>
      <RunbooksPage />
      <RunLauncherDialog open initialServerIds={serverIds} onClose={() => navigate('/runbooks', { replace: true })} />
    </>
  );
}
