import { Box, Button, Card, CardContent, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import { PlaylistPlay as RunbookIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import type { DashboardRunSummary, DashboardRuns } from '../../types/dashboard';
import { relativeTime } from './relativeTime';

/** The succeeded / failed / running split of a run's targets, as one bar. */
function TargetBar({ targets }: { targets: DashboardRunSummary['targets'] }) {
  const total = Math.max(targets.total, 1);
  const parts = [
    { key: 'succeeded', n: targets.succeeded, color: 'success.main' },
    { key: 'failed', n: targets.failed, color: 'error.main' },
    { key: 'running', n: targets.running, color: 'info.main' },
  ];
  return (
    <Box
      role="img"
      aria-label={`${targets.succeeded} succeeded, ${targets.failed} failed, ${targets.running} running`}
      sx={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', bgcolor: 'action.hover', mt: 0.75 }}
    >
      {parts.map((part) =>
        part.n > 0 ? (
          <Box key={part.key} data-testid={`bar-${part.key}`} sx={{ width: `${(part.n / total) * 100}%`, bgcolor: part.color }} />
        ) : null,
      )}
    </Box>
  );
}

/**
 * The most recent runbook runs on Home (#78). Rendered only when the summary carries `runs`
 * (the caller holds `runbooks:read` and the engine records runs). A row opens `/runs/:id`.
 */
export function RecentRunsPanel({ runs }: { runs: DashboardRuns }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }} component="section" aria-labelledby="home-recent-runs">
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h6" component="h2" id="home-recent-runs">
            Recent runs
          </Typography>
          <Button size="small" component={RouterLink} to="/runs">
            All runs
          </Button>
        </Box>
        {runs.recent.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <RunbookIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} aria-hidden="true" />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No runs yet.
            </Typography>
            <Button size="small" variant="outlined" component={RouterLink} to="/runbooks" sx={{ mt: 1 }}>
              Create a runbook
            </Button>
          </Box>
        ) : (
          <List disablePadding>
            {runs.recent.map((run) => (
              <ListItemButton key={run.id} component={RouterLink} to={`/runs/${run.id}`} sx={{ px: 1, borderRadius: 1, display: 'block' }}>
                <ListItemText
                  sx={{ minWidth: 0, m: 0 }}
                  primary={run.runbookName}
                  secondary={`${run.status} · ${run.targets.total} ${run.targets.total === 1 ? 'target' : 'targets'}${
                    run.startedAt ? ` · started ${relativeTime(run.startedAt)}` : ''
                  }`}
                  slotProps={{ primary: { noWrap: true, variant: 'body2' }, secondary: { noWrap: true, variant: 'caption' } }}
                />
                <TargetBar targets={run.targets} />
              </ListItemButton>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
